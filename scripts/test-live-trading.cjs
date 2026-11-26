/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node (CommonJS) script */
/* Live-trading order engine tests with a fake Groww: `npm run test:live`
 * (or `node scripts/test-live-trading.cjs <app-root>`). Transpiles the real
 * sources with the project's TypeScript and stubs only the outside world: the
 * broker calls, the ledger and the notifications. Writes nothing outside a
 * temporary directory. */
const ts = require("typescript");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert/strict");

const root = path.resolve(process.argv[2] || ".");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lt-test-"));
process.env.LIVE_TRADING_FILE = path.join(tmp, "live-trading.json");

function load(file, stubs) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const m = { exports: {} };
  const req = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    if (id.startsWith("node:") || ["fs", "path", "crypto", "https"].includes(id)) return require(id);
    throw new Error(`${file}: unstubbed import ${id}`);
  };
  new Function("require", "module", "exports", out)(req, m, m.exports);
  return m.exports;
}

/* ------------------------------------------------------------- modules */
const groww = load("src/lib/api/groww.ts", {
  "server-only": {},
  "./growwFeed": {},
  "./credctx": { currentCredState: () => undefined, currentEgress: () => undefined },
  "./egress": { agentFor: () => undefined },
});
const util = load("src/lib/liveTrading/util.ts", { "server-only": {} });
const store = load("src/lib/liveTrading/store.ts", { "server-only": {} });

const world = {
  ledger: [],
  notes: [],
  places: [], // [accountId, input]
  placeQueue: [], // results to hand out, in order
  positions: {}, // accountId -> { CASH: [...], FNO: [...] } | null
  books: {}, // accountId -> { orders: [...], complete } | null
  byRef: {}, // accountId -> { ref: BookOrder }  (Groww's status-by-reference)
  cancels: [], // [accountId, orderId]
  erasing: new Set(),
  disconnected: new Set(),
  usersBroken: false,
};
const broker = {
  placeOrderAs: async (accountId, input) => {
    world.places.push([accountId, input]);
    const next = world.placeQueue.shift();
    if (!next) throw new Error("no queued place result");
    return typeof next === "function" ? next(accountId, input) : { referenceId: input.referenceId, ...next };
  },
  positionsAs: async (accountId, segment) => {
    const p = world.positions[accountId];
    return p === null || p === undefined ? null : (p[segment] ?? []);
  },
  orderBookAs: async (accountId) => world.books[accountId] ?? null,
  orderByRefAs: async (accountId, ref) => (world.byRef[accountId] ?? {})[ref] ?? null,
  houseConfigured: () => true,
  cancelOrderAs: async (accountId, orderId) => {
    world.cancels.push([accountId, orderId]);
    return { ok: true, message: null, sent: true };
  },
};
const orders = load("src/lib/liveTrading/orders.ts", {
  "server-only": {},
  "node:crypto": require("crypto"),
  "@/lib/ledger": { appendOrder: async (e) => void world.ledger.push(e) },
  "@/lib/notifications": { notify: async (u, n) => void world.notes.push([u, n]) },
  "@/lib/api/broker": broker,
  "@/lib/users": {
    getBroker: async (id) => {
      if (world.usersBroken) throw new Error("EIO");
      return world.disconnected.has(id) ? null : { apiKey: "k", totpSecret: "s" };
    },
  },
  "@/lib/auth": { OWNER_ID: "owner" },
  "@/lib/kycHandoff": {
    isErasing: (id) => world.erasing.has(id),
    markErasing: (id) => {
      world.erasing.add(id);
      return Symbol(id);
    },
    clearErasing: (id) => void world.erasing.delete(id),
  },
  "@/lib/api/groww": { FINAL_ORDER_STATES: groww.FINAL_ORDER_STATES },
  "./store": store,
  "./util": util,
});

/* The unit tests run on real time shifted by `offset`, so waits (quiet periods,
 * retry gaps, "never placed" checks) can be stepped over without sleeping. */
const realNowFn = Date.now;
let offset = 0;
Date.now = () => realNowFn() + offset;
const advance = (ms) => {
  offset += ms;
};

let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const reset = async () => {
  world.ledger = [];
  world.notes = [];
  world.places = [];
  world.placeQueue = [];
  world.positions = {};
  world.books = {};
  world.byRef = {};
  world.cancels = [];
  world.erasing = new Set();
  world.disconnected = new Set();
  world.usersBroken = false;
  // Every test starts at 11:00 IST (inside the session), so none depends on the hour it is run at.
  toSessionTime();
};
const pos = (symbol, net, product = "MIS", segment = "CASH", exchange = "NSE") => ({ symbol, segment, exchange, product, net, avg: 100 });
let dayN = 21000;
/** Move the clock forward to the next 11:00 IST (inside the session), so a test never depends on when it is run. */
const toSessionTime = () => {
  const nowMs = Date.now();
  const d = Math.floor((nowMs / 1000 + 19800) / 86400);
  let target = (d * 86400 + 11 * 3600 - 19800) * 1000;
  if (target <= nowMs) target += 86_400_000;
  advance(target - nowMs);
};
const QUIET = 16_000; // just past the quiet period after MNHA's own order on an account
const freshDay = () => ++dayN;

/* --------------------------------------------------------------- tests */
test("signedNet never reads a short as a long", () => {
  const n = groww.signedNet;
  assert.equal(n({ quantity: -100 }), -100);
  assert.equal(n({ quantity: 0 }), 0);
  assert.equal(n({ quantity: 100, credit_quantity: 100, debit_quantity: 0 }), 100);
  assert.equal(n({ quantity: 100, credit_quantity: 0, debit_quantity: 100 }), -100); // unsigned short
  assert.equal(n({ quantity: 100, credit_quantity: 0, debit_quantity: 150 }), null); // disagree -> unclear
  assert.equal(n({ quantity: 75, carry_forward_credit_quantity: 75, credit_quantity: 0, debit_quantity: 0 }), 75);
  assert.equal(n({ quantity: 50, carry_forward_credit_quantity: 100, credit_quantity: 0, debit_quantity: 150 }), -50);
  assert.equal(n({ quantity: 100 }), null); // no fill figures: the direction cannot be checked
  assert.equal(n({ quantity: 100, debit_quantity: 100 }), -100); // a zero credit left out
  // carried-forward legs, read both ways: refuse when the readings disagree, never reverse
  assert.equal(n({ quantity: 75, credit_quantity: 225, debit_quantity: 150, carry_forward_credit_quantity: 0, carry_forward_debit_quantity: 150 }), null);
  assert.equal(n({ quantity: 75, credit_quantity: 75, debit_quantity: 150, carry_forward_credit_quantity: 75, carry_forward_debit_quantity: 0 }), -75);
  assert.equal(n({}), null);
  assert.equal(n({ quantity: "5" }), null);
});

test("strategy and admin references obey Groww's rule and never collide", () => {
  const seen = new Set();
  const actions = ["entry", "stop-cover", "flip-cover", "flip-long", "close-short", "close-long"];
  const accts = ["owner", "u-0123456789abcdef0123456789abcdef", "x"];
  for (let d = 20400; d < 20460; d++)
    for (const a of actions)
      for (const id of accts)
        for (let n = 0; n < 3; n++) {
          const k = orders.strategyKey(d, a, id, n);
          assert.ok(groww.isValidReferenceId(k.ref), k.ref);
          assert.ok(!seen.has(k.ref), `duplicate ${k.ref}`);
          seen.add(k.ref);
        }
  for (let b = 0; b < 200; b++) {
    const k = orders.adminKey(`b${b.toString(16).padStart(16, "0")}`, "owner", "CASH:NSE:TCS:MIS");
    assert.ok(groww.isValidReferenceId(k.ref), k.ref);
    assert.ok(!seen.has(k.ref));
    seen.add(k.ref);
  }
});

test("an order is sent once: a second send of the same id sends nothing", async () => {
  await reset();
  const day = freshDay();
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "G1", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  const a = await orders.openLegIn({ day, action: "entry", leg: "short", accountId: "u1", mode: "live", symbol: "TCS", qty: 100 });
  assert.equal(a.state, "placed");
  assert.equal(a.booked, true);
  const b = await orders.openLegIn({ day, action: "entry", leg: "short", accountId: "u1", mode: "live", symbol: "TCS", qty: 100 });
  assert.equal(b, null);
  assert.equal(world.places.length, 1);
  assert.equal(world.ledger.length, 1);
  assert.equal(world.ledger[0].by, "system");
  assert.equal(world.places[0][1].side, "SELL");
  assert.equal(world.places[0][1].product, "MIS");
});

test("an unknown outcome is found by reference and booked once", async () => {
  await reset();
  const day = util.istNow().day; // followed orders: today's book only covers today
  world.placeQueue.push({ ok: false, outcome: "unknown", orderId: null, status: null, filled: null, message: "timeout", httpStatus: 0 });
  const o = await orders.openLegIn({ day, action: "entry", leg: "short", accountId: "u2", mode: "live", symbol: "INFY", qty: 50 });
  assert.equal(o.state, "unknown");
  assert.equal(o.final, false);
  assert.equal(world.ledger.length, 1); // "unknown" is booked at once
  world.books.u2 = { orders: [{ orderId: "G2", referenceId: o.ref, symbol: "INFY", status: "EXECUTED", qty: 50, filled: 50, avg: 1500, remark: null }], complete: true };
  await orders.followOrders();
  const after = await store.getOrder(o.id);
  assert.equal(after.state, "placed");
  assert.equal(after.filled, 50);
  assert.equal(after.final, true);
  assert.equal(after.orderId, "G2");
  assert.equal(world.ledger.length, 1); // never booked twice
  assert.ok(world.notes.some(([, n]) => n.key === `lt-${o.ref}-f`));
});

