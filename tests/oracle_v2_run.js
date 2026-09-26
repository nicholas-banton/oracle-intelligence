"use strict";
const assert = require("assert");
const { renderOracleEmail, severityFromSubject, parseBody } = require("../email_renderer");
const { buildMarketMetrics, independentMarketRead, auditSavant, consecutiveDirectiveDays, scoreMatureJudgments, mandateSummary } = require("../v2/analytics");
const { upsertRecord, ledgerEnvelope } = require("../v2/ledger");

function series(start, changes) {
  const out = [{ date:"2026-01-01", close:start }];
  let v = start;
  for (let i=0;i<changes.length;i++) { v *= (1 + changes[i]); out.push({ date:`2026-01-${String(i+2).padStart(2,"0")}`, close:v }); }
  return out;
}

(function emailTests(){
  const sev = severityFromSubject("⚠ ORACLE DEFCON 2 — test");
  assert.equal(sev.label, "ELEVATED");
  const html = renderOracleEmail({ subject:"⚠ ORACLE DEFCON 2 — test", body:"SUMMARY:\nSomething changed.\n\nKEY METRICS:\nVIX: 24.1\nDirective: DEFENSIVE\n\nWHAT TO WATCH:\n• Breadth\n• Credit" });
  assert(html.includes("Oracle Strategic Intelligence"));
  assert(html.includes("24.1"));
  assert(html.includes("ELEVATED"));
  assert(parseBody("SUMMARY:\nHello\n\nKEY METRICS:\nVIX: 20").length >= 2);
})();

(function analyticsTests(){
  const up = Array(70).fill(0.002);
  const flat = Array(70).fill(0.0005);
  const market = {
    QQQ: series(100, up), SPY: series(100, Array(70).fill(0.0012)), RSP: series(100, Array(70).fill(0.0011)),
    IWM: series(100, Array(70).fill(0.0010)), HYG: series(100, flat), TLT: series(100, Array(70).fill(0.0001)),
    GLD: series(100, flat), SLV: series(100, flat), GDXJ: series(100, flat),
    VIX: series(18, Array(70).fill(-0.001)), TNX: series(4.5, Array(70).fill(0.0002)),
  };
  const metrics = buildMarketMetrics(market);
  const read = independentMarketRead(metrics);
  assert.equal(read.structure, "supportive");
  const audit = auditSavant({ marketRead:read, metrics, directive:"DEFENSIVE", persistenceDays:7 });
  assert.equal(audit.challengeType, "possible_excessive_defensiveness");
  assert.equal(audit.severity, "elevated");
  assert(consecutiveDirectiveDays([{savant:{directive:"DEFENSIVE"}},{savant:{directive:"DEFENSIVE"}}], "DEFENSIVE") === 3);
})();

(function ledgerTests(){
  let l=[]; l=upsertRecord(l,{id:"2026-01-01",asOf:"2026-01-01",x:1}); l=upsertRecord(l,{id:"2026-01-01",asOf:"2026-01-01",x:2});
  assert.equal(l.length,1); assert.equal(l[0].x,2);
  const env=ledgerEnvelope(l); assert.equal(env.authority.canTrade,false); assert.equal(env.mode,"shadow_advisory");
})();

(function scoringTests(){
  const rows=[];
  let q=100;
  for(let i=0;i<7;i++){
    rows.push({id:`d${i}`,asOf:`2026-01-0${i+1}`,market:{QQQ:{close:q}},audit:i===0?{challengeType:"possible_excessive_defensiveness"}:{challengeType:"aligned"}});
    q*=1.01;
  }
  const scored=scoreMatureJudgments(rows,5);
  assert.equal(scored[0].score.status,"scored");
  assert.equal(scored[0].score.directionallySupported,true);

  const immature=[
    {
      id:"d0",
      asOf:"2026-01-01",
      market:{QQQ:{close:100}},
      audit:{challengeType:"possible_excessive_defensiveness"}
    }
  ];

  const unscored=scoreMatureJudgments(immature,5);
  assert.equal(unscored[0].score,undefined);
})();

(function mandateTests(){
  const h=[1,2,3,4,5,6].map((x,i)=>({session:{qqqReturnPct:i%2===0?1:-1,equityReturnPct:i%2===0?0.8:-0.5}}));
  const m=mandateSummary(h,20);
  assert.equal(m.status,"provisional");
  assert.equal(m.sessions,6);
  assert(m.upsideCapturePct > 70 && m.upsideCapturePct < 90);
  assert(m.downsideCapturePct > 40 && m.downsideCapturePct < 60);
})();

(function mandateUnavailableTests(){
  // A session-less record (the Sept 23 bootstrap pattern) must NOT count as a paired session.
  const sessionless=[{id:"2026-09-23",asOf:"2026-09-23",bootstrap:{completedAt:"2026-09-23T20:53:36Z"}}];
  assert.equal(mandateSummary(sessionless,20).sessions,0);
  assert.equal(mandateSummary(sessionless,20).status,"insufficient_data");

  // null on either side means "not measured" — never the number 0.
  assert.equal(mandateSummary([{session:{qqqReturnPct:null,equityReturnPct:0.5}}],20).sessions,0);
  assert.equal(mandateSummary([{session:{qqqReturnPct:0.5,equityReturnPct:null}}],20).sessions,0);
  assert.equal(mandateSummary([{session:{qqqReturnPct:null,equityReturnPct:null}}],20).sessions,0);
  assert.equal(mandateSummary([{session:{}}],20).sessions,0);

  // NaN / Infinity / nonnumeric are ineligible.
  assert.equal(mandateSummary([{session:{qqqReturnPct:NaN,equityReturnPct:0.5}}],20).sessions,0);
  assert.equal(mandateSummary([{session:{qqqReturnPct:Infinity,equityReturnPct:0.5}}],20).sessions,0);
  assert.equal(mandateSummary([{session:{qqqReturnPct:"abc",equityReturnPct:0.5}}],20).sessions,0);

  // A genuine 0 is a valid observation, on both sides.
  assert.equal(mandateSummary([{session:{qqqReturnPct:0,equityReturnPct:0}}],20).sessions,1);

  // A genuinely paired record counts.
  assert.equal(mandateSummary([{session:{qqqReturnPct:1.2,equityReturnPct:0.9}}],20).sessions,1);

  // Mixed: only the genuinely complete observations count.
  const mixed=[
    {id:"a"},                                                   // no session at all
    {id:"b",session:{qqqReturnPct:null,equityReturnPct:0.4}},    // b unavailable
    {id:"c",session:{qqqReturnPct:0.4}},                         // p missing
    {id:"d",session:{qqqReturnPct:-0.5,equityReturnPct:-0.3}},   // complete
    {id:"e",session:{qqqReturnPct:0,equityReturnPct:0}},         // complete (real zeros)
  ];
  assert.equal(mandateSummary(mixed,20).sessions,2);

  // REGRESSION: the real Sept 23 + Sept 24 pair must report 1, not 2.
  // Sept 23 is a bootstrap-only record with no session; it previously passed the
  // `finite(null)===true` filter and inflated the count.
  const real=[
    {id:"2026-09-23",bootstrap:{completedAt:"2026-09-23T20:53:36Z"}},
    {id:"2026-09-24",session:{qqqReturnPct:-0.014846856283168286,equityReturnPct:-0.30799236927706586}},
  ];
  assert.equal(mandateSummary(real,20).sessions,1);
})();

console.log("Oracle v2 tests: PASS");
