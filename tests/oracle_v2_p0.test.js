"use strict";
// Oracle v2 Shadow — P0 integrity corrections regression tests.
// Run: node tests/oracle_v2_p0.test.js
//
// P0-1 null-safe independent market read
// P0-2 null-preserving derived spreads
// P0-3 immutable completed-phase evidence across restart/bootstrap
// P0-4 residual null-coercion paths (VIX / rolling vol / correlation / forward outcome)
const assert = require("assert");
const { independentMarketRead, buildMarketMetrics, rollingVol, correlation, scoreMatureJudgments } = require("../v2/analytics");
const { buildBootstrapRecord, hasCompletedPhase } = require("../oracle_v2");
const { upsertRecord } = require("../v2/ledger");

const results = [];
function t(name, fn) {
  try { fn(); results.push([true, name]); console.log("  PASS  " + name); }
  catch (e) { results.push([false, name]); console.log("  FAIL  " + name + "\n        " + (e.message || e)); }
}

function series(n, start = 100, rate = 0.001) {
  const out = []; let v = start;
  for (let i = 0; i < n; i++) { out.push({ close: v }); v *= (1 + rate); }
  return out;
}
const LONG = () => series(70);
const SHORT = () => series(3);           // too short -> returnOver(...) === null
const FLAT = () => series(70, 100, 0);   // genuine 0% return, a VALID observation
function market(over = {}) {
  return {
    QQQ: LONG(), SPY: LONG(), RSP: LONG(), IWM: LONG(), HYG: LONG(), TLT: LONG(),
    GLD: LONG(), SLV: LONG(), VIX: series(70, 15), TNX: series(70, 5),
    ...over,
  };
}

// Fully populated metrics mirroring the persisted Sept 24 shape (score 3.44 / supportive / 0.69).
const POP = { qqq20: 4.29, spy20: 0.39, equalWeightVsSpy5: -1.91, smallCapsVsSpy5: -2.17, creditVsDuration5: 1.83, vix: 15.67, qqqVol20: 16.52 };

console.log("Oracle v2 P0 corrections\n");
console.log("P0-1 null-safe independent market read");

t("qqq20 = null does not crash", () => {
  const r = independentMarketRead({ ...POP, qqq20: null });
  assert.equal(r.structure, "mixed");
  assert.equal(r.score, 2.19, "null qqq20 must make NO contribution (3.44 - 1.25)");
});

t("spy20 = null does not crash", () => {
  const r = independentMarketRead({ ...POP, spy20: null });
  assert.equal(r.score, 2.69, "null spy20 must make NO contribution (3.44 - 0.75)");
});

t("qqqVol20 = null does not crash", () => {
  const r = independentMarketRead({ ...POP, qqqVol20: null });
  assert.equal(r.score, 2.99, "null qqqVol20 must make NO contribution (3.44 - 0.45)");
});

t("missing derived scored inputs do not crash (equalWeight / smallCaps / credit)", () => {
  const r = independentMarketRead({ ...POP, equalWeightVsSpy5: null, smallCapsVsSpy5: null, creditVsDuration5: null });
  // 3.44 = 1.25 + 0.75 - 0.52 - 0.39 + 0.9 + 1.0 + 0.45; dropping the three spread terms leaves 1.25 + 0.75 + 1.0 + 0.45
  assert.equal(r.score, 3.45);
});

t("raw null vix does not crash", () => {
  const r = independentMarketRead({ ...POP, vix: null });
  assert.equal(r.score, 2.44, "null vix must make NO contribution (3.44 - 1.0)");
});

t("all scored inputs null does not crash and yields a neutral read", () => {
  const r = independentMarketRead({ qqq20: null, spy20: null, equalWeightVsSpy5: null, smallCapsVsSpy5: null, creditVsDuration5: null, vix: null, qqqVol20: null });
  assert.equal(r.score, 0);
  assert.equal(r.structure, "mixed");
  assert.equal(r.confidence, 0.45);
  assert.equal(r.evidence.length, 0);
  assert.equal(r.counterEvidence.length, 0);
});

t("a genuine 0 is a VALID observation, distinct from null", () => {
  const zero = independentMarketRead({ ...POP, qqq20: 0 });
  const nil = independentMarketRead({ ...POP, qqq20: null });
  assert.equal(zero.score, 1.38, "0 > 0 is false -> contributes -1.25 * 0.65");
  assert.notEqual(zero.score, nil.score, "null must be neutral, zero must be measured");
});