test("a record left 'sending' by a crash is booked when found, and called not-sent only after two misses", async () => {
  await reset();
  const day = util.istNow().day;
  const base = { day, updatedAt: 0, source: "auto", mode: "live", action: "entry", leg: "short", batch: null, accountId: "u3", symbol: "SBIN", side: "SELL", qty: 10, product: "MIS", type: "MARKET", price: null, segment: "CASH", exchange: "NSE", state: "sending", orderId: null, status: null, filled: null, avg: null, message: null, final: false, booked: false };
  const k1 = orders.strategyKey(day, "entry", "u3", 0);
  await store.insertOrder({ ...base, ...k1, at: Date.now() - 60_000 });
  world.books.u3 = { orders: [{ orderId: "G3", referenceId: k1.ref, symbol: "SBIN", status: "EXECUTED", qty: 10, filled: 10, avg: 800, remark: null }], complete: true };
  await orders.followOrders();
  const found = await store.getOrder(k1.id);
  assert.equal(found.state, "placed");
  assert.equal(world.ledger.length, 1);

  const k3 = orders.strategyKey(day, "entry", "u5", 0);
  await store.insertOrder({ ...base, ...k3, accountId: "u5", at: Date.now() - 10_000 });
  world.books.u5 = { orders: [], complete: true };
  await orders.followOrders();
  assert.equal((await store.getOrder(k3.id)).state, "sending"); // too soon to judge

  const k2 = orders.strategyKey(day, "entry", "u4", 0);
  await store.insertOrder({ ...base, ...k2, accountId: "u4", at: Date.now() - 60_000 });
  world.books.u4 = { orders: [], complete: true };
  await orders.followOrders();
  assert.equal((await store.getOrder(k2.id)).state, "sending"); // one miss is not proof
  advance(31_000);
  await orders.followOrders();
  const gone = await store.getOrder(k2.id);
  assert.equal(gone.state, "not-sent");
  assert.equal(gone.final, false); // still checked through the day
  assert.equal(world.ledger.length, 1); // nothing was sent for u4
  // ...and restored if Groww shows it after all
  world.books.u4 = { orders: [{ orderId: "G4", referenceId: k2.ref, symbol: "SBIN", status: "EXECUTED", qty: 10, filled: 10, avg: 800, remark: null }], complete: true };
  advance(31_000);
  await orders.followOrders();
  const back = await store.getOrder(k2.id);
  assert.equal(back.state, "placed");
  assert.equal(back.filled, 10);
  assert.equal(world.ledger.length, 2); // booked once, now that it is known
});

test("'never placed' needs a book that shows references; status-by-reference can confirm one", async () => {
  await reset();
  const day = util.istNow().day; // followed orders: today's book only covers today
  const base = { day, updatedAt: 0, source: "auto", mode: "live", action: "entry", leg: "short", batch: null, symbol: "SBIN", side: "SELL", qty: 10, product: "MIS", type: "MARKET", price: null, segment: "CASH", exchange: "NSE", state: "unknown", orderId: null, status: null, filled: null, avg: null, message: null, final: false, booked: true };
  // a book with orders but no references at all: never concluded "not placed"
  const k1 = orders.strategyKey(day, "entry", "r1", 0);
  await store.insertOrder({ ...base, ...k1, accountId: "r1", at: Date.now() - 60_000 });
  world.books.r1 = { orders: [{ orderId: "APP1", referenceId: null, symbol: "TCS", status: "EXECUTED", qty: 1, filled: 1, avg: 1, remark: null }], complete: true };
  await orders.followOrders();
  advance(31_000);
  await orders.followOrders();
  assert.equal((await store.getOrder(k1.id)).state, "unknown");
  // the same, but Groww confirms it by reference
  const k2 = orders.strategyKey(day, "entry", "r2", 0);
  await store.insertOrder({ ...base, ...k2, accountId: "r2", at: Date.now() - 60_000 });
  world.books.r2 = { orders: [{ orderId: "APP2", referenceId: null, symbol: "TCS", status: "EXECUTED", qty: 1, filled: 1, avg: 1, remark: null }], complete: true };
  world.byRef.r2 = { [k2.ref]: { orderId: "G9", referenceId: k2.ref, symbol: null, status: "EXECUTED", qty: null, filled: 10, avg: null, remark: null } };
  await orders.followOrders();
  const r2 = await store.getOrder(k2.id);
  assert.equal(r2.state, "placed");
  assert.equal(r2.filled, 10);
  assert.equal(r2.orderId, "G9");
});

test("HTTP 429: retried only after the order book shows the reference absent", async () => {
  await reset();
  const day = freshDay();
  world.books.u6 = { orders: [], complete: true };
  world.placeQueue.push({ ok: false, outcome: "rejected", orderId: null, status: null, filled: null, message: "HTTP 429", httpStatus: 429 });
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "G6", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  const o = await orders.openLegIn({ day, action: "entry", leg: "short", accountId: "u6", mode: "live", symbol: "TCS", qty: 1 });
  assert.equal(o.state, "placed");
  assert.equal(world.places.length, 2);
  assert.equal(world.places[0][1].referenceId, world.places[1][1].referenceId);

  await reset();
  const d2 = freshDay();
  world.placeQueue.push((acct, input) => {
    // throttled, yet it did land: the book has it
    world.books.u7 = { orders: [{ orderId: "G7", referenceId: input.referenceId, symbol: "TCS", status: "OPEN", qty: 1, filled: 0, avg: null, remark: null }], complete: true };
    return { ok: false, outcome: "rejected", orderId: null, status: null, filled: null, message: "HTTP 429", httpStatus: 429, referenceId: input.referenceId };
  });
  const o2 = await orders.openLegIn({ day: d2, action: "entry", leg: "short", accountId: "u7", mode: "live", symbol: "TCS", qty: 1 });
  assert.equal(o2.state, "placed");
  assert.equal(o2.orderId, "G7");
  assert.equal(world.places.length, 1); // never sent a second time
});

async function filledEntry(day, acct, symbol, qty) {
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: `E-${acct}`, status: "EXECUTED", filled: qty, message: null, httpStatus: 200 });
  const o = await orders.openLegIn({ day, action: "entry", leg: "short", accountId: acct, mode: "live", symbol, qty });
  await store.patchOrder(o.id, { final: true, filled: qty, status: "EXECUTED" });
  advance(16_000); // past the quiet period after a send
  return o;
}

test("a cover is sized from fills, waits while on its way, then is done", async () => {
  await reset();
  const day = freshDay();
  await filledEntry(day, "a1", "TCS", 100);
  world.positions.a1 = { CASH: [pos("TCS", -100)], FNO: [] };
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "C1", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  assert.equal(await orders.closeLegIn({ day, action: "stop-cover", leg: "short", accountId: "a1", mode: "live" }), "sent");
  const cover = world.places.at(-1)[1];
  assert.equal(cover.side, "BUY");
  assert.equal(cover.qty, 100);
  assert.equal(cover.product, "MIS");
  assert.equal(await orders.closeLegIn({ day, action: "stop-cover", leg: "short", accountId: "a1", mode: "live" }), "wait");
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "a1", mode: "live" }), "wait"); // not over a working close
  const c = (await store.ordersOfDay(day)).find((o) => o.action === "stop-cover");
  await store.patchOrder(c.id, { final: true, filled: 100, status: "EXECUTED" });
  world.positions.a1 = { CASH: [pos("TCS", 0)], FNO: [] };
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "a1", mode: "live" }), "done");
  assert.equal(world.places.length, 2);
});

test("a position closed outside MNHA is not closed again; a partly closed one only for the rest", async () => {
  await reset();
  const day = freshDay();
  await filledEntry(day, "b1", "TCS", 100);
  world.positions.b1 = { CASH: [], FNO: [] };
  const outside = [];
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "b1", mode: "live", onOutside: (n) => outside.push(n) }), "done");
  assert.deepEqual(outside, [100]);
  assert.equal(world.places.length, 1);

  await filledEntry(day, "b2", "TCS", 100);
  world.positions.b2 = { CASH: [pos("TCS", -40)], FNO: [] };
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "C2", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "b2", mode: "live" }), "sent");
  assert.equal(world.places.at(-1)[1].qty, 40);

  await filledEntry(day, "b3", "TCS", 100);
  world.positions.b3 = { CASH: [pos("TCS", 60)], FNO: [] }; // the client is long now: nothing to cover
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "b3", mode: "live" }), "done");

  await filledEntry(day, "b4", "TCS", 100);
  world.positions.b4 = { CASH: [pos("TCS", null)], FNO: [] };
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "b4", mode: "live" }), "unclear");

  await filledEntry(day, "b5", "TCS", 100);
  world.positions.b5 = null; // unreadable
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "b5", mode: "live" }), "wait");
});

