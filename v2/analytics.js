"use strict";

function finite(v) { return Number.isFinite(Number(v)); }
function n(v, fallback = null) { return finite(v) ? Number(v) : fallback; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function pct(a, b) {
  if (!finite(a) || !finite(b) || Number(b) === 0) return null;
  return ((Number(a) / Number(b)) - 1) * 100;
}

function latest(series) {
  if (!Array.isArray(series) || !series.length) return null;
  return series[series.length - 1];
}

function returnOver(series, sessions) {
  if (!Array.isArray(series) || series.length <= sessions) return null;
  const a = series[series.length - 1 - sessions]?.close;
  const b = series[series.length - 1]?.close;
  return pct(b, a);
}

function rollingVol(series, sessions = 20) {
  if (!Array.isArray(series) || series.length < sessions + 1) return null;
  const slice = series.slice(-(sessions + 1));
  const rets = [];
  for (let i = 1; i < slice.length; i++) {
    const r = pct(slice[i].close, slice[i - 1].close);
    if (finite(r)) rets.push(r / 100);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + ((x - mean) ** 2), 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function zScore(series, sessions = 60) {
  const vals = (series || []).slice(-sessions).map(x => Number(x.close)).filter(Number.isFinite);
  if (vals.length < Math.min(20, sessions / 2)) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((s, x) => s + ((x - mean) ** 2), 0) / Math.max(1, vals.length - 1);
  const sd = Math.sqrt(variance);
  if (!sd) return 0;
  return (vals[vals.length - 1] - mean) / sd;
}

function correlation(aSeries, bSeries, sessions = 20) {
  const a = (aSeries || []).slice(-(sessions + 1));
  const b = (bSeries || []).slice(-(sessions + 1));
  const len = Math.min(a.length, b.length);
  if (len < 8) return null;
  const ar = [], br = [];
  for (let i = 1; i < len; i++) {
    const ai = pct(a[a.length - len + i].close, a[a.length - len + i - 1].close);
    const bi = pct(b[b.length - len + i].close, b[b.length - len + i - 1].close);
    if (finite(ai) && finite(bi)) { ar.push(ai); br.push(bi); }
  }
  if (ar.length < 6) return null;
  const am = ar.reduce((x, y) => x + y, 0) / ar.length;
  const bm = br.reduce((x, y) => x + y, 0) / br.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ar.length; i++) {
    const ax = ar[i] - am, bx = br[i] - bm;
    num += ax * bx; da += ax * ax; db += bx * bx;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}

function buildMarketMetrics(m = {}) {
  const qqq5 = returnOver(m.QQQ, 5);
  const qqq20 = returnOver(m.QQQ, 20);
  const spy5 = returnOver(m.SPY, 5);
  const spy20 = returnOver(m.SPY, 20);
  const rsp5 = returnOver(m.RSP, 5);
  const iwm5 = returnOver(m.IWM, 5);
  const hyg5 = returnOver(m.HYG, 5);
  const tlt5 = returnOver(m.TLT, 5);
  const gld5 = returnOver(m.GLD, 5);
  const slv5 = returnOver(m.SLV, 5);
  const vix = latest(m.VIX)?.close ?? null;
  const vix5 = returnOver(m.VIX, 5);
  const tnx = latest(m.TNX)?.close ?? null;
  const tnx20 = returnOver(m.TNX, 20);

  return {
    qqq5, qqq20, spy5, spy20, rsp5, iwm5, hyg5, tlt5, gld5, slv5,
    vix: n(vix), vix5, tenYear: n(tnx), tenYear20Pct: tnx20,
    qqqVsSpy5: finite(qqq5) && finite(spy5) ? qqq5 - spy5 : null,
    equalWeightVsSpy5: finite(rsp5) && finite(spy5) ? rsp5 - spy5 : null,
    smallCapsVsSpy5: finite(iwm5) && finite(spy5) ? iwm5 - spy5 : null,
    creditVsDuration5: finite(hyg5) && finite(tlt5) ? hyg5 - tlt5 : null,
    qqqVol20: rollingVol(m.QQQ, 20),
    spyVol20: rollingVol(m.SPY, 20),
    qqqTltCorr20: correlation(m.QQQ, m.TLT, 20),
    gldTltCorr20: correlation(m.GLD, m.TLT, 20),
    vixZ60: zScore(m.VIX, 60),
  };
}

function independentMarketRead(metrics = {}) {
  let score = 0;
  const evidence = [];
  const counterEvidence = [];

  const add = (cond, points, positiveText, negativeText) => {
    if (cond == null) return;
    if (cond) { score += points; if (positiveText) evidence.push(positiveText); }
    else { score -= Math.abs(points) * 0.65; if (negativeText) counterEvidence.push(negativeText); }
  };

  if (finite(metrics.qqq20)) add(metrics.qqq20 > 0, 1.25, `QQQ 20-session trend is positive (${metrics.qqq20.toFixed(1)}%)`, `QQQ 20-session trend is negative (${metrics.qqq20.toFixed(1)}%)`);
  if (finite(metrics.spy20)) add(metrics.spy20 > 0, 0.75, `SPY 20-session trend is positive (${metrics.spy20.toFixed(1)}%)`, `SPY 20-session trend is negative (${metrics.spy20.toFixed(1)}%)`);
  if (finite(metrics.equalWeightVsSpy5)) add(metrics.equalWeightVsSpy5 > -0.25, 0.8, `Breadth proxy is holding (${metrics.equalWeightVsSpy5.toFixed(2)}pp RSP-SPY)`, `Breadth is narrowing (${metrics.equalWeightVsSpy5.toFixed(2)}pp RSP-SPY)`);
  if (finite(metrics.smallCapsVsSpy5)) add(metrics.smallCapsVsSpy5 > -0.5, 0.6, `Small-cap participation is not materially lagging (${metrics.smallCapsVsSpy5.toFixed(2)}pp)`, `Small caps are lagging (${metrics.smallCapsVsSpy5.toFixed(2)}pp vs SPY)`);
  if (finite(metrics.creditVsDuration5)) add(metrics.creditVsDuration5 > -1.0, 0.9, `Credit is not signaling acute stress (${metrics.creditVsDuration5.toFixed(2)}pp HYG-TLT)`, `Credit/duration relationship is defensive (${metrics.creditVsDuration5.toFixed(2)}pp HYG-TLT)`);
  if (finite(metrics.vix)) add(metrics.vix < 22, 1.0, `VIX is below acute-stress territory (${metrics.vix.toFixed(1)})`, `VIX is elevated (${metrics.vix.toFixed(1)})`);
  if (finite(metrics.qqqVol20)) add(metrics.qqqVol20 < 35, 0.45, `QQQ realized volatility is contained (${metrics.qqqVol20.toFixed(1)}% annualized)`, `QQQ realized volatility is elevated (${metrics.qqqVol20.toFixed(1)}% annualized)`);

  let structure;
  if (score >= 2.5) structure = "supportive";
  else if (score <= -1.5) structure = "fragile";
  else structure = "mixed";

  const confidence = clamp(0.45 + Math.min(0.4, Math.abs(score) * 0.07), 0.45, 0.85);
  return { structure, score: Number(score.toFixed(2)), confidence: Number(confidence.toFixed(2)), evidence, counterEvidence };
}

const RISK_ORDER = Object.freeze({ FULL_DEPLOY: 4, BUILDING: 4, OPPORTUNISTIC: 4, REDUCED_RISK: 3, BALANCED: 3, DEFENSIVE: 2, STAND_DOWN: 1, PRESERVATION: 1 });
function riskRank(directive) { return RISK_ORDER[String(directive || "").toUpperCase()] ?? null; }

function auditSavant({ marketRead, metrics, directive, priorDirective, persistenceDays = 1 } = {}) {
  const current = String(directive || "UNKNOWN").toUpperCase();
  const rank = riskRank(current);
  const evidence = [...(marketRead?.evidence || [])];
  const counterEvidence = [...(marketRead?.counterEvidence || [])];

  let challengeType = "aligned";
  let severity = "info";
  let summary = `Savant's ${current} posture is broadly consistent with Oracle's independent ${marketRead?.structure || "unknown"} market read.`;

  if (marketRead?.structure === "supportive" && rank != null && rank <= 2) {
    challengeType = "possible_excessive_defensiveness";
    severity = persistenceDays >= 5 ? "elevated" : "watch";
    summary = `Savant remains ${current} while Oracle's independent market structure is supportive; opportunity-cost risk should be measured, not assumed.`;
  } else if (marketRead?.structure === "fragile" && rank != null && rank >= 4) {
    challengeType = "possible_excessive_risk";
    severity = "elevated";
    summary = `Savant is ${current} while Oracle's independent market structure is fragile; the posture deserves explicit challenge.`;
  } else if (marketRead?.structure === "mixed") {
    challengeType = "uncertain_regime";
    severity = "watch";
    summary = `Market structure is mixed. Oracle sees no basis for overriding Savant, but the regime should be treated as low-confidence.`;
  }

  if (persistenceDays >= 7 && challengeType !== "aligned") {
    evidence.push(`Current Savant directive has persisted for ${persistenceDays} sessions while Oracle sees contradictory structure.`);
  }

  const falsificationConditions = [];
  if (challengeType === "possible_excessive_defensiveness") {
    falsificationConditions.push("QQQ 20-session trend turns negative", "VIX rises above 22", "credit-vs-duration proxy deteriorates materially");
  } else if (challengeType === "possible_excessive_risk") {
    falsificationConditions.push("VIX normalizes below 20", "breadth improves materially", "credit stress normalizes while QQQ trend remains positive");
  } else {
    falsificationConditions.push("Material change in breadth, volatility, credit, or benchmark trend");
  }

  return {
    challengeType, severity, summary,
    confidence: marketRead?.confidence ?? 0.5,
    evidence: evidence.slice(0, 8),
    counterEvidence: counterEvidence.slice(0, 8),
    falsificationConditions,
    savant: { directive: current, priorDirective: priorDirective || null, persistenceDays },
    metrics,
  };
}

function consecutiveDirectiveDays(history = [], currentDirective) {
  const current = String(currentDirective || "").toUpperCase();
  if (!current) return 0;
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (String(history[i]?.savant?.directive || history[i]?.directive || "").toUpperCase() === current) n++;
    else break;
  }
  return Math.max(1, n + 1);
}

function forwardOutcome(history = [], index, horizon = 5) {
  const base = history[index]?.market?.QQQ?.close;
  const end = history[index + horizon]?.market?.QQQ?.close;
  if (!finite(base) || !finite(end)) return null;
  return pct(end, base);
}

function scoreMatureJudgments(history = [], horizon = 5) {
  const out = JSON.parse(JSON.stringify(history || []));
  for (let i = 0; i < out.length; i++) {
    const row = out[i];
    if (row?.score?.status === "scored") continue;
    if (!row?.audit?.challengeType || row.audit.challengeType === "aligned" || row.audit.challengeType === "uncertain_regime") continue;
    const fwd = forwardOutcome(out, i, horizon);
    if (!finite(fwd)) continue;

    let supported = null;
    if (row.audit.challengeType === "possible_excessive_defensiveness") supported = fwd > 1.5;
    if (row.audit.challengeType === "possible_excessive_risk") supported = fwd < -1.5;
    row.score = {
      status: "scored",
      horizonSessions: horizon,
      qqqForwardReturnPct: Number(fwd.toFixed(2)),
      directionallySupported: supported,
      note: "Shadow evidence only. This does not estimate a counterfactual portfolio return or authorize integration.",
    };
  }
  return out;
}

function mandateSummary(history = [], window = 20) {
  const rows = (history || []).slice(-window);
  const pairs = rows
    .map(x => ({ b: n(x?.session?.qqqReturnPct), p: n(x?.session?.equityReturnPct) }))
    .filter(x => finite(x.b) && finite(x.p));
  const paired = pairs.length;
  if (paired < 5) return { status: "insufficient_data", sessions: paired };

  let upBench = 0, upPort = 0, downBench = 0, downPort = 0;
  let rel = 0;
  for (let i = 0; i < paired; i++) {
    const { b, p } = pairs[i];
    rel += p - b;
    if (b > 0) { upBench += b; upPort += p; }
    if (b < 0) { downBench += Math.abs(b); downPort += Math.abs(Math.min(0, p)); }
  }
  return {
    status: "provisional",
    sessions: paired,
    upsideCapturePct: upBench > 0 ? Number((upPort / upBench * 100).toFixed(1)) : null,
    downsideCapturePct: downBench > 0 ? Number((downPort / downBench * 100).toFixed(1)) : null,
    cumulativeRelativeDailyGapPct: Number(rel.toFixed(2)),
    note: "Daily-return attribution is provisional and becomes decision-grade only after sufficient clean observations.",
  };
}

module.exports = {
  pct, returnOver, rollingVol, correlation, zScore, buildMarketMetrics,
  independentMarketRead, auditSavant, consecutiveDirectiveDays,
  scoreMatureJudgments, mandateSummary, riskRank,
};