t("fully populated inputs preserve existing score behaviour", () => {
  const r = independentMarketRead(POP);
  assert.equal(r.score, 3.44);
  assert.equal(r.confidence, 0.69);
  assert.equal(r.structure, "supportive");
  assert.equal(r.evidence.length, 5);
  assert.equal(r.counterEvidence.length, 2);
});

console.log("\nP0-2 null-preserving derived spreads");

const SPREADS = [
  { name: "qqqVsSpy5", first: "QQQ", second: "SPY", secondMetric: "spy5" },
  { name: "equalWeightVsSpy5", first: "RSP", second: "SPY", secondMetric: "spy5" },
  { name: "smallCapsVsSpy5", first: "IWM", second: "SPY", secondMetric: "spy5" },
  { name: "creditVsDuration5", first: "HYG", second: "TLT", secondMetric: "tlt5" },
];

for (const s of SPREADS) {
  t(`${s.name}: first leg (${s.first}) null -> null`, () => {
    assert.strictEqual(buildMarketMetrics(market({ [s.first]: SHORT() }))[s.name], null);
  });
  t(`${s.name}: second leg (${s.second}) null -> null`, () => {
    assert.strictEqual(buildMarketMetrics(market({ [s.second]: SHORT() }))[s.name], null);
  });
  t(`${s.name}: both legs null -> null`, () => {
    assert.strictEqual(buildMarketMetrics(market({ [s.first]: SHORT(), [s.second]: SHORT() }))[s.name], null);
  });
  t(`${s.name}: genuine 0 first leg + valid second -> real arithmetic`, () => {
    const m = buildMarketMetrics(market({ [s.first]: FLAT() }));
    assert(Number.isFinite(m[s.name]), "must be a real number, not null");
    assert(Math.abs(m[s.name] - (0 - m[s.secondMetric])) < 1e-9, `${m[s.name]} should equal 0 - ${m[s.secondMetric]}`);
  });
  t(`${s.name}: two valid legs -> real arithmetic`, () => {
    assert(Number.isFinite(buildMarketMetrics(market())[s.name]));
  });
}

t("REGRESSION: the audited example (rsp5 null, spy5 real) yields null, never -spy5", () => {
  const m = buildMarketMetrics(market({ RSP: SHORT() }));
  assert.strictEqual(m.rsp5, null, "RSP too short -> rsp5 null");
  assert(Number.isFinite(m.spy5), "spy5 is a real measurement");
  assert.strictEqual(m.equalWeightVsSpy5, null, "must be null, NOT -spy5");
});

t("END-TO-END: absent RSP/IWM/HYG/TLT cannot generate fabricated evidence", () => {
  const m = buildMarketMetrics(market({ RSP: SHORT(), IWM: SHORT(), HYG: SHORT(), TLT: SHORT() }));
  assert.strictEqual(m.equalWeightVsSpy5, null);
  assert.strictEqual(m.smallCapsVsSpy5, null);
  assert.strictEqual(m.creditVsDuration5, null);
  const r = independentMarketRead(m);
  const all = r.evidence.concat(r.counterEvidence).join(" | ");
  assert(!/Breadth/.test(all), "no fabricated breadth evidence: " + all);
  assert(!/Small-cap/.test(all), "no fabricated small-cap evidence: " + all);
  assert(!/Credit/.test(all), "no fabricated credit evidence: " + all);
  assert.equal(r.evidence.length + r.counterEvidence.length, 4, "only the 4 genuinely measured inputs contribute (qqq20, spy20, vix, qqqVol20)");
});

console.log("\nP0-3 immutable completed-phase evidence");

const PRE_READ = { structure: "supportive", score: 3.44, confidence: 0.69, evidence: ["pre-open evidence"], counterEvidence: [] };
const BOOT_READ = { structure: "mixed", score: -0.5, confidence: 0.48, evidence: ["boot evidence"], counterEvidence: [] };
const PRE_ONLY = { id: "2026-09-24", preopen: { completedAt: "2026-09-24T12:38:40.670Z", independentBeforeSavant: true }, independentRead: PRE_READ, marketMetrics: { qqq20: 4.3987 }, market: { QQQ: { close: 111 } } };
const BASE = { id: "2026-09-24", asOf: "2026-09-24T21:24:25Z", independentRead: BOOT_READ, marketMetrics: { qqq20: 4.2878 }, market: { QQQ: { close: 222 } }, account: { equity: 1, lastEquity: 2 }, oracleVersion: "2.0.0-shadow", mode: "shadow_advisory" };

