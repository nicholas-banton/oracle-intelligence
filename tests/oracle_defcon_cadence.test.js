"use strict";
// Regression tests for the Oracle v1 DEFCON alert cadence and the directive-history freeze.
// Run: node tests/oracle_defcon_cadence.test.js
// Requires oracle.js to be require()-able, which is why boot() is guarded by require.main.
const assert = require("assert");
const {
  checkSentinel,
  isRepeatStandingAlert,
  updateDirectiveHistory,
  countConsecutiveSameDirective,
  buildOracleContextPayload,
  STANDING_REMINDER_MS,
} = require("../oracle");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// N consecutive daily directive entries, dated in the past so updateDirectiveHistory appends.
function hist(days, directive = "DEFENSIVE") {
  const out = [];
  const d0 = Date.parse("2026-01-01T12:00:00Z");
  for (let i = 0; i < days; i++) {
    out.push({ date: new Date(d0 + i * DAY).toISOString().slice(0, 10), directive, regime: "neutral" });
  }
  return out;
}

let passed = 0;
function t(name, fn) { fn(); passed++; console.log("  PASS  " + name); }

(async () => {
  console.log("Oracle DEFCON cadence + directive-history tests\n");

  // ── Fix A — the directive history must advance (frozen-counter defect) ──────────────
  console.log("Fix A: directive-history freeze");

  t("countConsecutiveSameDirective counts trailing matching days", () => {
    assert.equal(countConsecutiveSameDirective(hist(7), { directive: "DEFENSIVE" }), 7);
    assert.equal(countConsecutiveSameDirective([...hist(3), { date: "2026-01-04", directive: "BALANCED" }], { directive: "BALANCED" }), 1);
    assert.equal(countConsecutiveSameDirective(hist(7), { directive: "OTHER" }), 0);
  });

  t("updateDirectiveHistory appends a new trading day", () => {
    const updated = updateDirectiveHistory(hist(7), { directive: "DEFENSIVE", regime: "neutral" });
    assert.equal(updated.length, 8);
    assert.equal(countConsecutiveSameDirective(updated, { directive: "DEFENSIVE" }), 8);
  });

  t("updateDirectiveHistory replaces (not duplicates) the same day", () => {
    const once = updateDirectiveHistory(hist(7), { directive: "DEFENSIVE", regime: "neutral" });
    const twice = updateDirectiveHistory(once, { directive: "DEFENSIVE", regime: "neutral" });
    assert.equal(twice.length, once.length);
  });

  t("updateDirectiveHistory caps the history at 14 entries", () => {
    assert.ok(updateDirectiveHistory(hist(20), { directive: "DEFENSIVE" }).length <= 14);
  });

  t("REGRESSION: the DEFCON write now persists the updated history (was: stale copy)", () => {
    const existingCtx = {
      directiveHistory: hist(7),
      defconKey: "same_directive:DEFENSIVE",
      activeSince: new Date().toISOString(),
    };
    const directiveHistory = updateDirectiveHistory(existingCtx.directiveHistory, { directive: "DEFENSIVE" });
    assert.equal(directiveHistory.length, 8, "in-memory history advanced");

    // The old DEFCON payload omitted directiveHistory, so writeOracleContext carried the stale
    // 7-entry copy forward — the day's new entry was silently discarded every cycle.
    const oldPayload = buildOracleContextPayload({ defconLevel: 2, defconTrigger: "x" }, existingCtx);
    assert.equal(oldPayload.directiveHistory.length, 7, "old shape preserved the stale history (the bug)");

    // The fixed DEFCON payload includes it, and ctx overrides the carried-forward copy.
    const newPayload = buildOracleContextPayload({ defconLevel: 2, directiveHistory }, existingCtx);
    assert.equal(newPayload.directiveHistory.length, 8, "new shape persists the updated history");
  });

  // ── Fix B — standing-condition alert de-duplication ─────────────────────────────────
  console.log("\nFix B: standing-alert de-duplication");

  const key = "same_directive:DEFENSIVE";

  t("event trigger (no key) is never suppressed by this rule", () => {
    assert.equal(isRepeatStandingAlert({ level: "DEFCON2", reason: "VIX crossed 25" },
      { defconKey: key, activeSince: new Date().toISOString() }), false);
  });

  t("first appearance of a standing condition alerts", () => {
    assert.equal(isRepeatStandingAlert({ key }, { defconKey: null }), false);
  });

  t("same standing condition inside the window is suppressed", () => {
    assert.equal(isRepeatStandingAlert({ key },
      { defconKey: key, activeSince: new Date(Date.now() - 5 * HOUR).toISOString() }), true);
  });

  t("a changed directive re-arms the alert", () => {
    assert.equal(isRepeatStandingAlert({ key: "same_directive:REDUCED_RISK" },
      { defconKey: key, activeSince: new Date().toISOString() }), false);
  });

  t("a cleared condition (baseline reset) re-arms the alert", () => {
    assert.equal(isRepeatStandingAlert({ key },
      { defconKey: null, activeSince: new Date().toISOString() }), false);
  });

  t("one reminder is sent after the window elapses", () => {
    assert.equal(isRepeatStandingAlert({ key },
      { defconKey: key, activeSince: new Date(Date.now() - STANDING_REMINDER_MS - HOUR).toISOString() }), false);
  });

  t("missing activeSince alerts rather than staying silent", () => {
    assert.equal(isRepeatStandingAlert({ key }, { defconKey: key }), false);
  });

  // ── trigger identity ───────────────────────────────────────────────────────────────
  console.log("\ntrigger identity");

  const base = { vix: null, account: null, journal: { trades: [] } };

  t("standing trigger key is stable while the day count grows", async () => {
    const seven = await checkSentinel({ ...base, directive: { directive: "DEFENSIVE" }, directiveHistory: hist(7) });
    const twelve = await checkSentinel({ ...base, directive: { directive: "DEFENSIVE" }, directiveHistory: hist(12) });
    const a = seven.find(x => x.key);
    const b = twelve.find(x => x.key);
    assert.ok(a && b, "both should produce a keyed standing trigger");
    assert.equal(a.key, b.key, "key must NOT include the growing day count");
    assert.notEqual(a.reason, b.reason, "reason should still report the true day count");
  });

  t("event triggers carry no standing key", async () => {
    const trig = await checkSentinel({ ...base, vix: { current: 26, previous: 24, changePct: 4 }, directive: null, directiveHistory: [] });
    const ev = trig.find(x => x.level === "DEFCON2");
    assert.ok(ev, "VIX crossing 25 should raise DEFCON2");
    assert.equal(ev.key, undefined);
  });

  console.log(`\nOracle DEFCON cadence tests: PASS (${passed} checks)`);
})().catch(e => { console.error("\nOracle DEFCON cadence tests: FAIL\n" + (e.stack || e.message)); process.exit(1); });
