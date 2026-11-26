#!/usr/bin/env node
/**
 * Tests for the day-by-day P&L working-out behind /admin/vivek/[id] (src/lib/balanceDays.ts).
 *
 *   node scripts/test-balances.cjs
 *
 * Needs node_modules (it loads the TypeScript source with jiti), so run it where the app is installed.
 */
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const jiti = createJiti(__filename, { alias: { "@": path.join(__dirname, "..", "src") } });
const { dayLines, istDate, windowOf } = jiti(path.join(__dirname, "..", "src", "lib", "balanceDays.ts"));

const at = (iso) => Date.parse(`${iso}+05:30`); // an IST wall-clock time
const row = (iso, cash, realised = null, why = "watch") => ({ userId: "u1", at: at(iso), cash, used: 0, realised, why });
const byDate = (lines) => Object.fromEntries(lines.map((l) => [l.date, l]));
let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`ok ${n} - ${name}`);
};

test("IST date and the three parts of a day", () => {
  assert.equal(istDate(at("2026-11-26T00:10:00")), "2026-11-26");
  assert.equal(istDate(at("2026-11-26T23:59:00")), "2026-11-26");
  assert.equal(windowOf(at("2026-11-26T09:14:00")), "2026-11-26:am");
  assert.equal(windowOf(at("2026-11-26T09:15:00")), "2026-11-26:mkt");
  assert.equal(windowOf(at("2026-11-26T15:29:00")), "2026-11-26:mkt");
  assert.equal(windowOf(at("2026-11-26T15:30:00")), "2026-11-26:pm");
});

test("no readings: no days", () => {
  assert.deepEqual(dayLines([], at("2026-11-26T18:00:00")), []);
});

const seed = row("2026-11-26T09:00:00", 500135.05, null, "seed");

test("the day itself, after the close, before Groww settles it", () => {
  const rows = [seed, row("2026-11-26T17:00:00", 500135.05, -3000)];
  const d = byDate(dayLines(rows, at("2026-11-26T18:00:00")));
  assert.deepEqual(Object.keys(d), ["2026-11-26"]);
  assert.equal(d["2026-11-26"].start, 500135.05);
  assert.equal(d["2026-11-26"].end, null);
  assert.equal(d["2026-11-26"].pnl, null);
  assert.equal(d["2026-11-26"].realised, -3000);
});

test("settled overnight: the day's P&L is the change, the next day starts from it", () => {
  const rows = [seed, row("2026-11-26T17:00:00", 500135.05, -3000), row("2026-11-27T02:00:00", 496000)];
  const d = byDate(dayLines(rows, at("2026-11-27T08:00:00")));
  assert.equal(d["2026-11-26"].end, 496000);
  assert.equal(d["2026-11-26"].pnl, -4135.05);
  assert.equal(d["2026-11-27"].start, 496000);
  assert.equal(d["2026-11-27"].end, null);
});

test("settled during the next session: still that day's, read at the next close", () => {
  const rows = [seed, row("2026-11-26T17:00:00", 500135.05), row("2026-11-27T08:45:00", 500135.05), row("2026-11-27T10:00:00", 502000)];
  const d = byDate(dayLines(rows, at("2026-11-27T16:00:00")));
  assert.equal(d["2026-11-26"].end, 502000);
  assert.equal(d["2026-11-26"].pnl, 1864.95);
  // the 27th started from the settled balance (in effect at its close)
  assert.equal(d["2026-11-27"].start, 502000);
});

test("a day with no change: P&L 0 once the next close has passed", () => {
  const rows = [seed, row("2026-11-26T17:00:00", 500135.05), row("2026-11-27T08:45:00", 500135.05)];
  const d = byDate(dayLines(rows, at("2026-11-27T16:00:00")));
  assert.equal(d["2026-11-26"].end, 500135.05);
  assert.equal(d["2026-11-26"].pnl, 0);
});

test("weekends and listed holidays are skipped; Friday settles by Monday's close", () => {
  // Fri 20 Nov, Mon 23 Nov, (Tue 24 Nov is a holiday), Wed 25 Nov
  const rows = [row("2026-11-20T09:00:00", 1000), row("2026-11-21T01:00:00", 1100), row("2026-11-24T12:00:00", 1100), row("2026-11-25T01:00:00", 1150)];
  const lines = dayLines(rows, at("2026-11-25T16:00:00"));
  assert.deepEqual(lines.map((l) => l.date), ["2026-11-25", "2026-11-23", "2026-11-20"]);
  const d = byDate(lines);
  assert.equal(d["2026-11-20"].pnl, 100);
  // Monday's settlement landed on Wednesday at 01:00 (the holiday in between): still Monday's
  assert.equal(d["2026-11-23"].start, 1100);
  assert.equal(d["2026-11-23"].end, 1150);
  assert.equal(d["2026-11-23"].pnl, 50);
});

test("the first reading after a close: that day has no start", () => {
  const rows = [row("2026-11-26T17:00:00", 500135.05)];
  const d = byDate(dayLines(rows, at("2026-11-26T18:00:00")));
  assert.equal(d["2026-11-26"].start, null);
  assert.equal(d["2026-11-26"].pnl, null);
});

test("realised P&L: the last reading after the close, else the last of the day", () => {
  const rows = [seed, row("2026-11-26T12:00:00", 500135.05, 900), row("2026-11-26T16:00:00", 500135.05, 1200), row("2026-11-26T22:00:00", 500135.05, 1250)];
  assert.equal(byDate(dayLines(rows, at("2026-11-26T23:00:00")))["2026-11-26"].realised, 1250);
  const noon = [seed, row("2026-11-26T12:00:00", 500135.05, 900)];
  assert.equal(byDate(dayLines(noon, at("2026-11-26T13:00:00")))["2026-11-26"].realised, 900);
});

console.log(`\n${n} tests passed`);