t("initial bootstrap (no existing record) fills evidence normally", () => {
  const rec = buildBootstrapRecord({}, BASE, "2026-09-24T07:00:00Z");
  assert.deepStrictEqual(rec.independentRead, BOOT_READ);
  assert.deepStrictEqual(rec.marketMetrics, { qqq20: 4.2878 });
  assert.equal(rec.bootstrap.note, "Initial evidence snapshot; not a scheduled pre-open judgment.");
});

t("restart BEFORE pre-open completion still gap-fills", () => {
  const existing = { id: "2026-09-24", bootstrap: { completedAt: "2026-09-24T07:00:00Z" } };
  const rec = buildBootstrapRecord(existing, BASE, "2026-09-24T08:00:00Z");
  assert.deepStrictEqual(rec.independentRead, BOOT_READ, "no phase completed -> boot data may fill");
  assert.equal(hasCompletedPhase(existing), false);
});

t("restart AFTER pre-open preserves the frozen pre-open read", () => {
  const rec = buildBootstrapRecord(PRE_ONLY, BASE, "2026-09-24T21:24:25Z");
  assert.deepStrictEqual(rec.independentRead, PRE_READ, "original pre-open read must survive");
  assert.deepStrictEqual(rec.marketMetrics, { qqq20: 4.3987 }, "pre-open metrics must survive");
  assert.deepStrictEqual(rec.market, { QQQ: { close: 111 } }, "pre-open market snapshot must survive");
  assert.equal(rec.preopen.completedAt, "2026-09-24T12:38:40.670Z", "pre-open completion timestamp unchanged");
  assert.equal(hasCompletedPhase(PRE_ONLY), true);
});

t("restart after pre-open may still fill genuinely-missing fields", () => {
  const rec = buildBootstrapRecord(PRE_ONLY, BASE, "2026-09-24T21:24:25Z");
  assert.deepStrictEqual(rec.account, { equity: 1, lastEquity: 2 }, "absent account may be filled");
  assert.equal(rec.bootstrap.completedAt, "2026-09-24T21:24:25Z", "bootstrap marker is the boot's own field");
});

t("restart after AUDIT or CLOSE also freezes phase evidence", () => {
  for (const phase of [{ auditCompletedAt: "x" }, { closeCompletedAt: "x" }]) {
    const rec = buildBootstrapRecord({ ...PRE_ONLY, preopen: undefined, ...phase }, BASE, "z");
    assert.deepStrictEqual(rec.independentRead, PRE_READ, `${Object.keys(phase)[0]} must freeze evidence`);
  }
});

t("no duplicate daily record is created by the restart", () => {
  const ledger = [{ id: "2026-09-23" }, PRE_ONLY];
  const rec = buildBootstrapRecord(PRE_ONLY, BASE, "2026-09-24T21:24:25Z");
  const next = upsertRecord(ledger, rec);
  assert.equal(next.length, 2, "still one record per day");
  assert.equal(next.filter(x => x.id === "2026-09-24").length, 1);
});

t("frozen record still preserves the pre-open evidence strings verbatim", () => {
  const rec = buildBootstrapRecord(PRE_ONLY, BASE, "z");
  assert.deepStrictEqual(rec.independentRead.evidence, ["pre-open evidence"]);
});

console.log("\nP0-4 residual null-coercion paths (VIX / rolling vol / correlation / forward outcome)");

function withLastClose(s, close) { const out = s.slice(); out[out.length - 1] = { close }; return out; }
// A deterministic series with genuinely varying (but small) returns, so volatility and
// correlation are non-degenerate. A manufacturing bug injects a -100% step and stands out.
function wobble(n) {
  const out = [{ close: 100 }]; let v = 100;
  for (let i = 1; i < n; i++) { v *= (1 + (i % 2 ? 0.002 : -0.001)); out.push({ close: v }); }
  return out;
}
function judgedRows() {
  const rows = [];
  for (let i = 0; i < 7; i++) {
    rows.push({ id: `d${i}`, asOf: `2026-01-0${i + 1}`, market: { QQQ: { close: 100 + i } }, audit: { challengeType: "possible_excessive_defensiveness" } });
  }
  return rows;
}