test("a rejected cover is retried after the gap, at most three times", async () => {
  await reset();
  const day = freshDay();
  await filledEntry(day, "c1", "TCS", 100);
  world.positions.c1 = { CASH: [pos("TCS", -100)], FNO: [] };
  const age = () => advance(20_000);
  const close = () => orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "c1", mode: "live" });
  for (let i = 0; i < 3; i++) {
    world.placeQueue.push({ ok: false, outcome: "rejected", orderId: null, status: null, filled: null, message: "RMS", httpStatus: 400 });
    assert.equal(await close(), "sent");
    // inside the retry gap it waits; after the third rejection it gives up at once
    assert.equal(await close(), i < 2 ? "wait" : "gave-up");
    age();
  }
  assert.equal(await close(), "gave-up");
  assert.equal(world.places.filter(([, i]) => i.side === "BUY").length, 3);
});

test("a close stuck at Groww is never doubled — not by another step, not by an admin exit", async () => {
  await reset();
  const day = util.istNow().day; // followed orders: today's book only covers today
  await filledEntry(day, "w1", "TCS", 100);
  world.positions.w1 = { CASH: [pos("TCS", -100)], FNO: [] };
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "S1", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  assert.equal(await orders.closeLegIn({ day, action: "stop-cover", leg: "short", accountId: "w1", mode: "live" }), "sent");
  world.books.w1 = { orders: [{ orderId: "S1", referenceId: (await store.ordersOfDay(day)).at(-1).ref, symbol: "TCS", status: "OPEN", qty: 100, filled: 0, avg: null, remark: null }], complete: true };
  advance(20 * 60_000); // twenty minutes stuck at the upper circuit
  await orders.followOrders();
  assert.equal((await store.ordersOfDay(day)).at(-1).final, false); // still followed while Groww shows it working
  assert.equal(await orders.closeLegIn({ day, action: "stop-cover", leg: "short", accountId: "w1", mode: "live" }), "wait");
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "w1", mode: "live" }), "wait");
  const r = await orders.exitIn({ batch: "bTEST0100", day, accountId: "w1", symbol: null });
  assert.equal(r.orders.length, 0);
  assert.match(r.rows[0].skip, /still working/);
  assert.equal(world.places.length, 2); // the entry and the one stuck cover
  // part of it fills: the rest stays reserved
  world.books.w1.orders[0].filled = 60;
  world.positions.w1 = { CASH: [pos("TCS", -40)], FNO: [] };
  advance(30_000);
  await orders.followOrders();
  advance(16_000);
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "w1", mode: "live" }), "wait");
  // Groww cancels the rest: then, and only then, the remaining 40 are closed
  world.books.w1.orders[0].status = "CANCELLED";
  advance(30_000);
  await orders.followOrders();
  advance(16_000);
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "S2", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "w1", mode: "live" }), "sent");
  assert.equal(world.places.at(-1)[1].qty, 40);
});

test("a strategy entry stuck unfilled is cancelled after a minute; a stuck close never is", async () => {
  await reset();
  const day = util.istNow().day;
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "E77", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  const e = await orders.openLegIn({ day, action: "entry", leg: "short", accountId: "z1", mode: "live", symbol: "LOCKED", qty: 100 });
  await orders.cancelStuckOpeners(day);
  assert.equal(world.cancels.length, 0); // not yet a minute
  advance(61_000);
  const notes = [];
  await orders.cancelStuckOpeners(day, (t) => notes.push(t));
  assert.deepEqual(world.cancels, [["z1", "E77"]]);
  assert.equal(notes.length, 1);
  await orders.cancelStuckOpeners(day);
  assert.equal(world.cancels.length, 1); // asked once
  assert.ok(world.ledger.some((x) => x.status === "cancelled" && x.by === "system"));
  // Groww cancels it with 30 filled: those 30 are what the leg holds
  world.books.z1 = { orders: [{ orderId: "E77", referenceId: e.ref, symbol: "LOCKED", status: "CANCELLED", qty: 100, filled: 30, avg: 50, remark: null }], complete: true };
  advance(30_000);
  await orders.followOrders();
  const st = orders.legState(await store.ordersOfDay(day), "z1", "short", "live");
  assert.equal(st.open, 30);
  assert.equal(st.possible, 30);
  // a stuck cover is left working
  world.positions.z1 = { CASH: [pos("LOCKED", -30)], FNO: [] };
  advance(16_000);
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "C77", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "z1", mode: "live" }), "sent");
  advance(5 * 60_000);
  await orders.cancelStuckOpeners(day);
  assert.equal(world.cancels.length, 1);
});

test("an admin's resting limit order on the strategy position is cancelled before the close, never counted on", async () => {
  await reset();
  const day = util.istNow().day; // followed orders: today's book only covers today
  await filledEntry(day, "l1", "TCS", 100);
  // the admin's take-profit: BUY 100 TCS MIS LIMIT, resting
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "TP1", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  const tp = (await orders.adminOrderIn({ batch: "bTP000001", day, accountId: "l1", symbol: "TCS", side: "BUY", qty: 100, product: "MIS", type: "LIMIT", price: 2900, since: Date.now() - orders.DUPLICATE_MS })).order;
  advance(16_000);
  world.positions.l1 = { CASH: [pos("TCS", -100)], FNO: [] };
  assert.equal(await orders.closeLegIn({ day, action: "stop-cover", leg: "short", accountId: "l1", mode: "live" }), "wait");
  assert.deepEqual(world.cancels, [["l1", "TP1"]]);
  // Groww cancels it (nothing filled): now the stop goes out at market, for the whole position
  world.books.l1 = { orders: [{ orderId: "TP1", referenceId: tp.ref, symbol: "TCS", status: "CANCELLED", qty: 100, filled: 0, avg: null, remark: null }], complete: true };
  advance(30_000);
  await orders.followOrders();
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "SC1", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  assert.equal(await orders.closeLegIn({ day, action: "stop-cover", leg: "short", accountId: "l1", mode: "live" }), "sent");
  const last = world.places.at(-1)[1];
  assert.equal(`${last.side} ${last.qty} ${last.type}`, "BUY 100 MARKET");
});

test("bulk orders: a retry is held back even re-sized; 'again' overrides only what the preview showed", async () => {
  await reset();
  const day = util.istNow().day;
  const since = () => Date.now() - orders.DUPLICATE_MS;
  const send = (batch, extra = {}) =>
    orders.adminOrderIn({ batch, day, accountId: "q1", symbol: "IDEA", side: "BUY", qty: 3323, product: "MIS", type: "MARKET", price: null, since: since(), ...extra });
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "B1", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  const a = await send("bRETRY0001");
  assert.equal(a.order.state, "placed");
  // the retry, re-sized from the amount at a new price: held back
  const b = await send("bRETRY0002", { qty: 3322 });
  assert.equal(b.held, "duplicate");
  assert.equal(b.dup.id, a.order.id);
  assert.equal(world.places.length, 1);
  // "again" overrides exactly the order the admin was shown...
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "B2", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  const c = await send("bRETRY0003", { qty: 3322, ignore: [a.order.id] });
  assert.equal(c.order.state, "placed");
  // ...but not one recorded since (another batch): that still holds the send back
  const d = await send("bRETRY0004", { ignore: [a.order.id] });
  assert.equal(d.held, "duplicate");
  assert.equal(d.dup.id, c.order.id);
  // the other side is not a duplicate
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "B3", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  const e = await send("bRETRY0005", { side: "SELL", qty: 10 });
  assert.equal(e.order.state, "placed");
  // a flag the admin saw cannot age out before the click: the window starts 15 minutes before the PREVIEW
  const previewAt = Date.now();
  advance(14 * 60_000);
  const f = await send("bRETRY0006", { since: Math.min(previewAt, Date.now()) - orders.DUPLICATE_MS, side: "SELL", qty: 10 });
  assert.equal(f.held, "duplicate");
  // an order that ended with nothing done (cancelled, nothing filled) is not a duplicate
  await store.patchOrder(e.order.id, { final: true, status: "CANCELLED", filled: 0 });
  await store.patchOrder(f.dup?.id ?? e.order.id, { final: true, status: "CANCELLED", filled: 0 });
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "B4", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  const g = await send("bRETRY0007", { side: "SELL", qty: 10 });
  assert.equal(g.order.state, "placed");
  // an account being deleted is skipped, and said so
  world.erasing.add("q1");
  const h = await send("bRETRY0008", { symbol: "ITC" });
  assert.equal(h.held, "erasing");
});

test("a disconnected account: its close is reported once (offline), not polled; follow-up resumes on reconnect", async () => {
  await reset();
  const day = util.istNow().day;
  await filledEntry(day, "off1", "TCS", 100);
  world.positions.off1 = { CASH: [pos("TCS", -100)], FNO: [] };
  world.disconnected.add("off1");
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "off1", mode: "live" }), "offline");
  // a users-file error is never taken as disconnected
  world.disconnected.delete("off1");
  world.usersBroken = true;
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "off1", mode: "live" }), "wait");
  world.usersBroken = false;
  // a working order of a disconnected account is not polled; it is followed again as soon as it reconnects
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "OF1", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "off1", mode: "live" }), "sent");
  const cov = (await store.ordersOfDay(day)).filter((o) => o.accountId === "off1").at(-1);
  world.books.off1 = { orders: [{ orderId: "OF1", referenceId: cov.ref, symbol: "TCS", status: "EXECUTED", qty: 100, filled: 100, avg: 1, remark: null }], complete: true };
  world.disconnected.add("off1");
  advance(30_000);
  await orders.followOrders();
  assert.equal((await store.getOrder(cov.id)).final, false);
  world.disconnected.delete("off1");
  await orders.followOrders();
  assert.equal((await store.getOrder(cov.id)).final, true);
});

