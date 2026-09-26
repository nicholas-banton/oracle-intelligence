"use strict";

// ORACLE v2.0 SHADOW — Strategic Governance & Regime Intelligence
// -----------------------------------------------------------------
// Charter:
//   • observe Savant, Apex/account state, and independent market structure
//   • record auditable challenges and opportunity-cost evidence
//   • never place orders
//   • never set target weights
//   • never override Savant
//   • never authorize increased risk
//
// This service is intentionally separate from oracle.js v1.x so Savant remains
// a stable control while Oracle v2 earns influence through measured evidence.

const https = require("https");
const http = require("http");
const { renderOracleEmail } = require("./email_renderer");
const {
  pct, buildMarketMetrics, independentMarketRead, auditSavant,
  consecutiveDirectiveDays, scoreMatureJudgments, mandateSummary,
} = require("./v2/analytics");
const { normalizeLedger, upsertRecord, ledgerEnvelope } = require("./v2/ledger");

const VERSION = "2.0.0-shadow";
const LEDGER_FILE = "oracle-v2-ledger.json";
const CONFIG = {
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
  GITHUB_GIST_ID: process.env.GITHUB_GIST_ID || "",       // Savant bridge, read-only
  GITHUB_JOURNAL_ID: process.env.GITHUB_JOURNAL_ID || "", // optional, read-only
  GITHUB_ORACLE_V2_ID: process.env.GITHUB_ORACLE_V2_ID || "",
  ALPACA_KEY_ID: process.env.ALPACA_KEY_ID || "",
  ALPACA_SECRET_KEY: process.env.ALPACA_SECRET_KEY || "",
  ALPACA_HOST: "paper-api.alpaca.markets",
  RESEND_KEY: process.env.RESEND_KEY || "",
  EMAIL_FROM: process.env.EMAIL_FROM || "onboarding@resend.dev",
  EMAIL_TO: process.env.EMAIL_TO || "nicholas.banton@gmail.com",
  PORT: Number(process.env.PORT) || 8080,
  BOOTSTRAP_SNAPSHOT: process.env.ORACLE_V2_BOOTSTRAP_SNAPSHOT !== "disabled",
  EMAIL_DAILY_AUDIT: process.env.ORACLE_V2_EMAIL_DAILY_AUDIT !== "disabled",
};

let ledgerGistId = CONFIG.GITHUB_ORACLE_V2_ID || null;
let lastCompletedCycle = null;
let lastError = null;
let running = false;
const completedPhases = new Map();

function etNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function utcNowIso() { return new Date().toISOString(); }
function tradingDate(date = etNow()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function isWeekday(date = etNow()) { const d = date.getDay(); return d >= 1 && d <= 5; }
function etMinutes(date = etNow()) { return date.getHours() * 60 + date.getMinutes(); }
function log(msg, level = "INFO") { console.log(`[${etNow().toLocaleTimeString("en-US")} ET] [ORACLE-V2] [${level}] ${msg}`); }

function request({ host, path, method = "GET", headers = {}, body = null, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : (typeof body === "string" ? body : JSON.stringify(body));
    const req = https.request({
      hostname: host,
      path,
      method,
      headers: {
        "User-Agent": `oracle-v2/${VERSION}`,
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    if (payload) req.write(payload);
    req.end();
  });
}

async function githubGetGist(gistId) {
  if (!gistId || !CONFIG.GITHUB_TOKEN) return null;
  const r = await request({
    host: "api.github.com", path: `/gists/${gistId}`,
    headers: { Authorization: `Bearer ${CONFIG.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (r.status !== 200) throw new Error(`GitHub gist read ${gistId} failed HTTP ${r.status}`);
  return JSON.parse(r.body);
}

function gistContent(gist, preferredName) {
  if (!gist?.files) return null;
  if (preferredName && gist.files[preferredName]?.content != null) return gist.files[preferredName].content;
  const first = Object.values(gist.files)[0];
  return first?.content ?? null;
}

async function readJsonGist(gistId, preferredName) {
  try {
    const gist = await githubGetGist(gistId);
    const raw = gistContent(gist, preferredName);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    log(`Read ${preferredName || "gist"} failed: ${e.message}`, "WARN");
    return null;
  }
}

async function ensureLedgerGist() {
  if (ledgerGistId) return ledgerGistId;
  if (!CONFIG.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required for Oracle v2 ledger persistence");
  const envelope = ledgerEnvelope([], { createdBy: VERSION });
  const r = await request({
    host: "api.github.com", path: "/gists", method: "POST",
    headers: { Authorization: `Bearer ${CONFIG.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    body: { description: "Oracle v2 shadow evidence ledger — no execution authority", public: false, files: { [LEDGER_FILE]: { content: JSON.stringify(envelope, null, 2) } } },
  });
  if (r.status !== 201) throw new Error(`Oracle v2 ledger creation failed HTTP ${r.status}: ${r.body.slice(0, 180)}`);
  ledgerGistId = JSON.parse(r.body).id;
  log(`LEDGER CREATED — set GITHUB_ORACLE_V2_ID=${ledgerGistId} on oracle-v2-shadow to persist across redeploys`, "WARN");
  return ledgerGistId;
}

async function readLedger() {
  await ensureLedgerGist();
  const doc = await readJsonGist(ledgerGistId, LEDGER_FILE);
  return normalizeLedger(doc);
}

async function writeLedger(records, meta = {}) {
  await ensureLedgerGist();
  const content = JSON.stringify(ledgerEnvelope(records, { oracleVersion: VERSION, ...meta }), null, 2);
  const r = await request({
    host: "api.github.com", path: `/gists/${ledgerGistId}`, method: "PATCH",
    headers: { Authorization: `Bearer ${CONFIG.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    body: { files: { [LEDGER_FILE]: { content } } },
  });
  if (r.status !== 200) throw new Error(`Oracle v2 ledger write failed HTTP ${r.status}`);
}

async function fetchYahoo(symbol, range = "6mo") {
  const encoded = encodeURIComponent(symbol);
  const r = await request({ host: "query1.finance.yahoo.com", path: `/v8/finance/chart/${encoded}?interval=1d&range=${range}`, timeoutMs: 10000 });
  if (r.status !== 200) throw new Error(`${symbol} Yahoo HTTP ${r.status}`);
  const root = JSON.parse(r.body)?.chart?.result?.[0];
  const ts = root?.timestamp || [];
  const q = root?.indicators?.quote?.[0] || {};
  const adj = root?.indicators?.adjclose?.[0]?.adjclose || q.close || [];
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const close = Number(adj[i]);
    if (!Number.isFinite(close)) continue;
    rows.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close, volume: Number(q.volume?.[i]) || null });
  }
  return rows;
}

async function fetchMarket() {
  const symbols = { QQQ: "QQQ", SPY: "SPY", RSP: "RSP", IWM: "IWM", HYG: "HYG", TLT: "TLT", GLD: "GLD", SLV: "SLV", GDXJ: "GDXJ", VIX: "^VIX", TNX: "^TNX" };
  const pairs = await Promise.all(Object.entries(symbols).map(async ([key, symbol]) => {
    try { return [key, await fetchYahoo(symbol)]; }
    catch (e) { log(`Market fetch ${symbol} failed: ${e.message}`, "WARN"); return [key, []]; }
  }));
  return Object.fromEntries(pairs);
}

async function fetchAccount() {
  if (!CONFIG.ALPACA_KEY_ID || !CONFIG.ALPACA_SECRET_KEY) return null;
  try {
    const r = await request({
      host: CONFIG.ALPACA_HOST, path: "/v2/account", timeoutMs: 10000,
      headers: { "APCA-API-KEY-ID": CONFIG.ALPACA_KEY_ID, "APCA-API-SECRET-KEY": CONFIG.ALPACA_SECRET_KEY },
    });
    return r.status === 200 ? JSON.parse(r.body) : null;
  } catch (e) { log(`Alpaca account read failed: ${e.message}`, "WARN"); return null; }
}

async function readSavant() {
  if (!CONFIG.GITHUB_GIST_ID) return null;
  return readJsonGist(CONFIG.GITHUB_GIST_ID, "apex-directive.json");
}

async function sendEmail(subject, text, structured = {}) {
  if (!CONFIG.RESEND_KEY || !CONFIG.EMAIL_TO) return;
  const html = renderOracleEmail({ subject, body: text, footer: "Oracle v2 is observing in shadow mode. No trade or allocation authority." });
  const r = await request({
    host: "api.resend.com", path: "/emails", method: "POST", timeoutMs: 15000,
    headers: { Authorization: `Bearer ${CONFIG.RESEND_KEY}` },
    body: { from: CONFIG.EMAIL_FROM, to: CONFIG.EMAIL_TO, subject, text, html, headers: { "X-Oracle-Mode": "shadow_advisory", "X-Oracle-Version": VERSION }, tags: [{ name: "oracle_mode", value: "shadow" }, { name: "oracle_type", value: structured.type || "audit" }] },
  });
  if (r.status < 200 || r.status >= 300) log(`Email failed HTTP ${r.status}: ${r.body.slice(0, 160)}`, "WARN");
  else log(`Email sent: ${subject}`);
}

function lastClose(series) { return Array.isArray(series) && series.length ? series[series.length - 1]?.close : null; }
function oneDayReturn(series) {
  if (!Array.isArray(series) || series.length < 2) return null;
  return pct(series[series.length - 1].close, series[series.length - 2].close);
}

function marketCloseSnapshot(market) {
  return Object.fromEntries(Object.entries(market).map(([symbol, series]) => [symbol, { close: lastClose(series), oneDayReturnPct: oneDayReturn(series) }]));
}

function phaseForNow(now = etNow()) {
  if (!isWeekday(now)) return null;
  const m = etMinutes(now);
  if (m >= 515 && m <= 535) return "preopen"; // 08:35-08:55 ET
  if (m >= 545 && m <= 565) return "audit";   // 09:05-09:25 ET
  if (m >= 965 && m <= 990) return "close";   // 16:05-16:30 ET
  return null;
}

function phaseKey(date, phase) { return `${date}:${phase}`; }

function recordBase({ date, market, metrics, read, account }) {
  const equity = Number(account?.equity);
  const priorEquity = Number(account?.last_equity);
  return {
    id: date,
    asOf: utcNowIso(),
    oracleVersion: VERSION,
    mode: "shadow_advisory",
    authority: { canTrade: false, canSetTargetWeights: false, canOverrideSavant: false, canIncreaseRisk: false },
    market: marketCloseSnapshot(market),
    marketMetrics: metrics,
    independentRead: read,
    account: {
      equity: Number.isFinite(equity) ? equity : null,
      lastEquity: Number.isFinite(priorEquity) ? priorEquity : null,
    },
  };
}

async function runPreopen(date) {
  const [market, account, ledger] = await Promise.all([fetchMarket(), fetchAccount(), readLedger()]);
  const metrics = buildMarketMetrics(market);
  const read = independentMarketRead(metrics);
  let record = recordBase({ date, market, metrics, read, account });
  record.preopen = { completedAt: utcNowIso(), independentBeforeSavant: true };
  const scored = scoreMatureJudgments(upsertRecord(ledger, record));
  await writeLedger(scored, { mandate: mandateSummary(scored) });
  log(`Pre-open independent read: ${read.structure} score=${read.score} confidence=${read.confidence}`);
}

function humanAuditBody(record, mandate) {
  const a = record.audit || {};
  const m = record.marketMetrics || {};
  const supporting = (a.evidence || []).map(x => `• ${x}`).join("\n") || "• No strong independent evidence.";
  const counter = (a.counterEvidence || []).map(x => `• ${x}`).join("\n") || "• No material counter-evidence identified.";
  const falsify = (a.falsificationConditions || []).map(x => `• ${x}`).join("\n");
  return `SUMMARY:\n${a.summary || "Oracle completed the daily shadow audit."}\n\nKEY METRICS:\nSavant directive: ${a.savant?.directive || "unknown"}\nOracle market structure: ${record.independentRead?.structure || "unknown"}\nOracle confidence: ${Math.round((a.confidence || 0) * 100)}%\nQQQ 5-session: ${Number.isFinite(m.qqq5) ? m.qqq5.toFixed(1) + "%" : "n/a"}\nQQQ 20-session: ${Number.isFinite(m.qqq20) ? m.qqq20.toFixed(1) + "%" : "n/a"}\nVIX: ${Number.isFinite(m.vix) ? m.vix.toFixed(1) : "n/a"}\nBreadth proxy RSP-SPY 5d: ${Number.isFinite(m.equalWeightVsSpy5) ? m.equalWeightVsSpy5.toFixed(2) + "pp" : "n/a"}\nDirective persistence: ${a.savant?.persistenceDays || 1} session(s)\n\nEVIDENCE SUPPORTING ORACLE'S READ:\n${supporting}\n\nCOUNTER-EVIDENCE / RESTRAINT:\n${counter}\n\nWHAT WOULD CHANGE THIS ASSESSMENT:\n${falsify}\n\nMANDATE WATCH:\nStatus: ${mandate?.status || "insufficient_data"}\nObserved sessions: ${mandate?.sessions || 0}\nUpside capture: ${mandate?.upsideCapturePct == null ? "building baseline" : mandate.upsideCapturePct + "%"}\nDownside capture: ${mandate?.downsideCapturePct == null ? "building baseline" : mandate.downsideCapturePct + "%"}\n\nGOVERNANCE:\nAdvisory only. Oracle v2 did not change Savant, target weights, or Apex execution. The purpose of this record is to measure whether Oracle's challenges earn future influence.`;
}

async function runAudit(date, { email = true } = {}) {
  const [market, account, savant, ledger] = await Promise.all([fetchMarket(), fetchAccount(), readSavant(), readLedger()]);
  const metrics = buildMarketMetrics(market);
  const prior = ledger.find(x => x.id === date);
  const read = prior?.independentRead || independentMarketRead(metrics);
  const directive = savant?.directive || savant?.mode || "UNKNOWN";
  const persistenceDays = consecutiveDirectiveDays(ledger.filter(x => x.id !== date), directive);
  const audit = auditSavant({ marketRead: read, metrics, directive, priorDirective: savant?.priorDirective || null, persistenceDays });
  let record = { ...(prior || recordBase({ date, market, metrics, read, account })), asOf: utcNowIso(), savant: { directive, regime: savant?.regime || null, source: savant?.source || null, createdAt: savant?.createdAt || null }, audit, auditCompletedAt: utcNowIso() };
  let updated = upsertRecord(ledger, record);
  updated = scoreMatureJudgments(updated);
  const mandate = mandateSummary(updated);
  await writeLedger(updated, { mandate });

  if (email && CONFIG.EMAIL_DAILY_AUDIT) {
    const icon = audit.severity === "elevated" ? "⚠" : audit.challengeType === "aligned" ? "✓" : "◈";
    await sendEmail(`${icon} ORACLE V2 SHADOW — ${audit.challengeType.replace(/_/g, " ").toUpperCase()}`, humanAuditBody(record, mandate), { type: audit.challengeType });
  }
  log(`Decision audit: ${audit.challengeType} | Savant=${directive} | structure=${read.structure}`);
}

async function runClose(date) {
  const [market, account, ledger] = await Promise.all([fetchMarket(), fetchAccount(), readLedger()]);
  const prior = ledger.find(x => x.id === date) || {};
  const qqqReturnPct = oneDayReturn(market.QQQ);
  const equity = Number(account?.equity), lastEquity = Number(account?.last_equity);
  const equityReturnPct = Number.isFinite(equity) && Number.isFinite(lastEquity) && lastEquity !== 0 ? pct(equity, lastEquity) : null;
  const session = { completedAt: utcNowIso(), qqqReturnPct, spyReturnPct: oneDayReturn(market.SPY), equityReturnPct };
  let updated = upsertRecord(ledger, { ...prior, id: date, asOf: utcNowIso(), session, market: marketCloseSnapshot(market), closeCompletedAt: utcNowIso() });
  updated = scoreMatureJudgments(updated);
  const mandate = mandateSummary(updated);
  await writeLedger(updated, { mandate });
  log(`Close evidence recorded: QQQ=${Number.isFinite(qqqReturnPct) ? qqqReturnPct.toFixed(2) + "%" : "n/a"}, equity=${Number.isFinite(equityReturnPct) ? equityReturnPct.toFixed(2) + "%" : "n/a"}`);
}

// Phase evidence, once persisted, is immutable. A restart bootstraps the day's record again,
// and recordBase() would otherwise overwrite market / marketMetrics / independentRead with a
// later boot-time snapshot while leaving preopen.completedAt intact — presenting post-open data
// as though it were the original pre-open read. Freeze completed phase evidence; only fill gaps.
const PHASE_EVIDENCE_KEYS = ["market", "marketMetrics", "independentRead"];
function hasCompletedPhase(existing) {
  return Boolean(existing?.preopen?.completedAt || existing?.auditCompletedAt || existing?.closeCompletedAt);
}
function buildBootstrapRecord(existing, base, nowIso = utcNowIso()) {
  const frozen = hasCompletedPhase(existing);
  const record = {
    ...(existing || {}),
    ...base,
    bootstrap: {
      completedAt: nowIso,
      note: frozen
        ? "Boot snapshot only; completed phase evidence preserved (not a pre-open judgment)."
        : "Initial evidence snapshot; not a scheduled pre-open judgment.",
    },
  };
  if (frozen) {
    for (const key of PHASE_EVIDENCE_KEYS) {
      if (existing[key] !== undefined) record[key] = existing[key];
    }
  }
  return record;
}

async function bootstrapSnapshot() {
  const date = tradingDate();
  const [market, account, ledger] = await Promise.all([fetchMarket(), fetchAccount(), readLedger()]);
  const metrics = buildMarketMetrics(market);
  const read = independentMarketRead(metrics);
  const existing = ledger.find(x => x.id === date) || {};
  const record = buildBootstrapRecord(existing, recordBase({ date, market, metrics, read, account }));
  await writeLedger(upsertRecord(ledger, record), { mandate: mandateSummary(ledger) });
  log(`Bootstrap evidence snapshot stored for ${date}${hasCompletedPhase(existing) ? " (completed phase evidence preserved)" : ""}`);
}

async function runPhase(phase, date = tradingDate()) {
  if (running) return;
  const key = phaseKey(date, phase);
  if (completedPhases.has(key)) return;
  running = true;
  try {
    if (phase === "preopen") await runPreopen(date);
    if (phase === "audit") await runAudit(date);
    if (phase === "close") await runClose(date);
    completedPhases.set(key, Date.now());
    lastCompletedCycle = { phase, date, at: utcNowIso() };
    lastError = null;
  } catch (e) {
    lastError = { at: utcNowIso(), phase, message: e.message };
    log(`${phase} failed: ${e.stack || e.message}`, "ERROR");
  } finally { running = false; }
}

function startServer() {
  http.createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(lastError ? 207 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: lastError ? "degraded" : "ok", service: "oracle-v2-shadow", version: VERSION, mode: "shadow_advisory", authority: { canTrade: false, canOverrideSavant: false }, ledgerConfigured: Boolean(ledgerGistId), lastCompletedCycle, lastError, timestamp: utcNowIso() }));
      return;
    }
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Oracle v2 shadow is observing. No execution authority.\n");
      return;
    }
    res.writeHead(404); res.end("not found");
  }).listen(CONFIG.PORT, () => log(`Health server listening on ${CONFIG.PORT}`));
}

async function tick() {
  const phase = phaseForNow();
  if (phase) await runPhase(phase);
}

async function boot() {
  log(`ORACLE v${VERSION} STARTING — shadow only`);
  log("Authority: canTrade=false | canSetTargetWeights=false | canOverrideSavant=false | canIncreaseRisk=false");
  startServer();
  await ensureLedgerGist();
  if (CONFIG.BOOTSTRAP_SNAPSHOT) {
    try { await bootstrapSnapshot(); } catch (e) { lastError = { at: utcNowIso(), phase: "bootstrap", message: e.message }; log(`Bootstrap failed: ${e.message}`, "ERROR"); }
  }
  await tick();
  setInterval(tick, 5 * 60 * 1000);
}

if (require.main === module) {
  boot().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { phaseForNow, humanAuditBody, runPhase, buildBootstrapRecord, hasCompletedPhase, PHASE_EVIDENCE_KEYS };