t("latest VIX close null -> buildMarketMetrics().vix is null (never numeric 0)", () => {
  const m = buildMarketMetrics(market({ VIX: withLastClose(series(70, 15), null) }));
  assert.strictEqual(m.vix, null, "an unavailable VIX must stay null, not become numeric 0");
});

t("null latest VIX emits NO VIX evidence or counter-evidence", () => {
  const full = independentMarketRead(buildMarketMetrics(market()));
  const r = independentMarketRead(buildMarketMetrics(market({ VIX: withLastClose(series(70, 15), null) })));
  const all = r.evidence.concat(r.counterEvidence).join(" | ");
  assert(!/VIX/i.test(all), "no fabricated VIX evidence: " + all);
  assert.equal(Number((full.score - r.score).toFixed(2)), 1.0, "null VIX must make NO contribution (3.44 - 1.0)");
});

t("genuine numeric VIX 0 stays exactly 0 and is NOT treated as missing", () => {
  const full = independentMarketRead(buildMarketMetrics(market()));
  const m = buildMarketMetrics(market({ VIX: withLastClose(series(70, 15), 0) }));
  assert.strictEqual(m.vix, 0, "a real 0 is a valid measurement, distinct from null");
  const r = independentMarketRead(m);
  assert(r.evidence.some(x => /VIX is below acute-stress territory \(0\.0\)/.test(x)), "0 is measured and reaches the low-VIX branch: " + r.evidence.join(" | "));
  assert.equal(r.score, full.score, "a genuine 0 VIX contributes exactly like the measured low VIX");
});

t("rollingVol: a null close does NOT manufacture a -100% return", () => {
  const base = wobble(30);
  const holed = wobble(30);
  holed[25] = { close: null }; // inside the last (sessions+1) window that rollingVol evaluates
  const vb = rollingVol(base, 10);
  const vh = rollingVol(holed, 10);
  assert(Number.isFinite(vb) && Number.isFinite(vh), "valid measured pairs remain usable");
  assert(vh < 10, "a synthesized -100% return would blow this up (got " + vh + ")");
  assert(Math.abs(vh - vb) < 1.5, "dropping the unavailable pair must not distort the measured series");
});

t("correlation: a null close does not manufacture synthetic returns", () => {
  const clean = wobble(30);
  const holed = wobble(30);
  holed[15] = { close: null };
  const cc = correlation(clean, clean, 20);
  const ch = correlation(holed, clean, 20);
  assert(Number.isFinite(cc) && Math.abs(cc - 1) < 1e-9, "control: identical measured series correlate perfectly");
  assert(Number.isFinite(ch), "only genuinely measured paired returns participate");
  assert(Math.abs(ch - 1) < 1e-9, "a null close must be excluded, never synthesized as -100%");
});

t("forwardOutcome: a null horizon QQQ close leaves the judgment unscored", () => {
  const rows = judgedRows();
  rows[5].market.QQQ.close = null; // horizon (index 0 + 5) is unavailable
  const scored = scoreMatureJudgments(rows, 5);
  assert.strictEqual(scored[0].score, undefined, "an unavailable horizon must NOT be scored as a synthetic return");
});

t("forwardOutcome: a null base QQQ close leaves the judgment unscored", () => {
  const rows = judgedRows();
  rows[0].market.QQQ.close = null; // base is unavailable
  const scored = scoreMatureJudgments(rows, 5);
  assert.strictEqual(scored[0].score, undefined, "an unavailable base must NOT be scored");
});

t("forwardOutcome: a fully measured judgment still scores (control)", () => {
  const scored = scoreMatureJudgments(judgedRows(), 5);
  assert.equal(scored[0].score.status, "scored");
  assert.equal(scored[0].score.qqqForwardReturnPct, 5, "105 vs 100 = +5%");
});

console.log("");
const failed = results.filter(([ok]) => !ok);
console.log(`Oracle v2 P0 tests: ${failed.length ? "FAIL" : "PASS"} (${results.length - failed.length}/${results.length})`);
if (failed.length) { console.error("failed: " + failed.map(([, n]) => n).join("; ")); process.exit(1); }