test("the admin can cancel a working MNHA order", async () => {
  await reset();
  const day = freshDay();
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "LIM9", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  const o = (await orders.adminOrderIn({ batch: "bLIM00009", day, accountId: "k1", symbol: "INFY", side: "BUY", qty: 5, product: "CNC", type: "LIMIT", price: 1, since: Date.now() - orders.DUPLICATE_MS })).order;
  const after = await orders.cancelByAdmin(o.id);
  assert.deepEqual(world.cancels, [["k1", "LIM9"]]);
  assert.equal(after.sent, true);
  assert.ok(after.order.cancelAt);
  // a disconnected account's order: nothing is sent, and the record says so
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "LIM10", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  const o2 = (await orders.adminOrderIn({ batch: "bLIM00010", day, accountId: "k2", symbol: "INFY", side: "BUY", qty: 5, product: "CNC", type: "LIMIT", price: 1, since: Date.now() - orders.DUPLICATE_MS })).order;
  world.disconnected.add("k2");
  const after2 = await orders.cancelByAdmin(o2.id);
  assert.equal(after2.sent, false);
  assert.equal(world.cancels.length, 1);
  assert.ok(world.ledger.some((x) => x.status === "cancelled" && x.by === "admin"));
});

test("an entry of unknown outcome is still closed from the live position", async () => {
  await reset();
  const day = freshDay();
  world.placeQueue.push({ ok: false, outcome: "unknown", orderId: null, status: null, filled: null, message: "timeout", httpStatus: 0 });
  await orders.openLegIn({ day, action: "entry", leg: "short", accountId: "x1", mode: "live", symbol: "TCS", qty: 100 });
  advance(16_000);
  world.positions.x1 = { CASH: [pos("TCS", -100)], FNO: [] }; // it did fill
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "X9", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "x1", mode: "live" }), "sent");
  assert.equal(world.places.at(-1)[1].qty, 100);
});

test("an admin exit right after a strategy cover sees a stale position and sends nothing", async () => {
  await reset();
  const day = freshDay();
  await filledEntry(day, "d1", "TCS", 100);
  world.positions.d1 = { CASH: [pos("TCS", -100)], FNO: [] };
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "C3", status: "EXECUTED", filled: 100, message: null, httpStatus: 200 });
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "d1", mode: "live" }), "sent");
  // Groww's positions have not caught up: still -100
  const r = await orders.exitIn({ batch: "bTEST0001", day, accountId: "d1", symbol: null });
  assert.equal(r.orders.length, 0);
  assert.match(r.rows[0].skip, /catching up/);
  assert.equal(world.places.length, 2);
  // once they have caught up, there is nothing left to close
  world.positions.d1 = { CASH: [pos("TCS", 0)], FNO: [] };
  const r2 = await orders.exitIn({ batch: "bTEST0002", day, accountId: "d1", symbol: null });
  assert.equal(r2.orders.length, 0);
  assert.equal(r2.rows.length, 0);
});

test("an admin exit closes exactly the net, counts toward the strategy leg, and leaves odd positions alone", async () => {
  await reset();
  const day = freshDay();
  await filledEntry(day, "e1", "TCS", 100);
  world.positions.e1 = {
    CASH: [pos("TCS", -100), pos("ITC", 50, "CNC"), pos("HDFCBANK", -20, "CNC"), pos("WIPRO", 10, null), pos("RELIANCE", 5, "NRML"), pos("LT", null)],
    FNO: [pos("NIFTY25DEC24000CE", -75, "NRML", "FNO", "NSE")],
  };
  world.placeQueue.push(
    { ok: true, outcome: "placed", orderId: "X1", status: "OPEN", filled: 0, message: null, httpStatus: 200 },
    { ok: true, outcome: "placed", orderId: "X2", status: "OPEN", filled: 0, message: null, httpStatus: 200 },
    { ok: true, outcome: "placed", orderId: "X3", status: "OPEN", filled: 0, message: null, httpStatus: 200 },
  );
  const r = await orders.exitIn({ batch: "bTEST0003", day, accountId: "e1", symbol: null });
  const sent = world.places.slice(1).map(([, i]) => `${i.side} ${i.qty} ${i.symbol} ${i.product} ${i.segment}`);
  assert.deepEqual(sent.sort(), ["BUY 100 TCS MIS CASH", "BUY 75 NIFTY25DEC24000CE NRML FNO", "SELL 50 ITC CNC CASH"].sort());
  const skipped = Object.fromEntries(r.rows.filter((x) => x.skip).map((x) => [x.symbol, x.skip]));
  assert.ok(skipped.HDFCBANK && skipped.WIPRO && skipped.RELIANCE && skipped.LT);
  const tcs = r.orders.find((o) => o.symbol === "TCS");
  assert.equal(tcs.leg, "short");
  await store.patchOrder(tcs.id, { final: true, filled: 100, status: "EXECUTED" });
  const st = orders.legState(await store.ordersOfDay(day), "e1", "short", "live");
  assert.equal(st.open, 0);
  // the same exit confirmed twice sends nothing more
  world.positions.e1 = { CASH: [pos("TCS", -100)], FNO: [] };
  const again = await orders.exitIn({ batch: "bTEST0003", day, accountId: "e1", symbol: "TCS" });
  assert.equal(again.orders.length, 0);
});

test("an exit confirmation closes only what its preview showed, in that direction", async () => {
  await reset();
  const day = freshDay();
  world.positions.p1 = { CASH: [pos("RELIANCE", 100)], FNO: [pos("NIFTYCE", 75, "NRML", "FNO", "NSE")] };
  const picks = [{ segment: "CASH", exchange: "NSE", symbol: "RELIANCE", product: "MIS", side: "SELL", qty: 100 }];
  // since the preview: RELIANCE grew to 150 and an option appeared — only the 100 shown are closed
  world.positions.p1.CASH[0].net = 150;
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "XP1", status: "OPEN", filled: 0, message: null, httpStatus: 200 });
  const r = await orders.exitIn({ batch: "bPICK0001", day, accountId: "p1", symbol: null, picks });
  assert.deepEqual(world.places.map(([, i]) => `${i.side} ${i.qty} ${i.symbol}`), ["SELL 100 RELIANCE"]);
  assert.match(r.rows.find((x) => x.symbol === "NIFTYCE").skip, /Not in the list you saw/);
  // a position whose direction flipped since the preview is left alone
  await reset();
  world.positions.p2 = { CASH: [pos("RELIANCE", -100)], FNO: [] };
  const r2 = await orders.exitIn({ batch: "bPICK0002", day, accountId: "p2", symbol: null, picks });
  assert.equal(world.places.length, 0);
  assert.match(r2.rows[0].skip, /direction changed/);
});

test("deletion is held only while MNHA can still see something open — never after a disconnect", async () => {
  await reset();
  const day = util.istNow().day;
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "DX1", status: "EXECUTED", filled: 10, message: null, httpStatus: 200 });
  const e = await orders.openLegIn({ day, action: "entry", leg: "short", accountId: "del1", mode: "live", symbol: "TCS", qty: 10 });
  await store.patchOrder(e.id, { final: true, filled: 10, status: "EXECUTED" });
  world.positions.del1 = { CASH: [pos("TCS", -10)], FNO: [] };
  // right after MNHA's own order Groww's reading may not have caught up: never called clear
  assert.equal(await orders.liveExposure("del1"), "unconfirmed");
  advance(QUIET);
  assert.equal(await orders.liveExposure("del1"), "open");
  world.positions.del1 = null; // Groww cannot be read
  assert.equal(await orders.liveExposure("del1"), "unconfirmed");
  world.positions.del1 = { CASH: [], FNO: [] }; // closed in the Groww app
  assert.equal(await orders.liveExposure("del1"), null);
  world.positions.del1 = { CASH: [pos("TCS", -10)], FNO: [] };
  world.usersBroken = true; // the users file cannot be read: never waved through
  assert.equal(await orders.liveExposure("del1"), "unconfirmed");
  world.usersBroken = false;
  world.disconnected.add("del1"); // MNHA can no longer watch or close it: nothing to hold for
  assert.equal(await orders.liveExposure("del1"), null);
  world.disconnected.delete("del1");
  assert.equal(await orders.liveExposure("del1"), "open");
  advance((4 * 60 + 40) * 60_000); // 15:40: intraday positions are squared off by then
  assert.equal(await orders.liveExposure("del1"), null);
});

test("deletion waits for a clear account, and nothing is sent while it runs", async () => {
  await reset();
  const day = util.istNow().day;
  world.placeQueue.push({ ok: true, outcome: "placed", orderId: "EC1", status: "EXECUTED", filled: 10, message: null, httpStatus: 200 });
  const e = await orders.openLegIn({ day, action: "entry", leg: "short", accountId: "era1", mode: "live", symbol: "TCS", qty: 10 });
  await store.patchOrder(e.id, { final: true, filled: 10, status: "EXECUTED" });
  advance(QUIET);
  let ran = 0;
  world.positions.era1 = { CASH: [pos("TCS", -10)], FNO: [] };
  const h = await orders.eraseIfClear("era1", async () => void ran++);
  assert.deepEqual(h, { held: "open" });
  assert.equal(ran, 0);
  assert.equal(world.erasing.has("era1"), false); // held: the account works as before
  world.positions.era1 = { CASH: [], FNO: [] };
  const sentBefore = world.places.length;
  const r = await orders.eraseIfClear("era1", async () => {
    ran++;
    // while the deletion runs, no order reaches the account
    assert.equal(await orders.openLegIn({ day, action: "entry", leg: "short", accountId: "era1", mode: "live", symbol: "TCS", qty: 1 }), null);
    return "gone";
  });
  assert.deepEqual(r, { done: "gone" });
  assert.equal(ran, 1);
  assert.equal(world.places.length, sentBefore);
  assert.equal(world.erasing.has("era1"), false);
});

