/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node (CommonJS) script */
/* Stock-alert tests (src/lib/tradeAlerts.ts): `npm run test:alerts`. Transpiles the real source with the project's
 * TypeScript, stubs the notifications, writes only to a temporary directory. */
const ts = require("typescript");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert/strict");

const root = path.resolve(process.argv[2] || ".");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ta-test-"));
process.env.TRADE_ALERTS_FILE = path.join(tmp, "trade-alerts.json");
const sent = [];
function load(file, stubs) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const m = { exports: {} };
  const req = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    if (id.startsWith("node:")) return require(id);
    throw new Error(`${file}: unstubbed import ${id}`);
  };
  new Function("require", "module", "exports", out)(req, m, m.exports);
  return m.exports;
}
const A = load("src/lib/tradeAlerts.ts", { "server-only": {}, "@/lib/notifications": { notifyAdmin: async (n) => void sent.push(n) } });

const at = (hhmm, date = "2026-11-30") => Date.parse(`${date}T${hhmm}:00+05:30`);
const base = 500000;
const lt = (o = {}) => ({ as_of: 0, day: 0, date: "2026-11-30", minute: 0, status: "decided", skip: false, pick: "ANGELONE", pick_px: 363.8,
  decided_at: at("09:20") / 1000 + 45, late: false, flip: null, mstop: null, mstop_check: null, has_watcher: true, settled_at: null,
  last_mark_at: null, book: base, mstop_at: 0.005, active: [], active_beat: null, ...o });
let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log("ok -", name); };

(async () => {
  await t("09:20 short: SELL with size; not before the decision, not 20 minutes after", () => {
    const d = A.bookADrafts(lt(), base, at("09:21"));
    assert.equal(d.length, 1);
    assert.equal(d[0].key, "A|2026-11-30|entry");
    assert.match(d[0].title, /^SELL ANGELONE @ ₹363\.80$/);
    assert.match(d[0].body, /1,374 shares/);
    assert.equal(A.bookADrafts(lt(), base, at("09:45")).length, 0); // a restart at 09:45 sends no stale SELL
    assert.equal(A.bookADrafts(lt({ decided_at: null, pick: null, pick_px: null, status: null }), base, at("09:16")).length, 0);
  });
  await t("regime skip and late decisions", () => {
    const s = A.bookADrafts(lt({ skip: true }), base, at("09:22"));
    assert.deepEqual(s.map((x) => x.key), ["A|2026-11-30|skip"]);
    assert.equal(A.bookADrafts(lt({ late: true }), base, at("09:40")).length, 0);
  });
  await t("market stop, flip with a buy, flip without a candidate, no flip", () => {
    const ms = A.bookADrafts(lt({ mstop: { at: at("09:50") / 1000, bar: 6, move: 0.0051 } }), base, at("09:51"));
    assert.deepEqual(ms.map((x) => x.title), ["COVER ANGELONE now (market stop)"]);
    const fl = A.bookADrafts(lt({ flip: { at: at("10:15") / 1000 + 55, do: true, symbol: "MAZDOCK", px: 1910.2 } }), base, at("10:16"));
    assert.equal(fl.length, 1);
    assert.equal(fl[0].title, "COVER ANGELONE, BUY MAZDOCK @ ₹1,910.20");
    assert.match(fl[0].body, /about 261 MAZDOCK/);
    const fl0 = A.bookADrafts(lt({ flip: { at: at("10:16") / 1000, do: true, symbol: null, px: null } }), base, at("10:16"));
    assert.equal(fl0[0].title, "COVER ANGELONE (10:15 flip)");
    const nf = A.bookADrafts(lt({ flip: { at: at("10:16") / 1000, do: false, symbol: null, px: null } }), base, at("10:17"));
    assert.equal(nf[0].key, "A|2026-11-30|noflip");
    const nfStopped = A.bookADrafts(lt({ mstop: { at: at("09:50") / 1000, bar: 6, move: 0.006 }, flip: { at: at("10:16") / 1000, do: false, symbol: null, px: null } }), base, at("10:17"));
    assert.equal(nfStopped.length, 0); // covered already: no "keep the short"
  });
  await t("15:15 square-off lists only what is still open", () => {
    const sq = A.bookADrafts(lt(), base, at("15:15"));
    assert.equal(sq[0].body, "Book A closes the day: BUY back ANGELONE (cover the short).");
    const sqf = A.bookADrafts(lt({ flip: { at: at("10:16") / 1000, do: true, symbol: "MAZDOCK", px: 1910 } }), base, at("15:16"));
    assert.equal(sqf[0].body, "Book A closes the day: SELL MAZDOCK (close the long).");
    assert.equal(A.bookADrafts(lt({ mstop: { at: at("11:00") / 1000, bar: 20, move: 0.006 } }), base, at("15:16")).length, 0);
    assert.equal(A.bookADrafts(lt(), base, at("15:31")).length, 0);
    assert.equal(A.bookADrafts(lt({ date: "2026-11-27" }), base, at("15:16")).length, 0); // yesterday's state
  });
  await t("watchlist: highest level only, once a day a direction, both directions", () => {
    const done = {};
    let d = A.watchDrafts([{ symbol: "PNB", last: 98, prevClose: 100 }, { symbol: "ITC", last: 401, prevClose: 400 }], done, "2026-11-30");
    assert.deepEqual(d.map((x) => x.title), ["PNB −2%: ₹98.00"]);
    d = A.watchDrafts([{ symbol: "PNB", last: 97.9, prevClose: 100 }], done, "2026-11-30");
    assert.equal(d.length, 0);
    d = A.watchDrafts([{ symbol: "PNB", last: 94, prevClose: 100 }], done, "2026-11-30");
    assert.deepEqual(d.map((x) => x.key), ["W|2026-11-30|PNB|down|5"]);
    d = A.watchDrafts([{ symbol: "PNB", last: 102.5, prevClose: 100, dayLow: 94, dayHigh: 103 }], done, "2026-11-30");
    assert.equal(d[0].title, "PNB +2%: ₹102.50");
    assert.match(d[0].body, /range ₹94\.00–₹103\.00/);
    assert.equal(A.watchDrafts([{ symbol: "X", last: 0, prevClose: 100 }], done, "2026-11-30").length, 0);
  });
  await t("emit: each key once, sent to the admin as an alert, listed newest first", async () => {
    const drafts = A.bookADrafts(lt(), base, at("09:21"));
    const a = await A.emit(drafts);
    const b = await A.emit(drafts);
    assert.equal(a.length, 1);
    assert.equal(b.length, 0);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].route, "admin:alerts");
    assert.equal(sent[0].key, "trade-alert|A|2026-11-30|entry");
    const w = await A.emit([], { date: "2026-11-30", make: (done) => A.watchDrafts([{ symbol: "PNB", last: 97, prevClose: 100 }], done, "2026-11-30") });
    const w2 = await A.emit([], { date: "2026-11-30", make: (done) => A.watchDrafts([{ symbol: "PNB", last: 97.5, prevClose: 100 }], done, "2026-11-30") });
    const w3 = await A.emit([], { date: "2026-12-01", make: (done) => A.watchDrafts([{ symbol: "PNB", last: 97.5, prevClose: 100 }], done, "2026-12-01") });
    assert.equal(w3.length, 1); // a new day starts its levels afresh
    assert.equal(w.length, 1);
    assert.equal(w2.length, 0);
    const list = await A.listAlerts();
    assert.deepEqual(list.map((x) => x.kind), ["watch", "watch", "bookA"]);
  });
  console.log(`\n${pass} tests passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