test("nothing is sent or recorded for an account being erased", async () => {
  await reset();
  const day = freshDay();
  world.erasing.add("gone1");
  const o = await orders.openLegIn({ day, action: "entry", leg: "short", accountId: "gone1", mode: "live", symbol: "TCS", qty: 1 });
  assert.equal(o, null);
  assert.equal(world.places.length, 0);
  assert.equal((await store.ordersOfDay(day)).length, 0);
});

test("shadow mode records as filled and never calls Groww", async () => {
  await reset();
  const day = freshDay();
  const o = await orders.openLegIn({ day, action: "entry", leg: "short", accountId: "s1", mode: "shadow", symbol: "TCS", qty: 100, shadowPx: 3000 });
  assert.equal(o.state, "shadow");
  assert.equal(o.filled, 100);
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "s1", mode: "shadow", shadowPx: 3010 }), "sent");
  assert.equal(await orders.closeLegIn({ day, action: "close-short", leg: "short", accountId: "s1", mode: "shadow" }), "done");
  assert.equal(world.places.length, 0);
  assert.equal(world.ledger.length, 0);
  assert.equal(world.notes.length, 0);
});

test("a stalled proxy tunnel fails every call within its CONNECT limit — none queue forever", async () => {
  const net = require("net");
  const https = require("https");
  const egress = load("src/lib/api/egress.ts", { "server-only": {}, "https-proxy-agent": require("https-proxy-agent"), "../egressStore": { listEgress: async () => [] } });
  // accepts, reads and discards, never answers (reading lets it see a client close the connection)
  const hole = net.createServer((sock) => {
    sock.on("error", () => {});
    sock.resume();
  });
  await new Promise((r) => hole.listen(0, "127.0.0.1", r));
  try {
    const agent = egress.agentFor({ kind: "proxy", url: `http://127.0.0.1:${hole.address().port}`, ip: "203.0.113.9" });
    const t0 = realNowFn();
    const results = await Promise.race([
      Promise.all(
        Array.from({ length: 12 }, () =>
          new Promise((resolve) => {
            const req = https.request({ host: "api.groww.in", path: "/", agent, timeout: 15_000 }, () => resolve("answered"));
            req.on("error", (e) => resolve(e.message));
            req.end();
          }),
        ),
      ),
      new Promise((resolve) => setTimeout(() => resolve(null), 20_000)),
    ]);
    assert.ok(results, "some call never settled");
    assert.ok(results.every((m) => /CONNECT/.test(m)), JSON.stringify(results));
    assert.ok(realNowFn() - t0 < 15_000);
    // and the stalled tunnels were closed, not left open on the proxy
    await new Promise((r) => setTimeout(r, 200));
    const open = await new Promise((r) => hole.getConnections((_e, n) => r(n)));
    assert.equal(open, 0);
  } finally {
    hole.close();
  }
});

test("order addresses: a new member is never handed the house account's address; one who already holds it is never stranded", async () => {
  const saved = { GROWW_REGISTERED_IP: process.env.GROWW_REGISTERED_IP, GROWW_HOUSE_PROXY: process.env.GROWW_HOUSE_PROXY };
  process.env.GROWW_REGISTERED_IP = "10.0.0.1"; // the house account's: registered on the owner's own Groww key
  delete process.env.GROWW_HOUSE_PROXY;
  const members = { near: "10.0.0.2" }; // member id -> the address on their Groww key
  const last = {}; // member id -> the address of their last connection, after a disconnect
  const pool = [
    { ip: "10.0.0.1", addedAt: 0 }, // the house address listed in the pool too: still never handed out
    { ip: "10.0.0.2", addedAt: 1 },
    { ip: "10.0.0.3", proxy: "http://u:p@10.9.9.9:8888", addedAt: 2 },
  ];
  try {
    const egress = load("src/lib/api/egress.ts", { "server-only": {}, "https-proxy-agent": require("https-proxy-agent"), "../egressStore": { listEgress: async () => pool } });
    const trading = load("src/lib/trading.ts", {
      "server-only": {},
      "./auth": { OWNER_ID: "owner" },
      "./users": {
        getUserBrokerMeta: async (id) => (id in members ? { staticIp: members[id], ipConfirmed: true, ucc: null } : null),
        ipsInUse: async (except) => Object.entries(members).filter(([id]) => id !== except).map(([, ip]) => ip),
        lastStaticIp: async (id) => last[id] ?? null,
      },
      "./api/egress": egress,
    });
    // no member holds the house address, yet a new member is handed the next free pool address instead
    assert.equal(await trading.assignableIp("fresh"), "10.0.0.3");
    assert.equal(await trading.mayClaimIp("fresh", "10.0.0.1"), false); // the house account's
    assert.equal(await trading.mayClaimIp("fresh", "10.0.0.2"), false); // another member's
    assert.equal(await trading.mayClaimIp("fresh", "10.0.0.9"), false); // not one this server can send from
    assert.equal(await trading.mayClaimIp("fresh", "10.0.0.3"), true);
    // a member handed the house address before this rule keeps it on a reconnect, and still trades
    members.old = "10.0.0.1";
    assert.equal(await trading.assignableIp("old"), "10.0.0.1");
    assert.equal(await trading.mayClaimIp("old", "10.0.0.1"), true);
    assert.equal((await trading.tradePermission("old")).allowed, true);
    assert.equal(await trading.mayClaimIp("fresh", "10.0.0.1"), false);
    // that member is disconnected: with a pool address free they are moved onto it (how the admin moves them off)
    delete members.old;
    last.old = "10.0.0.1";
    assert.equal(await trading.assignableIp("old"), "10.0.0.3");
    assert.equal(await trading.mayClaimIp("old", "10.0.0.1"), false);
    // ...and with none free they get their old address back rather than being unable to connect at all
    members.fresh = "10.0.0.3";
    assert.equal(await trading.assignableIp("old"), "10.0.0.1");
    assert.equal(await trading.mayClaimIp("old", "10.0.0.1"), true);
    // every address taken: nothing is handed to anyone else (the connect page then says to contact us)
    assert.equal(await trading.assignableIp("another"), null);
    assert.equal(await trading.mayClaimIp("another", "10.0.0.1"), false);
    // the admin's table shows a tunnel's host and port, never a login in its URL
    assert.equal(egress.tunnelLabel("http://u:p@10.9.9.9:8888"), "10.9.9.9:8888");
    assert.deepEqual(egress.houseRoute(), { tunnel: null }); // the house address is this server's own
    process.env.GROWW_HOUSE_PROXY = "http://user:secret@72.60.30.153:8888";
    assert.deepEqual(egress.houseRoute(), { tunnel: "72.60.30.153:8888" }); // another host owns it
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("IST clock matches the research engine's", () => {
  const t = Date.UTC(2026, 10, 20, 3, 50, 30); // 09:20:30 IST
  const n = util.istNow(t);
  assert.equal(n.date, "2026-11-20");
  assert.equal(n.day, Math.floor((t / 1000 + 19800) / 86400));
  assert.ok(Math.abs(n.minute - (9 * 60 + 20.5)) < 1e-9);
  assert.ok(Math.abs(util.istMinuteOfEpoch(t / 1000) - (9 * 60 + 20.5)) < 1e-9);
  assert.equal(util.clock(9 * 60 + 20.99), "09:20");
});

/* ------------------------------------------------- whole-day simulations */
/* The executor's own loop, driven by a fake clock (Date.now) through a fake
 * trading day, against a fake exchange that fills every order at once. */
const realNow = Date.now;
const sim = { now: 0, today: () => null, prices: {}, checks: [], trading: true, blocked: new Set() };
const execMod = load("src/lib/liveTrading/executor.ts", {
  "server-only": {},
  "@/lib/trading": { tradePermission: async (id) => ({ allowed: !sim.blocked.has(id) }) },
  "@/lib/notifications": { notify: async (u, n) => void world.notes.push([u, n]), notifyAdmin: async (n) => void world.notes.push(["admin", n]) },
  "@/lib/consent": { currentConsent: async () => ({ agreementVersion: "3.6" }) },
  "@/lib/auth": { OWNER_ID: "owner" },
  "@/lib/market": { isTradingDate: () => sim.trading },
  "@/lib/research": { liveToday: async () => sim.today(sim.now) },
  "@/lib/api/broker": { houseLtp: async (syms) => Object.fromEntries(syms.filter((x) => sim.prices[x]).map((x) => [x, sim.prices[x]])) },
  "./accounts": {
    accountLabels: async () => new Map(sim.checks.map((c) => [c.id, c.label])),
    checkAccounts: async (settings) => sim.checks.map((c) => ({ ...c, group: settings.excluded.includes(c.id) ? "excluded" : c.group })),
  },
  "./store": store,
  "./orders": orders,
  "./util": util,
});

/** The fake exchange: fills at once at the sim price, books it, moves the position. */
function exchange() {
  broker.placeOrderAs = async (acct, input) => {
    world.places.push([acct, input, sim.now]);
    const px = sim.prices[input.symbol] ?? 100;
    const id = `G${world.places.length}`;
    (world.books[acct] ??= { orders: [], complete: true }).orders.push({ orderId: id, referenceId: input.referenceId, symbol: input.symbol, status: "EXECUTED", qty: input.qty, filled: input.qty, avg: px, remark: null });
    const p = (world.positions[acct] ??= { CASH: [], FNO: [] });
    let row = p.CASH.find((r) => r.symbol === input.symbol && r.product === input.product);
    if (!row) p.CASH.push((row = pos(input.symbol, 0, input.product)));
    row.net += input.side === "BUY" ? input.qty : -input.qty;
    return { ok: true, outcome: "placed", orderId: id, status: "OPEN", filled: 0, message: null, referenceId: input.referenceId, httpStatus: 200 };
  };
}

const IST = 19800;
const at = (day, h, m, s = 0) => (day * 86400 + h * 3600 + m * 60 + s - IST) * 1000;
const sec = (ms) => ms / 1000;

/** Run the loop from `from` to `to` (ms), every 3 s. */
async function runDay(from, to) {
  for (sim.now = from; sim.now <= to; sim.now += 3000) {
    if (sim.onTick) await sim.onTick(sim.now);
    await execMod.step();
  }
}

/** A research timeline: the decision at 09:20:25, optional stop, flip, heartbeats. */
function timeline(day, o) {
  return (nowMs) => {
    const st = { as_of: sec(nowMs), day, date: new Date(day * 86400000).toISOString().slice(0, 10), minute: 0, status: null, skip: null, pick: null, pick_px: null, decided_at: null, late: false, flip: null, mstop: null, mstop_check: null, settled_at: null, last_mark_at: null, book: 500000, mstop_at: 0.005, has_watcher: true };
    if (o.down && nowMs >= o.down[0] && nowMs < o.down[1]) return null;
    const decided = o.decidedAt ?? at(day, 9, 20, 25);
    if (nowMs >= decided) Object.assign(st, { status: "decided", skip: !!o.skip, pick: o.skip ? "AAA" : "AAA", pick_px: 1000, decided_at: sec(decided), late: !!o.late });
    if (o.flip && nowMs >= o.flip.at) Object.assign(st, { status: "flipped", flip: { at: sec(o.flip.at), do: o.flip.do, symbol: o.flip.symbol ?? null, px: 500 } });
    if (o.mstopAt && nowMs >= o.mstopAt) st.mstop = { at: sec(o.mstopAt), bar: 5, move: 0.0061 };
    // heartbeat: every 5-minute close from 09:25 up to `beatsUntil` (or 15:10)
    const until = o.beatsUntil ?? at(day, 15, 10, 3);
    let last = null;
    for (let t = at(day, 9, 25, 3); t <= Math.min(nowMs, until); t += 300000) last = t;
    if (last && nowMs >= decided) st.mstop_check = { at: sec(last), bar: 1, move: 0.001 };
    return st;
  };
}

/** The active (auto) book's trades on a research timeline: open from openAt, closed from closeAt. */
function withActive(tl, list, beatUntil) {
  return (nowMs) => {
    const st = tl(nowMs);
    if (!st) return st;
    st.active_beat = beatUntil !== undefined && nowMs > beatUntil ? sec(beatUntil) : sec(nowMs);
    st.active = list
      // hideFrom: the trade drops out of the list from then on (as an older feed renumbered it after a fresh start)
      .filter((a) => nowMs >= a.openAt && !(a.hideFrom !== undefined && nowMs >= a.hideFrom))
      .map((a) => {
        const closed = a.closeAt !== undefined && nowMs >= a.closeAt;
        return { symbol: a.symbol, side: a.side, status: closed ? "closed" : "open", entered_at: sec(a.openAt), entry: sim.prices[a.symbol] ?? 100, exited_at: closed ? sec(a.closeAt) : null, exit: null, why: closed ? "trailing stop" : null };
      });
    return st;
  };
}

const ACCOUNTS = [
  { id: "owner", label: "House", owner: true, group: "eligible", funds: { cash: 900000, used: 0, free: 900000 } },
  { id: "m1", label: "m1@x", owner: false, group: "eligible", funds: { cash: 600000, used: 0, free: 600000 } },
  { id: "m2", label: "m2@x", owner: false, group: "low", funds: { cash: 100000, used: 0, free: 100000 } },
];
const flat = (acct) => (world.positions[acct]?.CASH ?? []).every((r) => r.net === 0);
const sent = (acct) => world.places.filter(([a]) => a === acct).map(([, i]) => `${i.side} ${i.qty} ${i.symbol}`);

async function scenario(o) {
  await reset();
  exchange();
  Date.now = () => sim.now;
  sim.prices = { AAA: 1000, BBB: 500, CCC: 1000, DDD: 500 };
  sim.checks = ACCOUNTS.map((a) => ({ ...a }));
  await store.setMode(o.mode ?? "live", "test");
  await store.setActiveMode(o.activeMode ?? "off", "test");
  const day = 30000 + (++dayN);
  sim.today = timeline(day, o);
  if (o.active) sim.today = withActive(sim.today, o.active(day), o.activeBeatUntil ? o.activeBeatUntil(day) : undefined);
  sim.onTick = o.onTick ? (t) => o.onTick(t, day) : null;
  try {
    await runDay(o.start ?? at(day, 9, 12), at(day, 15, 32));
    if (o.after) await o.after(day);
  } finally {
    Date.now = realNow;
  }
  return day;
}


const ENTRY = "SELL 498 AAA"; // floor(500000 / (1000 * 1.003))
const COVER = "BUY 498 AAA";
const LONG = "BUY 997 BBB"; // floor(500000 / (500 * 1.003))
const SELL_LONG = "SELL 997 BBB";

function dayOf(next) {
  return 30000 + dayN + next;
}

test("day: entry, market stop, flip buy, 15:15 close — eligible accounts only, flat at the end", async () => {
  const d = dayOf(1);
  await scenario({ mstopAt: at(d, 9, 45, 5), flip: { at: at(d, 10, 16, 10), do: true, symbol: "BBB" } });
  for (const a of ["owner", "m1"]) {
    assert.deepEqual(sent(a), [ENTRY, COVER, LONG, SELL_LONG], a);
    assert.ok(flat(a), `${a} flat`);
  }
  assert.deepEqual(sent("m2"), []); // low balance: nothing
  const t = Object.fromEntries(world.places.filter(([a]) => a === "m1").map(([, i, when]) => [`${i.side} ${i.symbol}`, util.clock(util.istNow(when).minute)]));
  assert.equal(t["SELL AAA"], "09:20");
  assert.equal(t["BUY AAA"], "09:45");
  assert.equal(t["BUY BBB"], "10:16");
  assert.equal(t["SELL BBB"], "15:15");
  const plan = await store.getDay(d, "");
  assert.ok(plan.done.entry && plan.done.stop && plan.done.flipCover && plan.done.flip && plan.done.close);
  assert.deepEqual(plan.accounts.sort(), ["m1", "owner"]);
});

test("day: no flip and no stop — the short is held and bought back at 15:15", async () => {
  const d = dayOf(1);
  await scenario({ flip: { at: at(d, 10, 16, 10), do: false } });
  assert.deepEqual(sent("m1"), [ENTRY, COVER]);
  const when = world.places.filter(([a]) => a === "m1")[1][2];
  assert.equal(util.clock(util.istNow(when).minute), "15:15");
  assert.ok(flat("m1"));
});

test("day: a regime-skip day sends nothing, even with a flip", async () => {
  const d = dayOf(1);
  await scenario({ skip: true, flip: { at: at(d, 10, 16, 10), do: true, symbol: "BBB" } });
  assert.equal(world.places.length, 0);
});

test("day: a flip decided too late still covers the short, buys nothing", async () => {
  const d = dayOf(1);
  await scenario({ flip: { at: at(d, 10, 55, 0), do: true, symbol: "BBB" } });
  assert.deepEqual(sent("m1"), [ENTRY, COVER]);
  const when = world.places.filter(([a]) => a === "m1")[1][2];
  assert.equal(util.clock(util.istNow(when).minute), "10:55");
});

test("day: a silent market-stop watcher gets the short covered as a fail-safe", async () => {
  const d = dayOf(1);
  await scenario({ beatsUntil: at(d, 9, 35, 3) });
  assert.deepEqual(sent("m1"), [ENTRY, COVER]);
  const when = world.places.filter(([a]) => a === "m1")[1][2];
  const m = util.istNow(when).minute;
  assert.ok(m >= 9 * 60 + 47 && m < 9 * 60 + 48, util.clock(m)); // 12 minutes after the 09:35 check
  const plan = await store.getDay(d, "");
  assert.equal(plan.signals.mstop.failsafe, true);
});

test("day: a research outage after the stop does not hold up the cover", async () => {
  const d = dayOf(1);
  // the stop is seen once at 09:45:05, then research is down until 11:00; the fake exchange
  // throttles nothing, so the cover goes out at once
  await scenario({ mstopAt: at(d, 9, 45, 5), down: [at(d, 9, 45, 8), at(d, 11, 0)] });
  assert.deepEqual(sent("m1"), [ENTRY, COVER]);
});

test("day: switched Off at 11:00, nothing new is opened — yet the open short is still closed at 15:15", async () => {
  const d = dayOf(1);
  await scenario({
    flip: { at: at(d, 10, 16, 10), do: false },
    start: at(d, 9, 12),
    after: async () => {},
  });
  // the same day again, Off from 11:00: re-run a fresh day with a mode switch mid-way
  await reset();
  exchange();
  Date.now = () => sim.now;
  const d2 = 30000 + (++dayN);
  sim.today = timeline(d2, { flip: { at: at(d2, 10, 16, 10), do: false } });
  await store.setMode("live", "test");
  try {
    await runDay(at(d2, 9, 12), at(d2, 11, 0));
    await store.setMode("off", "test");
    await runDay(at(d2, 11, 0, 3), at(d2, 15, 32));
  } finally {
    Date.now = realNow;
  }
  // switched off: nothing new — but the short it opened is still bought back at 15:15
  assert.deepEqual(sent("m1"), [ENTRY, COVER]);
  assert.ok(flat("m1"));
});

test("day: a late decision is never entered; the flip is still bought and sold", async () => {
  const d = dayOf(1);
  await scenario({ decidedAt: at(d, 9, 40, 0), late: true, flip: { at: at(d, 10, 16, 10), do: true, symbol: "BBB" } });
  assert.deepEqual(sent("m1"), [LONG, SELL_LONG]);
  assert.ok(flat("m1"));
});

test("day: a market stop that fired before the entry went out means no entry", async () => {
  const d = dayOf(1);
  await scenario({ start: at(d, 9, 26, 0), mstopAt: at(d, 9, 25, 5) });
  assert.deepEqual(sent("m1"), []);
});

test("day: shadow mode works every step out and sends nothing", async () => {
  const d = dayOf(1);
  await scenario({ mode: "shadow", mstopAt: at(d, 9, 45, 5), flip: { at: at(d, 10, 16, 10), do: true, symbol: "BBB" } });
  assert.equal(world.places.length, 0);
  const os = (await store.ordersOfDay(d)).filter((o) => o.accountId === "m1").map((o) => `${o.action}:${o.side} ${o.qty}`);
  assert.deepEqual(os, ["entry:SELL 498", "stop-cover:BUY 498", "flip-long:BUY 997", "close-long:SELL 997"]);
});

test("day: an account whose address stops being sendable gets no flip buy — but its short is still covered", async () => {
  const d = dayOf(1);
  sim.blocked = new Set();
  const orig = sim.today;
  await scenario({
    flip: { at: at(d, 10, 16, 10), do: true, symbol: "BBB" },
    after: async () => {},
  });
  void orig;
  // re-run with m1 blocked from 10:00 (its address removed): no BUY BBB for m1; the flip cover still goes out
  await reset();
  exchange();
  Date.now = () => sim.now;
  const d2 = 30000 + (++dayN);
  sim.today = timeline(d2, { flip: { at: at(d2, 10, 16, 10), do: true, symbol: "BBB" } });
  await store.setMode("live", "test");
  try {
    await runDay(at(d2, 9, 12), at(d2, 10, 0));
    sim.blocked.add("m1");
    await runDay(at(d2, 10, 0, 3), at(d2, 15, 32));
  } finally {
    Date.now = realNow;
    sim.blocked = new Set();
  }
  assert.deepEqual(sent("owner"), [ENTRY, COVER, LONG, SELL_LONG]);
  assert.deepEqual(sent("m1"), [ENTRY, COVER]);
});

test("day: an account offline at the market stop is covered as soon as it reconnects, and told meanwhile", async () => {
  await reset();
  exchange();
  Date.now = () => sim.now;
  const d = 30000 + (++dayN);
  sim.prices = { AAA: 1000, BBB: 500 };
  sim.checks = ACCOUNTS.map((a) => ({ ...a }));
  sim.today = timeline(d, { mstopAt: at(d, 9, 45, 5), flip: { at: at(d, 10, 16, 10), do: false } });
  await store.setMode("live", "test");
  try {
    await runDay(at(d, 9, 12), at(d, 9, 44));
    world.disconnected.add("m1"); // its Groww key goes away just before the stop
    await runDay(at(d, 9, 44, 3), at(d, 9, 52));
    assert.deepEqual(sent("m1"), [ENTRY]);
    assert.deepEqual(sent("owner"), [ENTRY, COVER]);
    assert.ok(world.notes.some(([u, n]) => u === "m1" && /could not close/.test(n.title)), "holder told");
    const mid = await store.getDay(d, "");
    assert.ok(!mid.done.stop, "the stop step stays open for the offline account");
    world.disconnected.delete("m1");
    await runDay(at(d, 9, 52, 3), at(d, 15, 32));
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(sent("m1"), [ENTRY, COVER]);
  const when = world.places.filter(([a]) => a === "m1")[1][2];
  const m = util.istNow(when).minute;
  assert.ok(m >= 9 * 60 + 52 && m < 9 * 60 + 53, util.clock(m)); // right after it came back
  assert.ok(flat("m1") && flat("owner"));
  const plan = await store.getDay(d, "");
  assert.ok(plan.done.stop && plan.done.close);
});

test("day: a holiday or weekend does nothing at all", async () => {
  sim.trading = false;
  try {
    await scenario({});
  } finally {
    sim.trading = true;
  }
  assert.equal(world.places.length, 0);
});

/* ------------------------------------------------- the active (auto) book in the accounts */
const AQ = { owner: 498, m1: 498, m2: 99 }; // CCC at 1000: floor(min(free, 500000) / 1003); m2 has 100000 free
const DQ = { owner: 997, m1: 997, m2: 199 }; // DDD at 500
const act = (acct) => sent(acct).filter((x) => x.endsWith(" CCC") || x.endsWith(" DDD"));
const COVERS = "3.7 · 2026-11-27"; // an agreement version that describes the active book
const signed = (ids) => async (t, day) => {
  if (t === at(day, 9, 12)) for (const c of sim.checks) if (ids.includes(c.id)) c.agreement = COVERS;
};
const timesOf = (acct) => Object.fromEntries(world.places.filter(([a]) => a === acct).map(([, i, when]) => [`${i.side} ${i.symbol}`, util.clock(util.istNow(when).minute)]));

test("active: under agreement 3.6 only the house account takes it; closed when the book closes it, or at 15:15", async () => {
  const d = dayOf(1);
  await scenario({
    activeMode: "live",
    active: (day) => [
      { symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) },
      { symbol: "DDD", side: "short", openAt: at(day, 11, 0, 5) },
    ],
  });
  assert.deepEqual(act("owner"), [`BUY ${AQ.owner} CCC`, `SELL ${AQ.owner} CCC`, `SELL ${DQ.owner} DDD`, `BUY ${DQ.owner} DDD`]);
  assert.deepEqual(act("m1"), []); // a client on 3.6: the agreement does not describe the active book
  assert.deepEqual(act("m2"), []);
  assert.deepEqual(sent("m1").filter((x) => x.endsWith(" AAA")), [ENTRY, COVER]); // Book A untouched
  const t = timesOf("owner");
  assert.equal(t["BUY CCC"], "10:21");
  assert.equal(t["SELL CCC"], "10:40");
  assert.equal(t["SELL DDD"], "11:00");
  assert.equal(t["BUY DDD"], "15:15");
  for (const a of ["owner", "m1", "m2"]) assert.ok(flat(a), `${a} flat`);
  const plan = await store.getDay(d, "");
  assert.ok(plan.active && plan.active.closed[1] && plan.active.closed[2]);
});

test("active: clients whose agreement covers it take part, each sized from its own free money (a low balance trades smaller)", async () => {
  await scenario({
    activeMode: "live",
    onTick: signed(["m1", "m2"]),
    active: (day) => [{ symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) }],
  });
  for (const a of ["owner", "m1", "m2"]) {
    assert.deepEqual(act(a), [`BUY ${AQ[a]} CCC`, `SELL ${AQ[a]} CCC`], a);
    assert.ok(flat(a), `${a} flat`);
  }
  assert.deepEqual(sent("m2").filter((x) => x.endsWith(" AAA")), []); // Book A still keeps low balances out
});

test("active: OFF sends nothing for it (Book A unchanged)", async () => {
  await scenario({ activeMode: "off", active: (day) => [{ symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) }] });
  for (const a of ["owner", "m1", "m2"]) assert.deepEqual(act(a), [], a);
  assert.deepEqual(sent("m1"), [ENTRY, COVER]);
});

test("active: ON while Automatic trading is OFF opens nothing", async () => {
  await scenario({ mode: "off", activeMode: "live", active: (day) => [{ symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) }] });
  assert.equal(world.places.length, 0);
});

test("active: switched OFF with a trade open — that trade is still closed, nothing new is opened", async () => {
  await scenario({
    activeMode: "live",
    active: (day) => [
      { symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) },
      { symbol: "DDD", side: "short", openAt: at(day, 11, 0, 5) },
    ],
    onTick: async (t, day) => {
      if (t >= at(day, 10, 30) && t < at(day, 10, 30) + 3000) await store.setActiveMode("off", "test");
    },
  });
  assert.deepEqual(act("owner"), [`BUY ${AQ.owner} CCC`, `SELL ${AQ.owner} CCC`]);
  assert.ok(flat("owner"));
});

test("active: a trade seen too long after it opened is not followed; the next one is", async () => {
  await scenario({
    activeMode: "off",
    active: (day) => [
      { symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) },
      { symbol: "DDD", side: "short", openAt: at(day, 11, 0, 5) },
    ],
    onTick: async (t, day) => {
      if (t >= at(day, 10, 30) && t < at(day, 10, 30) + 3000) await store.setActiveMode("live", "test");
    },
  });
  assert.deepEqual(act("owner"), [`SELL ${DQ.owner} DDD`, `BUY ${DQ.owner} DDD`]);
  assert.ok(flat("owner"));
});

test("active: an account below the minimum, or blocked, takes no part", async () => {
  sim.blocked.add("m1");
  try {
    await scenario({
      activeMode: "live",
      onTick: async (t, day) => {
        await signed(["m1", "m2"])(t, day);
        if (t === at(day, 9, 12)) sim.checks.find((c) => c.id === "m2").funds = { cash: 5000, used: 0, free: 5000 };
      },
      active: (day) => [{ symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) }],
    });
  } finally {
    sim.blocked.delete("m1");
  }
  assert.deepEqual(act("owner"), [`BUY ${AQ.owner} CCC`, `SELL ${AQ.owner} CCC`]);
  assert.deepEqual(act("m1"), []); // its order address no longer works: the gate holds it back
  assert.deepEqual(act("m2"), []); // ₹5,000 free: below the minimum
});

test("active: never Book A's own name (the two would net out in one position)", async () => {
  await scenario({ activeMode: "live", active: (day) => [{ symbol: "AAA", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) }] });
  assert.deepEqual(sent("owner"), [ENTRY, COVER]);
});

test("active: the book falls silent with a position open — the position is closed as a fail-safe 5 minutes later", async () => {
  await scenario({
    activeMode: "live",
    active: (day) => [{ symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26) }],
    activeBeatUntil: (day) => at(day, 11, 0),
  });
  const t = timesOf("owner");
  assert.equal(t["BUY CCC"], "10:21");
  assert.equal(t["SELL CCC"], "11:05");
  assert.ok(flat("owner"));
});

test("active: an exit Groww keeps refusing is given up, then tried afresh at 15:15", async () => {
  let reject = false;
  await scenario({
    activeMode: "live",
    active: (day) => [{ symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) }],
    onTick: async (t, day) => {
      reject = t >= at(day, 10, 40) && t < at(day, 15, 0);
      if (t === at(day, 9, 12)) {
        const real = broker.placeOrderAs;
        broker.placeOrderAs = async (acct, input) =>
          reject && input.symbol === "CCC" && input.side === "SELL"
            ? (world.places.push([acct, { ...input, rejected: true }, sim.now]), { ok: false, outcome: "rejected", orderId: null, status: null, filled: null, message: "RMS", httpStatus: 400 })
            : real(acct, input);
      }
    },
  });
  const mine = world.places.filter(([a, i]) => a === "owner" && i.symbol === "CCC");
  assert.equal(mine.filter(([, i]) => i.rejected).length, 3); // the book's exit: three tries, then given up
  const last = mine[mine.length - 1];
  assert.equal(`${last[1].side} ${last[1].qty}`, "SELL 498");
  assert.equal(util.clock(util.istNow(last[2]).minute), "15:15"); // tried afresh at 15:15, and done
  assert.ok(flat("owner"));
});

test("active: matched by symbol and entry time, not place in the list — a renumbered list drops nothing", async () => {
  const d = dayOf(1);
  await scenario({
    activeMode: "live",
    active: (day) => [
      { symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10), hideFrom: at(day, 10, 45) },
      { symbol: "DDD", side: "short", openAt: at(day, 11, 0, 5), closeAt: at(day, 11, 40, 10) },
    ],
  });
  const t = timesOf("owner");
  assert.equal(t["BUY CCC"], "10:21");
  assert.equal(t["SELL CCC"], "10:40");
  assert.equal(t["SELL DDD"], "11:00"); // first in the list now, yet the accounts' trade 2 — not taken for trade 1
  assert.equal(t["BUY DDD"], "11:40"); // closed when the book closed it
  assert.ok(flat("owner"));
  const plan = await store.getDay(d, "");
  assert.equal(plan.active.opened[1].symbol, "CCC");
  assert.equal(plan.active.opened[2].symbol, "DDD");
});

test("active: an open trade that drops out of the list is still closed at 15:15, and nothing opens on top of it", async () => {
  await scenario({
    activeMode: "live",
    active: (day) => [
      { symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), hideFrom: at(day, 10, 30) },
      { symbol: "DDD", side: "short", openAt: at(day, 11, 0, 5), closeAt: at(day, 11, 40, 10) },
    ],
  });
  assert.equal(timesOf("owner")["SELL CCC"], "15:15");
  assert.deepEqual(sent("owner").filter((x) => x.endsWith(" DDD")), []);
  assert.ok(flat("owner"));
});

test("active: an exit once begun is carried through a research outage (not left to the fail-safe)", async () => {
  let rejected = 0;
  await scenario({
    activeMode: "live",
    active: (day) => [{ symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) }],
    onTick: async (t, day) => {
      if (t === at(day, 9, 12)) {
        const real = broker.placeOrderAs;
        broker.placeOrderAs = async (acct, input) =>
          input.symbol === "CCC" && input.side === "SELL" && rejected++ === 0
            ? (world.places.push([acct, { ...input, rejected: true }, sim.now]), { ok: false, outcome: "rejected", orderId: null, status: null, filled: null, message: "RMS", httpStatus: 400 })
            : real(acct, input);
        // the research engine goes down just after the first try of the book's exit, for 50 minutes
        const tl = sim.today;
        sim.today = (ms) => (ms > at(day, 10, 40, 12) && ms < at(day, 11, 30) ? null : tl(ms));
      }
    },
  });
  const sells = world.places.filter(([a, i]) => a === "owner" && i.symbol === "CCC" && i.side === "SELL");
  assert.equal(sells.length, 2);
  assert.ok(sells[0][1].rejected);
  assert.equal(util.clock(util.istNow(sells[1][2]).minute), "10:40"); // retried 12 s later, in the outage
  assert.ok(flat("owner"));
});

test("active: one at a time — the next trade waits for the previous one's close in the accounts", async () => {
  await scenario({
    activeMode: "live",
    active: (day) => [
      { symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) },
      { symbol: "DDD", side: "short", openAt: at(day, 10, 40, 10) }, // the same scan exits CCC and opens DDD
    ],
  });
  const mine = world.places.filter(([a, i]) => a === "owner" && (i.symbol === "CCC" || i.symbol === "DDD"));
  assert.deepEqual(mine.map(([, i]) => `${i.side} ${i.symbol}`), ["BUY CCC", "SELL CCC", "SELL DDD", "BUY DDD"]);
  assert.ok(mine[2][2] > mine[1][2], "DDD sent after CCC's close");
  assert.equal(util.clock(util.istNow(mine[2][2]).minute), "10:40");
  assert.ok(flat("owner"));
});

test("active: an exit that failed holds back the next trade (one at a time) until 15:15 closes it", async () => {
  let reject = false;
  await scenario({
    activeMode: "live",
    active: (day) => [
      { symbol: "CCC", side: "long", openAt: at(day, 10, 21, 26), closeAt: at(day, 10, 40, 10) },
      { symbol: "DDD", side: "short", openAt: at(day, 11, 0, 5) },
    ],
    onTick: async (t, day) => {
      reject = t >= at(day, 10, 40) && t < at(day, 15, 0);
      if (t === at(day, 9, 12)) {
        const real = broker.placeOrderAs;
        broker.placeOrderAs = async (acct, input) =>
          reject && input.symbol === "CCC" && input.side === "SELL"
            ? (world.places.push([acct, { ...input, rejected: true }, sim.now]), { ok: false, outcome: "rejected", orderId: null, status: null, filled: null, message: "RMS", httpStatus: 400 })
            : real(acct, input);
      }
    },
  });
  assert.deepEqual(sent("owner").filter((x) => x.endsWith(" DDD")), []); // never opened on top of the unclosed CCC
  assert.equal(timesOf("owner")["SELL CCC"], "15:15");
  assert.ok(flat("owner"));
});

test("active: at most four a day in the accounts; a trade not followed takes none of the four", async () => {
  await scenario({
    activeMode: "live",
    onTick: async (t, day) => {
      if (t === at(day, 9, 12)) Object.assign(sim.prices, { EEE: 1000, FFF: 1000, GGG: 1000 });
    },
    active: (day) => [
      { symbol: "AAA", side: "long", openAt: at(day, 10, 0, 5), closeAt: at(day, 10, 10, 5) }, // Book A's name: not followed
      ...["CCC", "DDD", "EEE", "FFF", "GGG"].map((symbol, i) => ({ symbol, side: "long", openAt: at(day, 10, 20 + 20 * i, 5), closeAt: at(day, 10, 30 + 20 * i, 5) })),
    ],
  });
  const mine = sent("owner").filter((x) => !x.endsWith(" AAA") && !x.endsWith(" BBB"));
  assert.deepEqual(mine.map((x) => x.split(" ")[0] + " " + x.split(" ")[2]), ["BUY CCC", "SELL CCC", "BUY DDD", "SELL DDD", "BUY EEE", "SELL EEE", "BUY FFF", "SELL FFF"]);
  assert.deepEqual(sent("owner").filter((x) => x.endsWith(" AAA")), [ENTRY, COVER]); // Book A untouched
  assert.ok(flat("owner"));
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${e && e.stack ? e.stack.split("\n").slice(0, 12).join("\n     ") : e}`);
    }
  }
  console.log(failed ? `${failed} failed` : `all ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
