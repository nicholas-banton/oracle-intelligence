// ============================================================
// ORACLE — Strategic Intelligence Engine v1.4.1
// The invisible hand of the Apex Trading System
// Powered by Claude API · Fourth Railway Service
//
// ROLE: Oracle is the meta-intelligence layer that sits above
// Savant, Marshall, and AlpacaBot. She watches for regime
// changes, crisis events, and strategic inflection points
// that the existing system cannot detect autonomously.
//
// Oracle does NOT place orders. She does NOT replace Savant.
// She shapes the framework within which Savant reasons each day.
//
// CAPABILITIES:
//   1. The Asymmetric Sentinel  — DEFCON 1/2/3 trigger system
//   2. The Adaptive Architect   — regime-change framework rewrites
//   3. The Scenario Engine      — FOMC / event pre-gaming
//   4. The Socratic Loop        — post-mortem decision quality (Phase 4)
//   5. The Unified Portfolio Lens — combined exposure view (Phase 5)
//
// Oracle is watching. 🔮
//
// v1.1 PATCH — 2026-04-17
//   BUG FIX: "Dir:?" regression — Oracle was reading directive.mode
//   instead of directive.directive. Six in-place reads corrected.
//
// v1.2 PATCH — 2026-05-08
//   ARCHITECTURE ALIGNMENT: Oracle grounded as strategic meta-layer.
//   Adds Five Tenets to every Claude call. No schema changes.
//
// v1.2.1 PATCH — 2026-05-08
//   BASELINE CONTEXT BOOTSTRAP: Oracle creates calm baseline when
//   GITHUB_ORACLE_ID is blank or context is stale.
//
// v1.2.2 PATCH — 2026-05-08
//   TIMESTAMP HYGIENE: All machine timestamps use UTC ISO strings.
//
// v1.3.0 — 2026-06-09   [Sprint 4 FOMC retrospective findings]
//
//   FIX A (P0): SERVICE HEARTBEAT MONITOR.
//     Oracle was offline for 11 days spanning FOMC Apr 29 — the most
//     consequential event of the experiment — with no alert fired.
//     lastContextWriteTime is now tracked in module scope and updated
//     on every successful Gist write. A dedicated 30-minute interval
//     checks whether market-hours write cadence has been maintained.
//     If no write in >2h during market hours, an alert email fires.
//
//   FIX B (P0): TWO BROKEN DEFCON TRIGGERS REPAIRED.
//     countConsecutiveSameDirective() read from journal.directives[]
//     using row.mode — a schema that does not exist in the actual
//     journal written by apex-bot-v5.js. It always returned 0.
//     DEFCON 2 "same directive 7+ days" has never fired.
//     computeWinRate() read tr.pnl instead of tr.pnl_dollar and
//     tr.outcome — the actual journal fields. DEFCON 3 "win rate <30%"
//     has never fired.
//     FIX: directiveHistory is now tracked in the Oracle context Gist
//     itself (max 14 records). countConsecutiveSameDirective reads from
//     this persisted history. computeWinRate reads outcome and pnl_dollar.
//
//   FIX C (P1): STRUCTURED SCENARIO ENGINE.
//     The scenario engine produced a freeform 180-word text blob that
//     could not be automatically compared to outcomes, had no enforced
//     probability structure, and produced the oscillation problem
//     (40%↔60% Dovish Hold across hours with no new data).
//     FIX: Claude is now prompted for a structured JSON matrix with
//     explicit probability per branch (must sum to 100), directional
//     market reaction, and specific positioning guidance per branch.
//     scenarioPlan (string) is preserved for Savant v2.2 compatibility.
//     New scenarioMatrix (object) is added alongside it.
//
//   FIX D (P1): FOMC-WINDOW FORCED WRITES.
//     During the 7-day approach to any FOMC, ensureBaselineOracleContext
//     threshold drops from 26h to 8 minutes, ensuring Oracle writes on
//     every cycle and Savant always receives fresh market data in the
//     approach window.
//
//   FIX E (P1): PROBABILITY STABILITY GATE.
//     After generating a new scenario, the new dominant-branch probability
//     is compared to the stored value. If it moves >15pp without a
//     catalytic event (DEFCON trigger), scenarioMatrix.stability is set
//     to "unstable" with a reason string. Savant can read this flag.
//
//   FIX F (P2): OUTCOME ATTRIBUTION ENGINE.
//     20-72h after each FOMC, Oracle automatically runs a verdict cycle:
//     asks Claude which scenario branch actually occurred based on live
//     market data, writes outcomeVerdict to the context Gist, and emails
//     a CORRECT/WRONG scorecard. Builds Oracle's prediction accuracy log.
// ============================================================

const https = require("https");
const http  = require("http");
const { resolveModel, resolveOnFailure, currentModel } = require("./model_resolver");

// ── CONFIG ────────────────────────────────────────────────────
const CONFIG = {
  CLAUDE_API_KEY:    process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY,
  // v1.4.0: CLAUDE_MODEL resolved dynamically by model_resolver.js — no hardcoded string
  GITHUB_TOKEN:      process.env.GITHUB_TOKEN,
  GITHUB_GIST_ID:    process.env.GITHUB_GIST_ID,
  GITHUB_JOURNAL_ID: process.env.GITHUB_JOURNAL_ID,
  GITHUB_ORACLE_ID:  process.env.GITHUB_ORACLE_ID,
  ALPACA_KEY_ID:     process.env.ALPACA_KEY_ID,
  ALPACA_SECRET_KEY: process.env.ALPACA_SECRET_KEY,
  // Oracle is advisory only.  Broker reads, when configured, are always from
  // the paper environment and its output may never authorize added risk.
  ALPACA_PAPER:      true,
  OUTPUT_MODE:       "shadow_advisory",
  RESEND_KEY:        process.env.RESEND_KEY,
  EMAIL_FROM:        process.env.EMAIL_FROM || "onboarding@resend.dev",
  EMAIL_TO:          process.env.EMAIL_TO   || "nicholas@coraemjen.com",
  PORT:              process.env.PORT || 8080,
};

const ALPACA_HOST = CONFIG.ALPACA_PAPER
  ? "paper-api.alpaca.markets"
  : "api.alpaca.markets";

const ORACLE_VERSION = "1.4.1";

const ORACLE_SYSTEM_PROMPT = `You are Oracle, the strategic intelligence meta-layer of the Apex Trading System.

Oracle is the system name and the operating identity. There is no separate alias and no mythological costume. Oracle is what she is.

Oracle sits above Savant, Marshall, and AlpacaBot. Oracle watches for macro regime changes, crisis events, scheduled-event inflection points, portfolio-level fragility, and structural risks that daily directive logic may miss.

Oracle does not place orders. Oracle does not replace Savant. Oracle frames the decision environment within which Savant reasons each morning.

Sentinel is one module inside Oracle. Sentinel is not Oracle's full identity. When a DEFCON event fires, Oracle should speak through the Sentinel module while still reasoning as the broader strategic intelligence layer.

Core personality: seasoned veteran, quiet genius, contrarian advisor. Oracle tells Nicholas what he needs to know, not what he wants to hear. Oracle is not sycophantic. Oracle does not hedge for comfort. When uncertain, say so explicitly. When conviction is high, state it without cushioning.

ORACLE'S TENETS — the five principles that ground every read:

1. Drawdowns kill compounding. Protect the compound. [OVERRIDE — NON-NEGOTIABLE]
2. Capital preservation precedes capital appreciation.
3. There is no edge in narrative — only in process.
4. Conviction without survivable size is confession, not investment.
5. The crowd is right until it isn't, and only history tells you when.

Tenet 1 is non-negotiable. When tenets conflict in any decision, Tenet 1 overrides.

Oracle never rationalizes away Tenet 1. It is not a guideline. It is the floor.

Style: concise, direct, unsentimental, high-signal. Prefer process over narrative. Prefer survivability over drama. When uncertainty rises, protect the compound.`;

const COOLDOWNS = { DEFCON1: 0, DEFCON2: 0, DEFCON3: 0, SCENARIO: 0, ARCHITECT: 0 };
const COOLDOWN_MS = 4 * 60 * 60 * 1000;
let ORACLE_GIST_ID = CONFIG.GITHUB_ORACLE_ID || null;

// v1.3.0 Fix A: track last successful context write for heartbeat monitoring
let lastContextWriteTime = Date.now();
let heartbeatAlertSent = false;

// ── LOG ───────────────────────────────────────────────────────
function etNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function tsET() {
  return etNow().toLocaleTimeString("en-US", { hour12: true });
}
function utcNowIso() {
  return new Date().toISOString();
}
function getTradingDate() {
  const et = etNow();
  return `${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,"0")}-${String(et.getDate()).padStart(2,"0")}`;
}
function log(msg)  { console.log(`[${tsET()} ET] [ORACLE] [INFO]  ${msg}`); }
function warn(msg) { console.log(`[${tsET()} ET] [ORACLE] [WARN]  ${msg}`); }
function err(msg)  { console.log(`[${tsET()} ET] [ORACLE] [ERROR] ${msg}`); }

// ── MARKET HOURS ──────────────────────────────────────────────
function isMarketHours() {
  const now = etNow();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= 570 && mins < 960;
}

// ── HTTP UTILITIES ────────────────────────────────────────────
function httpsRequest(options, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode, headers: res.headers, body: text });
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`timeout ${timeoutMs}ms`)); });
    if (body) req.write(body);
    req.end();
  });
}

async function apiGet(host, path, headers = {}, timeoutMs = 15000) {
  return httpsRequest({
    host, path, method: "GET",
    headers: { "User-Agent": `oracle/${ORACLE_VERSION}`, ...headers },
  }, null, timeoutMs);
}

async function apiPost(host, path, headers, body, timeoutMs = 30000) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return httpsRequest({
    host, path, method: "POST",
    headers: { "User-Agent": `oracle/${ORACLE_VERSION}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers },
  }, payload, timeoutMs);
}

async function apiPatch(host, path, headers, body, timeoutMs = 30000) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return httpsRequest({
    host, path, method: "PATCH",
    headers: { "User-Agent": `oracle/${ORACLE_VERSION}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers },
  }, payload, timeoutMs);
}

// ── GIST I/O ──────────────────────────────────────────────────
async function readGist(gistId) {
  if (!gistId) return null;
  const res = await apiGet("api.github.com", `/gists/${gistId}`, {
    "Authorization": `token ${CONFIG.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
  });
  if (res.status !== 200) { warn(`Gist read ${gistId} failed: ${res.status}`); return null; }
  try {
    const data = JSON.parse(res.body);
    const firstFile = Object.values(data.files)[0];
    return firstFile ? firstFile.content : null;
  } catch (e) { err(`Gist parse failed: ${e.message}`); return null; }
}

async function writeGist(gistId, filename, content) {
  const res = await apiPatch("api.github.com", `/gists/${gistId}`, {
    "Authorization": `token ${CONFIG.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
  }, { files: { [filename]: { content } } });
  if (res.status !== 200) throw new Error(`Gist write failed: ${res.status} ${res.body.slice(0,200)}`);
  return true;
}

async function createGist(filename, content, description) {
  const res = await apiPost("api.github.com", "/gists", {
    "Authorization": `token ${CONFIG.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
  }, { description: description || "Oracle strategic context", public: false, files: { [filename]: { content } } });
  if (res.status !== 201) throw new Error(`Gist create failed: ${res.status} ${res.body.slice(0,200)}`);
  return JSON.parse(res.body).id;
}

// ── ORACLE CONTEXT READ/WRITE ─────────────────────────────────
async function readOracleContext() {
  if (!ORACLE_GIST_ID) return null;
  const raw = await readGist(ORACLE_GIST_ID);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// v1.3.0: existingCtx parameter enables field preservation across partial writes.
// Fields in existingCtx that are NOT explicitly set in ctx are carried forward,
// preventing directiveHistory, scenarioMatrix, and outcomeVerdict from being
// wiped on every routine baseline write.
async function writeOracleContext(ctx, existingCtx = null) {
  const preserved = existingCtx ? {
    directiveHistory:  existingCtx.directiveHistory || [],
    scenarioPlan:      existingCtx.scenarioPlan || null,
    scenarioMatrix:    existingCtx.scenarioMatrix || null,
    scenarioEvent:     existingCtx.scenarioEvent || null,
    outcomeVerdict:    existingCtx.outcomeVerdict || null,
    scenarioHistory:   Array.isArray(existingCtx.scenarioHistory)
      ? existingCtx.scenarioHistory
      : [],
    lastScenarioExpiredAt: existingCtx.lastScenarioExpiredAt || null,
    lastScenarioExpiredReason: existingCtx.lastScenarioExpiredReason || null,
  } : {};

  const payload = {
    ...preserved,
    ...ctx,
    schemaVersion: "1.0",
    updatedAt: utcNowIso(),
    v6_advisory_only: true,
    v6_risk_increase_authorized: false,
  };
  const content = JSON.stringify(payload, null, 2);

  if (!ORACLE_GIST_ID) {
    ORACLE_GIST_ID = await createGist("oracle-context.json", content, "Oracle strategic context — read by Savant at 9 AM");
    log(`🔮 Oracle Context Gist created — GITHUB_ORACLE_ID=${ORACLE_GIST_ID}`);
    log(`   Set this env var on BOTH oracle-intelligence AND savant-intelligence.`);
  } else {
    await writeGist(ORACLE_GIST_ID, "oracle-context.json", content);
  }

  // v1.3.0 Fix A: update heartbeat timestamp on every successful write
  lastContextWriteTime = Date.now();
  heartbeatAlertSent = false;
  return ORACLE_GIST_ID;
}

function hoursSinceTimestamp(ts) {
  if (!ts) return Infinity;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60);
}


function getDateOnlyET(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function getNewYorkAnnouncementTime(dateStr, hour = 14, minute = 0) {
  const [year, month, day] = String(dateStr).slice(0, 10).split("-").map(Number);

  if (![year, month, day].every(Number.isFinite)) {
    return new Date(NaN);
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));

  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value])
  );

  const localAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute)
  );

  return new Date(utcGuess - (localAsUtc - utcGuess));
}

function getScenarioAttributionStatus(scenarioDate, outcomeVerdict) {
  if (outcomeVerdict) return "resolved";

  const eventTime = getNewYorkAnnouncementTime(scenarioDate);
  if (!Number.isFinite(eventTime.getTime())) return "unknown";

  const hoursSinceEvent = (Date.now() - eventTime.getTime()) / (60 * 60 * 1000);

  if (hoursSinceEvent > 72) return "window_missed";
  if (hoursSinceEvent < 20) return "waiting_window";

  return "eligible";
}

function getScenarioDate(ctx) {
  const matrixDate = ctx?.scenarioMatrix?.fomcDate;
  if (matrixDate) return String(matrixDate).slice(0, 10);

  const match = String(ctx?.scenarioEvent || "").match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function scenarioHistoryEventDate(item) {
  const matrixDate = item?.scenarioMatrix?.fomcDate;
  if (matrixDate) return String(matrixDate).slice(0, 10);
  return item?.eventDate || null;
}

function normalizeOracleContext(existingCtx) {
  if (!existingCtx || typeof existingCtx !== "object") {
    return { ctx: existingCtx, changed: false, reason: null };
  }

  const scenarioDate = getScenarioDate(existingCtx);

  // A scenario remains active through its event day. Beginning the next
  // ET calendar day, it moves to history and is no longer shown to Savant.
  if (!scenarioDate || scenarioDate >= getDateOnlyET()) {
    return { ctx: existingCtx, changed: false, reason: null };
  }

  const scenarioHistory = Array.isArray(existingCtx.scenarioHistory)
    ? existingCtx.scenarioHistory.slice()
    : [];

  const alreadyArchived = scenarioHistory.some(item =>
    scenarioHistoryEventDate(item) === scenarioDate
  );

  if (!alreadyArchived) {
    scenarioHistory.push({
      eventDate: scenarioDate,
      archivedAt: utcNowIso(),
      archiveReason: "scenario_event_date_passed",
      attributionStatus: getScenarioAttributionStatus(scenarioDate, existingCtx.outcomeVerdict),
      scenarioEvent: existingCtx.scenarioEvent || null,
      scenarioPlan: existingCtx.scenarioPlan || null,
      scenarioMatrix: existingCtx.scenarioMatrix || null,
      outcomeVerdict: existingCtx.outcomeVerdict || null,
    });
  }

  return {
    ctx: {
      ...existingCtx,
      scenarioPlan: null,
      scenarioMatrix: null,
      scenarioEvent: null,
      outcomeVerdict: null,
      scenarioHistory: scenarioHistory.slice(-12),
      lastScenarioExpiredAt: utcNowIso(),
      lastScenarioExpiredReason: `Expired active scenario dated ${scenarioDate}`,
    },
    changed: true,
    reason: `Archived expired scenario dated ${scenarioDate}`,
  };
}


// v1.3.0 Fix B: directiveHistory is now included in baseline context payload.
// This persists the rolling 14-day directive log so countConsecutiveSameDirective
// has a real data source instead of the non-existent journal.directives[] array.
function buildBaselineOracleContext(state, reason, directiveHistory = []) {
  const directiveName = state.directive?.directive || null;
  const regimeName = state.directive?.regime || "unknown";
  const equity = state.account?.equity || null;

  return {
    contextType: "baseline",
    oracleVersion: ORACLE_VERSION,
    status: "normal_watch",
    baselineReason: reason,
    defconLevel: null,
    defconTrigger: null,
    defconDirective: null,
    directiveHistory,
    regime: {
      current: regimeName,
      confidence: directiveName ? 0.55 : 0.25,
      reasoning: directiveName
        ? `Baseline read: Savant's current directive is ${directiveName} in ${regimeName} regime. Oracle has no active DEFCON, Scenario, or Architect alert in this cycle.`
        : "Baseline read: Oracle has no current Savant directive available and no active alert in this cycle.",
      keySignals: [
        state.vix?.current != null ? `VIX ${state.vix.current}` : "VIX unavailable",
        state.yield10?.current != null ? `10y yield ${state.yield10.current}` : "10y yield unavailable",
        equity ? `Equity $${equity}` : "Equity unavailable",
        directiveName ? `Directive ${directiveName}` : "Directive unavailable",
      ],
    },
    strategicFrame: "No active DEFCON, Scenario, or Architect signal. Oracle remains in normal watch. The absence of an alarm is not a reason to abandon process discipline.",
    topConviction: {
      tenet: 1,
      statement: "Drawdowns kill compounding. Protect the compound.",
      actionImplication: "Maintain survivable sizing and do not increase risk simply because conditions appear calm.",
    },
    architectSignals: [],
    architectRecommendation: null,
    vix: state.vix,
    yield10: state.yield10,
    equity,
    directive: directiveName,
  };
}

// v1.3.0 Fix D: stale threshold drops to 8 minutes during FOMC week (was 26h).
// This ensures Oracle writes on every 5-min cycle during the approach window,
// giving Savant fresh VIX/yield/equity in its 9 AM briefing every day.
async function ensureBaselineOracleContext(state, contextWriteOccurred, existingCtx, directiveHistory) {
  if (contextWriteOccurred) return null;

  const staleHours = hoursSinceTimestamp(existingCtx?.updatedAt);
  const needsBootstrap = !ORACLE_GIST_ID || !existingCtx;
  const isBaselineContext = existingCtx?.contextType === "baseline";
  const needsVersionRefresh = isBaselineContext && existingCtx?.oracleVersion !== ORACLE_VERSION;

  // v1.3.0 Fix D: tighten stale threshold during FOMC window
  const fomcInDays = daysUntilNextFOMC();
  const inFomcWindow = fomcInDays != null && fomcInDays >= 0 && fomcInDays <= 7;
  const staleThresholdHours = inFomcWindow ? (8 / 60) : 26;  // 8 min vs 26h
  const needsStaleRefresh = staleHours > staleThresholdHours;

  if (!needsBootstrap && !needsStaleRefresh && !needsVersionRefresh) {
    if (!inFomcWindow) log(`Oracle baseline: fresh (${staleHours.toFixed(1)}h) — no write needed`);
    return null;
  }

  const reason = needsBootstrap
    ? "bootstrap_no_oracle_context"
    : needsVersionRefresh
      ? `refresh_baseline_version_to_${ORACLE_VERSION}`
      : inFomcWindow
        ? `fomc_window_refresh_${fomcInDays}d_to_fomc`
        : `refresh_stale_context_${staleHours.toFixed(1)}h`;

  const baseline = buildBaselineOracleContext(state, reason, directiveHistory);
  // Preserve scenario and verdict data during baseline refreshes
  const gistId = await writeOracleContext(baseline, existingCtx);
  log(`🔮 Oracle baseline ${needsBootstrap ? "bootstrapped" : "refreshed"} — ${reason}`);
  return gistId;
}

// ── DATA FETCHERS ─────────────────────────────────────────────
async function fetchVIX() {
  try {
    const res = await apiGet("query1.finance.yahoo.com", "/v8/finance/chart/%5EVIX?interval=1d&range=5d", {}, 8000);
    if (res.status !== 200) return null;
    const data = JSON.parse(res.body);
    const r = data?.chart?.result?.[0];
    if (!r) return null;
    const closes = (r.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    if (last == null || prev == null) return null;
    return { current: +last.toFixed(2), previous: +prev.toFixed(2), changePct: +(((last - prev) / prev) * 100).toFixed(2) };
  } catch (e) { warn(`VIX fetch failed: ${e.message}`); return null; }
}

async function fetchTenYearYield() {
  try {
    const res = await apiGet("query1.finance.yahoo.com", "/v8/finance/chart/%5ETNX?interval=1d&range=30d", {}, 8000);
    if (res.status !== 200) return null;
    const data = JSON.parse(res.body);
    const closes = (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    if (closes.length < 2) return null;
    const last = closes[closes.length - 1];
    return { current: +last.toFixed(2), monthAgo: +closes[0].toFixed(2), change30d: +(last - closes[0]).toFixed(2) };
  } catch (e) { warn(`10y yield fetch failed: ${e.message}`); return null; }
}

async function fetchAlpacaAccount() {
  try {
    const res = await apiGet(ALPACA_HOST, "/v2/account", {
      "APCA-API-KEY-ID": CONFIG.ALPACA_KEY_ID,
      "APCA-API-SECRET-KEY": CONFIG.ALPACA_SECRET_KEY,
    }, 10000);
    if (res.status !== 200) return null;
    return JSON.parse(res.body);
  } catch (e) { warn(`Alpaca account fetch failed: ${e.message}`); return null; }
}

async function fetchAlpacaPositions() {
  try {
    const res = await apiGet(ALPACA_HOST, "/v2/positions", {
      "APCA-API-KEY-ID": CONFIG.ALPACA_KEY_ID,
      "APCA-API-SECRET-KEY": CONFIG.ALPACA_SECRET_KEY,
    }, 10000);
    if (res.status !== 200) return [];
    return JSON.parse(res.body);
  } catch (e) { warn(`Alpaca positions fetch failed: ${e.message}`); return []; }
}

async function readSavantDirective() {
  if (!CONFIG.GITHUB_GIST_ID) return null;
  const raw = await readGist(CONFIG.GITHUB_GIST_ID);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function readJournal() {
  if (!CONFIG.GITHUB_JOURNAL_ID) return { trades: [], directives: [] };
  const raw = await readGist(CONFIG.GITHUB_JOURNAL_ID);
  if (!raw) return { trades: [], directives: [] };
  try { return JSON.parse(raw); } catch { return { trades: [], directives: [] }; }
}

// ── CLAUDE API ────────────────────────────────────────────────
// v1.4.0: uses model_resolver.js — no hardcoded model string.
// On 404, triggers re-resolution and retries once.
async function askClaude(prompt, maxTokens = 1024) {
  const model = currentModel(); // live-resolved
  const body = {
    model,
    max_tokens: maxTokens,
    system: ORACLE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  };
  const res = await apiPost("api.anthropic.com", "/v1/messages", {
    "x-api-key": CONFIG.CLAUDE_API_KEY,
    "anthropic-version": "2023-06-01",
  }, body, 60000);
  // v1.4.0: self-heal on 404
  if (res.status === 404) {
    log(`Claude 404 — model '${model}' may be retired. Self-healing...`, "WARN");
    await resolveOnFailure(CONFIG.CLAUDE_API_KEY, model, log);
    const retryModel = currentModel();
    const retryBody = { ...body, model: retryModel };
    const retryRes = await apiPost("api.anthropic.com", "/v1/messages", {
      "x-api-key": CONFIG.CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
    }, retryBody, 60000);
    if (retryRes.status !== 200) throw new Error(`Claude API retry ${retryRes.status}: ${retryRes.body.slice(0,200)}`);
    const retryData = JSON.parse(retryRes.body);
    return retryData.content?.[0]?.text || "";
  }
  if (res.status !== 200) throw new Error(`Claude API ${res.status}: ${res.body.slice(0,200)}`);
  const data = JSON.parse(res.body);
  return data.content?.[0]?.text || "";
}

// ── EMAIL ─────────────────────────────────────────────────────
async function sendEmail(subject, body) {
  if (!CONFIG.RESEND_KEY) { warn("RESEND_KEY not set — skipping email"); return; }
  try {
    const res = await apiPost("api.resend.com", "/emails", {
      "Authorization": `Bearer ${CONFIG.RESEND_KEY}`,
    }, { from: CONFIG.EMAIL_FROM, to: CONFIG.EMAIL_TO, subject, text: body }, 15000);
    if (res.status >= 200 && res.status < 300) log(`📧 Email sent: ${subject}`);
    else warn(`Email failed: ${res.status} ${res.body.slice(0,150)}`);
  } catch (e) { warn(`Email error: ${e.message}`); }
}

// ── COOLDOWN HELPERS ──────────────────────────────────────────
function onCooldown(level) { return Date.now() - (COOLDOWNS[level] || 0) < COOLDOWN_MS; }
function setCooldown(level) { COOLDOWNS[level] = Date.now(); }

// ── v1.3.0 Fix A: SERVICE HEARTBEAT ──────────────────────────
// Runs every 30 minutes. If market hours and no context write in >2h,
// sends a single alert email. Resets after the next successful write.
async function checkHeartbeat() {
  if (!isMarketHours()) return;
  const elapsedMs = Date.now() - lastContextWriteTime;
  const twoHoursMs = 2 * 60 * 60 * 1000;
  if (elapsedMs > twoHoursMs && !heartbeatAlertSent) {
    const hoursElapsed = (elapsedMs / (60 * 60 * 1000)).toFixed(1);
    warn(`Heartbeat: No context write in ${hoursElapsed}h during market hours`);
    heartbeatAlertSent = true;
    await sendEmail(
      `⚠ ORACLE HEARTBEAT: No context write in ${hoursElapsed}h`,
      `Oracle has not written to the context Gist in ${hoursElapsed} hours during market hours.\n\nThis may indicate a Gist write failure, Claude API error, or service degradation.\n\nLast successful write: ${new Date(lastContextWriteTime).toLocaleString("en-US", {timeZone:"America/New_York"})} ET\n\nManual check recommended. Oracle may be running but not producing outputs.\n\n${etNow().toLocaleString()} ET\nOracle is watching — but something may be wrong.`
    );
  }
}

// ── v1.3.0 Fix B: DIRECTIVE HISTORY MANAGEMENT ───────────────
// Appends today's directive to the rolling 14-day history stored in
// the Oracle context Gist. One record per calendar day — overwrites
// if the directive changes mid-day. This is the data source that
// countConsecutiveSameDirective now reads from.
function updateDirectiveHistory(existingHistory, directive) {
  if (!directive?.directive) return existingHistory || [];
  const history = (existingHistory || []).slice();
  const today = getTradingDate();
  const todayEntry = { date: today, directive: directive.directive, regime: directive.regime || "unknown" };
  const lastIdx = history.length - 1;
  if (lastIdx >= 0 && history[lastIdx].date === today) {
    history[lastIdx] = todayEntry;
  } else {
    history.push(todayEntry);
  }
  return history.slice(-14);
}

// ── ANALYSIS ENGINES ──────────────────────────────────────────

// 1. THE ASYMMETRIC SENTINEL
async function checkSentinel(state) {
  const triggers = [];
  const { vix, account, journal, directive, directiveHistory } = state;

  if (vix && vix.changePct >= 20) {
    triggers.push({ level: "DEFCON1", reason: `VIX spiked ${vix.changePct}% (${vix.previous} → ${vix.current})` });
  }
  if (account) {
    const equity = +account.equity, lastEquity = +account.last_equity;
    if (lastEquity > 0) {
      const pct = ((equity - lastEquity) / lastEquity) * 100;
      if (pct <= -3) triggers.push({ level: "DEFCON1", reason: `Portfolio -${Math.abs(pct).toFixed(2)}% intraday ($${lastEquity.toFixed(0)} → $${equity.toFixed(0)})` });
      else if (pct <= -2) triggers.push({ level: "DEFCON2", reason: `Portfolio -${Math.abs(pct).toFixed(2)}% intraday` });
    }
  }
  if (vix && vix.current >= 25 && vix.previous < 25) {
    triggers.push({ level: "DEFCON2", reason: `VIX crossed 25 (${vix.previous} → ${vix.current})` });
  }

  // v1.3.0 Fix B: reads from directiveHistory (persisted) instead of journal.directives[] (non-existent)
  const stuckDays = countConsecutiveSameDirective(directiveHistory, directive);
  if (stuckDays >= 7) {
    triggers.push({ level: "DEFCON2", reason: `Same directive (${directive?.directive || "?"}) for ${stuckDays} consecutive days` });
  }

  const lossStreak = countLossStreak(journal);
  if (lossStreak >= 3) triggers.push({ level: "DEFCON3", reason: `${lossStreak} consecutive losses` });

  // v1.3.0 Fix B: reads outcome and pnl_dollar (actual journal fields)
  const winRate = computeWinRate(journal);
  if (winRate != null && journal.trades?.length >= 10 && winRate < 0.30) {
    triggers.push({ level: "DEFCON3", reason: `Win rate ${(winRate * 100).toFixed(0)}% over last ${journal.trades.length} trades` });
  }

  const fomcInDays = daysUntilNextFOMC();
  if (fomcInDays != null && fomcInDays <= 3 && fomcInDays >= 0) {
    triggers.push({ level: "DEFCON3", reason: `FOMC meeting in ${fomcInDays} day(s)` });
  }

  return triggers;
}

// v1.3.0 Fix B: reads from persisted directiveHistory, not journal.directives[]
function countConsecutiveSameDirective(directiveHistory, currentDirective) {
  if (!currentDirective?.directive || !directiveHistory?.length) return 0;
  const current = currentDirective.directive;
  let n = 0;
  for (let i = directiveHistory.length - 1; i >= 0; i--) {
    if (directiveHistory[i].directive === current) n++;
    else break;
  }
  return n;
}

function countLossStreak(journal) {
  const t = (journal?.trades || []).slice().reverse();
  let n = 0;
  for (const tr of t) {
    const outcome = tr.outcome || (tr.pnl_dollar < 0 ? "loss" : "win");
    if (outcome === "loss") n++; else break;
  }
  return n;
}

// v1.3.0 Fix B: reads outcome and pnl_dollar (actual apex-bot-v5.js journal schema)
function computeWinRate(journal) {
  const t = (journal?.trades || []).filter(x => x.outcome != null || x.pnl_dollar != null);
  if (t.length === 0) return null;
  const wins = t.filter(x => x.outcome === "win" || (x.pnl_dollar != null && +x.pnl_dollar > 0)).length;
  return wins / t.length;
}

// 2. THE ADAPTIVE ARCHITECT
async function runAdaptiveArchitect(state) {
  if (onCooldown("ARCHITECT")) return null;
  const { vix, yield10, directive } = state;
  if (!vix || !yield10) return null;
  const signals = [];
  if (vix.current >= 25 && (directive?.regime || "").includes("bull")) {
    signals.push(`VIX at ${vix.current} inconsistent with ${directive.regime} regime`);
  }
  if (vix.current < 15 && (directive?.directive || "") === "REDUCED_RISK") {
    signals.push(`VIX calm (${vix.current}) but directive still REDUCED_RISK — opportunity cost risk`);
  }
  if (yield10.change30d >= 0.50) {
    signals.push(`10y yield +${yield10.change30d.toFixed(2)} in 30d — TQQQ headwind elevated`);
  }
  if (signals.length === 0) return null;
  setCooldown("ARCHITECT");
  return { signals, recommendation: "Re-examine regime assumption at next briefing" };
}

// 3. THE SCENARIO ENGINE — v1.3.0: structured JSON output + stability gate
async function runScenarioEngine(state, existingCtx) {
  const fomcInDays = daysUntilNextFOMC();
  if (fomcInDays == null || fomcInDays < 0 || fomcInDays > 7) return null;
  if (onCooldown("SCENARIO")) return null;

  const nextFomcDate = FOMC_2026.find(d => new Date(d + "T14:00:00-04:00") >= etNow());

  // v1.3.0 Fix C: structured JSON prompt.
  // Both scenarioPlan (string, Savant v2.2 compat) and scenarioMatrix (object) are produced.
  const prompt = `Nicholas runs a $100K paper portfolio trading TQQQ, GDXJ, SLV with SGOV as defensive.

FOMC meeting in ${fomcInDays} day(s) on ${nextFomcDate}. Current market state:
- VIX: ${state.vix?.current ?? "n/a"} (prev ${state.vix?.previous ?? "n/a"}, ${state.vix?.changePct ?? "n/a"}% change)
- 10y yield: ${state.yield10?.current ?? "n/a"}% (${state.yield10?.change30d >= 0 ? "+" : ""}${state.yield10?.change30d ?? "n/a"} vs 30d ago)
- Portfolio equity: $${state.account?.equity ?? "n/a"}
- Current directive: ${state.directive?.directive ?? "n/a"} | regime: ${state.directive?.regime ?? "n/a"}

Respond with ONLY a JSON object. No preamble. No markdown. No text outside the JSON.

{
  "branches": [
    {
      "name": "Dovish Hold",
      "probability": <integer 0-100>,
      "fedAction": "<one sentence describing Fed decision and tone>",
      "vixMove": "<falls X-Y% / rises X-Y% / flat>",
      "equityMove": "<+X% to +Y% / -X% to -Y% / flat>",
      "tqqqBias": "<strongly bullish|bullish|neutral|bearish|strongly bearish>",
      "gdxjBias": "<strongly bullish|bullish|neutral|bearish|strongly bearish>",
      "slvBias": "<strongly bullish|bullish|neutral|bearish|strongly bearish>",
      "positioning": "<specific 1-sentence sizing action for this branch>"
    },
    {
      "name": "Hawkish Hold",
      "probability": <integer 0-100>,
      "fedAction": "<one sentence>",
      "vixMove": "<>",
      "equityMove": "<>",
      "tqqqBias": "<>",
      "gdxjBias": "<>",
      "slvBias": "<>",
      "positioning": "<>"
    },
    {
      "name": "Cut Surprise",
      "probability": <integer 0-100>,
      "fedAction": "<one sentence>",
      "vixMove": "<>",
      "equityMove": "<>",
      "tqqqBias": "<>",
      "gdxjBias": "<>",
      "slvBias": "<>",
      "positioning": "<>"
    }
  ],
  "dominantBranch": "<name of highest-probability branch>",
  "dominantProbability": <integer matching that branch's probability>,
  "preEventAction": "<one sentence: specific action to take in the 48h before meeting>",
  "doNotDo": "<one sentence: the specific mistake to avoid>",
  "oracleSummary": "<2-3 sentences: Oracle's strategic read. Reference Five Tenets. Be direct.>"
}

Rules: probabilities must sum to exactly 100. Three branches only: Dovish Hold, Hawkish Hold, Cut Surprise. Be specific in positioning — no hedge language. Tenet 1 governs.`;

  let text;
  try {
    text = await askClaude(prompt, 1000);
    setCooldown("SCENARIO");
  } catch (e) {
    warn(`Scenario engine Claude call failed: ${e.message}`);
    return null;
  }

  // Parse structured JSON response
  let matrix = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      matrix = JSON.parse(jsonMatch[0]);
      // Validate and normalize probabilities
      if (matrix.branches && Array.isArray(matrix.branches)) {
        const probSum = matrix.branches.reduce((s, b) => s + (parseInt(b.probability) || 0), 0);
        if (Math.abs(probSum - 100) > 2) {
          warn(`Scenario probabilities sum to ${probSum} — normalizing`);
          matrix.branches.forEach(b => { b.probability = Math.round((parseInt(b.probability) || 0) * 100 / probSum); });
        }
      }
    }
  } catch (parseErr) {
    warn(`Scenario JSON parse failed: ${parseErr.message} — text fallback only`);
  }

  // v1.3.0 Fix E: probability stability gate
  if (matrix) {
    const prevMatrix = existingCtx?.scenarioMatrix;
    let stability = "stable";
    let stabilityReason = null;
    if (prevMatrix?.dominantBranch && prevMatrix?.dominantProbability != null) {
      const branchChanged = prevMatrix.dominantBranch !== matrix.dominantBranch;
      const probDelta = Math.abs((parseInt(matrix.dominantProbability) || 0) - (parseInt(prevMatrix.dominantProbability) || 0));
      if (branchChanged) {
        stability = "unstable";
        stabilityReason = `Dominant branch shifted: ${prevMatrix.dominantBranch} → ${matrix.dominantBranch}`;
      } else if (probDelta > 15) {
        stability = "unstable";
        stabilityReason = `Dominant probability moved ${probDelta}pp (${prevMatrix.dominantProbability}% → ${matrix.dominantProbability}%) without catalytic event`;
      }
      if (stability === "unstable") warn(`Scenario stability: ${stabilityReason}`);
    }
    matrix.stability = stability;
    matrix.stabilityReason = stabilityReason;
    matrix.vixAtGeneration = state.vix?.current;
    matrix.generatedAt = utcNowIso();
    matrix.fomcDate = nextFomcDate;
    matrix.fomcDaysOut = fomcInDays;
  }

  // Human-readable summary for scenarioPlan (Savant v2.2 compat)
  let humanSummary;
  if (matrix) {
    const branches = matrix.branches || [];
    const lines = branches.map(b => `**${b.name} (${b.probability}%):** ${b.fedAction} → TQQQ ${b.tqqqBias}. ${b.positioning}`);
    humanSummary = `FOMC SCENARIO MATRIX — ${fomcInDays}d to ${nextFomcDate}\n\n` +
      lines.join("\n\n") +
      `\n\nDominant: ${matrix.dominantBranch} at ${matrix.dominantProbability}%` +
      (matrix.stability === "unstable" ? ` ⚠ UNSTABLE: ${matrix.stabilityReason}` : "") +
      `\n\nPre-event: ${matrix.preEventAction}\nDo NOT: ${matrix.doNotDo}\n\n${matrix.oracleSummary}`;
  } else {
    humanSummary = text;
  }

  return { fomcInDays, plan: humanSummary, matrix, nextFomcDate };
}

// 4. THE SOCRATIC LOOP (Phase 4 — deferred)
async function runSocraticLoop(state) {
  const trades = state.journal?.trades || [];
  if (trades.length < 10) return null;
  return null;
}

// 5. v1.3.0 Fix F: OUTCOME ATTRIBUTION ENGINE
// Runs automatically 20-72h after each FOMC meeting.
// Reads stored scenarioMatrix, asks Claude which branch occurred,
// writes outcomeVerdict, emails a CORRECT/WRONG scorecard.
function findScenarioForAttribution(existingCtx, fomcDateStr) {
  if (
    existingCtx?.scenarioMatrix?.fomcDate === fomcDateStr &&
    !existingCtx?.outcomeVerdict
  ) {
    return {
      source: "active",
      matrix: existingCtx.scenarioMatrix,
      historyIndex: -1,
    };
  }

  const history = Array.isArray(existingCtx?.scenarioHistory)
    ? existingCtx.scenarioHistory
    : [];

  const historyIndex = history.findIndex(item =>
    scenarioHistoryEventDate(item) === fomcDateStr &&
    item?.scenarioMatrix &&
    !item?.outcomeVerdict
  );

  if (historyIndex >= 0) {
    return {
      source: "history",
      matrix: history[historyIndex].scenarioMatrix,
      historyIndex,
    };
  }

  return null;
}

async function runOutcomeAttribution(state, existingCtx) {
  if (!existingCtx || typeof existingCtx !== "object") return null;

  const now = new Date();

  for (const fomcDateStr of FOMC_2026) {
    const fomcTime = getNewYorkAnnouncementTime(fomcDateStr);
    const hoursSince = (now - fomcTime) / (60 * 60 * 1000);

    if (hoursSince < 20 || hoursSince > 72) continue;

    const candidate = findScenarioForAttribution(existingCtx, fomcDateStr);
    if (!candidate) continue;

    const matrix = candidate.matrix;
    log(`🎯 Outcome attribution window: FOMC ${fomcDateStr} (${hoursSince.toFixed(0)}h ago)`);

    const branches = matrix.branches || [];
    const branchSummary = branches.map(b => `${b.name}: ${b.probability}%`).join(", ");

    const prompt = `Oracle, you predicted a scenario matrix for the FOMC meeting on ${fomcDateStr}.

Your prediction was: ${branchSummary}
Dominant branch: ${matrix.dominantBranch} (${matrix.dominantProbability}%)

Current market state (${hoursSince.toFixed(0)}h after the FOMC announcement):
- VIX: ${state.vix?.current} (change: ${state.vix?.changePct}%)
- 10y yield: ${state.yield10?.current}% (vs 30d ago: ${state.yield10?.change30d})
- Portfolio equity: $${state.account?.equity}
- Current Savant directive: ${state.directive?.directive} / ${state.directive?.regime}

Based on the market reaction, which of your three branches most closely describes what actually happened? Respond with ONLY a JSON object:

{
  "actualBranch": "<name of best-matching branch from Dovish Hold, Hawkish Hold, or Cut Surprise>",
  "correct": <true if dominantBranch matches actualBranch, false otherwise>,
  "confidenceInVerdict": <0.0 to 1.0>,
  "marketReactionSummary": "<one sentence describing what actually happened at the FOMC>",
  "predictionAccuracy": "<strong|partial|wrong>",
  "lessonsForNextFOMC": "<one specific improvement Oracle should apply next time>",
  "oracleReflection": "<2 sentences: Oracle's honest self-assessment of this prediction. No softening.>"
}`;

    let verdict = null;

    try {
      const text = await askClaude(prompt, 700);
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        verdict = JSON.parse(jsonMatch[0]);
        verdict.predictedDominantBranch = matrix.dominantBranch;
        verdict.predictedDominantProbability = matrix.dominantProbability;
        verdict.attributedAt = utcNowIso();
        verdict.fomcDate = fomcDateStr;
        verdict.hoursAfterEvent = +hoursSince.toFixed(1);
      }
    } catch (e) {
      warn(`Outcome attribution failed: ${e.message}`);
      return null;
    }

    if (!verdict) return null;

    log(`🎯 Attribution: predicted ${verdict.predictedDominantBranch}, actual ${verdict.actualBranch}, correct: ${verdict.correct}`);

    if (candidate.source === "history") {
      const updatedHistory = existingCtx.scenarioHistory.slice();
      updatedHistory[candidate.historyIndex] = {
        ...updatedHistory[candidate.historyIndex],
        outcomeVerdict: verdict,
        attributionStatus: "resolved",
        attributedAt: verdict.attributedAt,
      };

      await writeOracleContext({
        ...existingCtx,
        scenarioHistory: updatedHistory,
      }, null);
    } else {
      await writeOracleContext({
        ...existingCtx,
        outcomeVerdict: verdict,
      }, null);
    }

    const resultLabel = verdict.correct ? "✓ CORRECT" : "✗ WRONG";
    const accuracyStr = verdict.predictionAccuracy?.toUpperCase() || (verdict.correct ? "CORRECT" : "WRONG");

    await sendEmail(
      `🎯 ORACLE OUTCOME VERDICT — FOMC ${fomcDateStr}: ${resultLabel}`,
      `OUTCOME ATTRIBUTION — FOMC ${fomcDateStr}\n\n` +
      `Predicted dominant: ${verdict.predictedDominantBranch} (${verdict.predictedDominantProbability}%)\n` +
      `Actual outcome: ${verdict.actualBranch}\n` +
      `Result: ${resultLabel} (${accuracyStr})\n` +
      `Verdict confidence: ${((verdict.confidenceInVerdict || 0) * 100).toFixed(0)}%\n\n` +
      `What happened: ${verdict.marketReactionSummary}\n\n` +
      `Oracle's reflection: ${verdict.oracleReflection}\n\n` +
      `Lesson for next FOMC: ${verdict.lessonsForNextFOMC}\n\n` +
      `${etNow().toLocaleString()} ET\nOracle is watching.`
    );

    return verdict;
  }

  return null;
}


// ── FOMC CALENDAR ─────────────────────────────────────────────
const FOMC_2026 = [
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
  "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-16",
];

function daysUntilNextFOMC() {
  const now = new Date();
  for (const d of FOMC_2026) {
    const t = getNewYorkAnnouncementTime(d);
    if (t >= now) return Math.floor((t - now) / (24 * 60 * 60 * 1000));
  }
  return null;
}

// ── DEFCON HANDLERS ───────────────────────────────────────────
function pctChange(account) {
  if (!account) return "?";
  const eq = +account.equity, last = +account.last_equity;
  if (!last) return "?";
  return (((eq - last) / last) * 100).toFixed(2);
}

async function fireDefcon1(trigger, state, existingCtx) {
  if (onCooldown("DEFCON1")) { log(`DEFCON 1 on cooldown — skipping: ${trigger.reason}`); return; }
  setCooldown("DEFCON1");
  log(`🚨 DEFCON 1 FIRED — ${trigger.reason}`);
  const prompt = `DEFCON 1 has fired. Autonomous intervention authorized.

TRIGGER: ${trigger.reason}
VIX: ${state.vix?.current} (${state.vix?.changePct}% day)
Portfolio: $${state.account?.equity} (${pctChange(state.account)}% intraday)
Positions: ${(state.positions || []).map(p => `${p.symbol} ${p.qty} @ ${(+p.unrealized_plpc * 100).toFixed(1)}%`).join(", ") || "none"}
Directive: ${state.directive?.directive} / ${state.directive?.regime}

Produce a DEFCON 1 crisis directive in <=150 words:
1. Immediate posture (STAND_DOWN / REDUCED_RISK / HOLD)
2. TQQQ/GDXJ/SLV max allocation caps for next 24h
3. One sentence: what you are protecting against

Be blunt. No caveats. Tenet 1 governs.`;
  let response = "(Claude unavailable)";
  try { response = await askClaude(prompt, 600); } catch (e) { warn(`DEFCON 1 Claude call failed: ${e.message}`); }
  await writeOracleContext({ defconLevel:1, defconTrigger:trigger.reason, defconDirective:response, vix:state.vix, yield10:state.yield10, equity:state.account?.equity, activeSince:utcNowIso() }, existingCtx);
  await sendEmail(`🚨 ORACLE DEFCON 1 — ${trigger.reason.slice(0,50)}`,
    `DEFCON 1 — AUTONOMOUS INTERVENTION\n\nTRIGGER: ${trigger.reason}\n\nORACLE DIRECTIVE:\n${response}\n\n${etNow().toLocaleString()} ET\nOracle is watching.`);
}

async function fireDefcon2(trigger, state, existingCtx) {
  if (onCooldown("DEFCON2")) { log(`DEFCON 2 on cooldown — skipping: ${trigger.reason}`); return; }
  setCooldown("DEFCON2");
  log(`⚠ DEFCON 2 FIRED — ${trigger.reason}`);
  const prompt = `DEFCON 2 has fired. Approval-recommended alert.

TRIGGER: ${trigger.reason}
VIX: ${state.vix?.current} (${state.vix?.changePct}% day)
Portfolio: $${state.account?.equity}
Directive: ${state.directive?.directive} / ${state.directive?.regime}

Produce a DEFCON 2 recommendation in <=200 words:
1. What should change in the next directive cycle
2. Specific allocation shifts (TQQQ/GDXJ/SLV)
3. The reasoning in one paragraph

Speak as Oracle: direct, no hedging. Tenet 1 overrides.`;
  let response = "(Claude unavailable)";
  try { response = await askClaude(prompt, 700); } catch (e) { warn(`DEFCON 2 Claude call failed: ${e.message}`); }
  await writeOracleContext({ defconLevel:2, defconTrigger:trigger.reason, defconDirective:response, vix:state.vix, yield10:state.yield10, equity:state.account?.equity, activeSince:utcNowIso() }, existingCtx);
  await sendEmail(`⚠ ORACLE DEFCON 2 — ${trigger.reason.slice(0,50)}`,
    `DEFCON 2 — APPROVAL RECOMMENDED\n\nTRIGGER: ${trigger.reason}\n\nORACLE RECOMMENDATION:\n${response}\n\n${etNow().toLocaleString()} ET\nOracle is watching.`);
}

async function fireDefcon3(trigger, state, existingCtx) {
  if (onCooldown("DEFCON3")) { log(`DEFCON 3 on cooldown — skipping: ${trigger.reason}`); return; }
  setCooldown("DEFCON3");
  log(`ℹ DEFCON 3 FLAGGED — ${trigger.reason}`);
  await writeOracleContext({ defconLevel:3, defconTrigger:trigger.reason, defconDirective:`Advisory flag: ${trigger.reason}. Savant should weight this in next directive.`, vix:state.vix, yield10:state.yield10, equity:state.account?.equity, activeSince:utcNowIso() }, existingCtx);
  await sendEmail(`ℹ ORACLE DEFCON 3 — ${trigger.reason.slice(0,50)}`,
    `DEFCON 3 — ADVISORY FLAG\n\n${trigger.reason}\n\nFlagged for Savant's next briefing. No immediate action required.\n\n${etNow().toLocaleString()} ET\nOracle is watching.`);
}

// ── ORACLE STRATEGIC CYCLE ────────────────────────────────────
async function mainLoop() {
  try {
    log("━━━ Oracle strategic cycle ━━━");

    const [vix, yield10, account, positions, directive, journal] = await Promise.all([
      fetchVIX(), fetchTenYearYield(), fetchAlpacaAccount(),
      fetchAlpacaPositions(), readSavantDirective(), readJournal(),
    ]);

    // Read existing context once — passed to all writes for field preservation
    let existingCtx = await readOracleContext();

    const normalizedContext = normalizeOracleContext(existingCtx);
    if (normalizedContext.changed) {
      log(`🧹 Scenario lifecycle: ${normalizedContext.reason}`);
      await writeOracleContext(normalizedContext.ctx, null);
      existingCtx = normalizedContext.ctx;
    }

    // v1.3.0 Fix B: update directive history in memory before passing to state
    const directiveHistory = updateDirectiveHistory(existingCtx?.directiveHistory || [], directive);

    const state = { vix, yield10, account, positions, directive, journal, directiveHistory };
    log(`State — VIX:${vix?.current ?? "?"} 10y:${yield10?.current ?? "?"} Eq:$${account?.equity ?? "?"} Dir:${directive?.directive ?? "?"}`);

    let contextWriteOccurred = false;

    // 1. Asymmetric Sentinel
    const triggers = await checkSentinel(state);
    if (triggers.length > 0) {
      log(`Asymmetric Sentinel triggers: ${triggers.length}`);
      const byLevel = { DEFCON1: [], DEFCON2: [], DEFCON3: [] };
      for (const t of triggers) byLevel[t.level].push(t);
      if (byLevel.DEFCON1.length)      await fireDefcon1(byLevel.DEFCON1[0], state, existingCtx);
      else if (byLevel.DEFCON2.length) await fireDefcon2(byLevel.DEFCON2[0], state, existingCtx);
      else if (byLevel.DEFCON3.length) await fireDefcon3(byLevel.DEFCON3[0], state, existingCtx);
      contextWriteOccurred = true;
    } else {
      log("Asymmetric Sentinel: all clear");
    }

    // 2. Adaptive Architect
    const arch = await runAdaptiveArchitect(state);
    if (arch) {
      log(`🏛 Architect: ${arch.signals.join(" | ")}`);
      await writeOracleContext({ architectSignals:arch.signals, architectRecommendation:arch.recommendation, vix, yield10, equity:account?.equity }, existingCtx);
      contextWriteOccurred = true;
    }

    // 3. Scenario Engine (FOMC within 7 days)
    const scen = await runScenarioEngine(state, existingCtx);
    if (scen) {
      log(`🎯 Scenario plan written (FOMC in ${scen.fomcInDays}d, stability: ${scen.matrix?.stability || "n/a"})`);
      await writeOracleContext({
        scenarioPlan: scen.plan,
        scenarioMatrix: scen.matrix,
        scenarioEvent: `FOMC in ${scen.fomcInDays} day(s) — ${scen.nextFomcDate}`,
        vix, yield10, equity: account?.equity,
        directiveHistory,
      }, existingCtx);
      contextWriteOccurred = true;

      const stabilityNote = scen.matrix?.stability === "unstable"
        ? `\n⚠ STABILITY WARNING: ${scen.matrix.stabilityReason}` : "";

      await sendEmail(
        `🎯 ORACLE SCENARIO — FOMC in ${scen.fomcInDays}d (${scen.matrix?.dominantBranch || "?"} ${scen.matrix?.dominantProbability || "?"}%)`,
        `SCENARIO ENGINE — FOMC ${scen.nextFomcDate} — ${scen.fomcInDays} day(s)\n\n` +
        scen.plan + stabilityNote + `\n\n${etNow().toLocaleString()} ET\nOracle is watching.`
      );
    }

    // 4. Baseline context (Fix D: FOMC window forces frequent writes)
    await ensureBaselineOracleContext(state, contextWriteOccurred, existingCtx, directiveHistory);

    // 5. Outcome Attribution (Fix F: runs 20-72h post-FOMC)
    await runOutcomeAttribution(state, existingCtx);

    // 6. Socratic Loop (Phase 4 — deferred)
    await runSocraticLoop(state);

    // v1.3.0 Fix A: check heartbeat (only alerts if write cycle just failed)
    // Note: called at END of loop so we don't alert on in-progress writes
    await checkHeartbeat();

  } catch (e) {
    err(`Main loop exception: ${e.message}`);
  }
}

// ── HEALTH SERVER ─────────────────────────────────────────────
function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        service: "oracle-intelligence",
        version: ORACLE_VERSION,
        marketHours: isMarketHours(),
        oracleGistId: ORACLE_GIST_ID ? "set" : "not-set",
        lastContextWriteMinutesAgo: +((Date.now() - lastContextWriteTime) / 60000).toFixed(1),
        cooldowns: Object.fromEntries(Object.entries(COOLDOWNS).map(([k,v]) => [k, v ? Math.max(0, COOLDOWN_MS-(Date.now()-v)) : 0])),
        timestamp: utcNowIso(),
      }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Oracle is watching.\n");
  });
  server.listen(CONFIG.PORT, () => log(`Oracle status server on port ${CONFIG.PORT}`));
}

// ── BOOT ──────────────────────────────────────────────────────
async function boot() {
  log(`◈◈◈ ORACLE INTELLIGENCE ENGINE v${ORACLE_VERSION} STARTING ◈◈◈`);
  log(`Claude API: ${CONFIG.CLAUDE_API_KEY ? "✓ Configured" : "✗ Not configured"}`);
  // v1.4.0: self-healing model resolution at boot
  const resolvedModel = await resolveModel(CONFIG.CLAUDE_API_KEY, log);
  log(`Claude model: ${resolvedModel} (self-healing resolver active)`);
  log(`GitHub:     ${CONFIG.GITHUB_TOKEN ? "✓ Configured" : "✗ Not configured"}`);
  log(`Alpaca:     ${CONFIG.ALPACA_KEY_ID ? "✓ Configured" : "✗ Not configured"}`);
  log(`Email:      ${CONFIG.RESEND_KEY ? "✓ Configured" : "✗ Not configured"}`);
  log(`Bridge:     ${CONFIG.GITHUB_GIST_ID ? "✓ Connected" : "⚠ GITHUB_GIST_ID not set"}`);
  log(`Journal:    ${CONFIG.GITHUB_JOURNAL_ID ? "✓ Connected" : "⚠ GITHUB_JOURNAL_ID not set"}`);
  log(`Oracle ctx: ${ORACLE_GIST_ID ? "✓ Connected" : "⚠ Will bootstrap on first cycle"}`);
  log(`Cadence:    5min market hours · 30min after hours · 4hr DEFCON cooldowns`);

  const fomcInDays = daysUntilNextFOMC();
  if (fomcInDays != null && fomcInDays <= 7) {
    log(`⚠ FOMC WINDOW ACTIVE: ${fomcInDays} day(s) to next FOMC — forced writes every cycle`);
  }

  startServer();
  await mainLoop();

  // Market-hours tick every 5 min
  setInterval(async () => { if (isMarketHours()) await mainLoop(); }, 5 * 60 * 1000);

  // After-hours tick every 30 min
  setInterval(async () => { if (!isMarketHours()) await mainLoop(); }, 30 * 60 * 1000);

  // v1.3.0 Fix A: heartbeat monitor every 30 min
  setInterval(checkHeartbeat, 30 * 60 * 1000);

  const fomcStatus = fomcInDays != null
    ? `FOMC ${FOMC_2026.find(d => new Date(d+"T14:00:00-04:00") >= etNow())} — ${fomcInDays} day(s) away${fomcInDays <= 7 ? " ⚠ FOMC WINDOW ACTIVE" : ""}`
    : "No upcoming FOMC in 2026 calendar";

  await sendEmail(
    `◈ ORACLE v${ORACLE_VERSION} ONLINE`,
    `Oracle Intelligence Engine v${ORACLE_VERSION} has started.\n\n` +
    `── SYSTEM STATUS ──────────────────────\n` +
    `Claude API:  ${CONFIG.CLAUDE_API_KEY ? "✓ Configured" : "✗ Not configured"}\n` +
    `Bridge:      ${CONFIG.GITHUB_GIST_ID ? "✓ Connected" : "⚠ Not set — DEFCON triggers will not read directive"}\n` +
    `Journal:     ${CONFIG.GITHUB_JOURNAL_ID ? "✓ Connected" : "⚠ Not set — win-rate DEFCON trigger inactive"}\n` +
    `Oracle Gist: ${ORACLE_GIST_ID ? "✓ Connected" : "⚠ Will bootstrap on first cycle"}\n` +
    `Cadence:     5min market hours · 30min after hours\n\n` +
    `── v1.3.0 FIXES ACTIVE ────────────────\n` +
    `Fix A: Service heartbeat — alert if no write >2h during market hours\n` +
    `Fix B: Two broken DEFCON triggers repaired (directive history + win rate)\n` +
    `Fix C: Structured scenario engine — JSON matrix + Savant-compat text\n` +
    `Fix D: FOMC-window forced writes — 8-min refresh threshold (was 26h)\n` +
    `Fix E: Probability stability gate — flags >15pp shift without catalyst\n` +
    `Fix F: Outcome attribution — auto-verdict 20-72h post-FOMC\n\n` +
    `── DEFCON THRESHOLDS ──────────────────\n` +
    `DEFCON 1: VIX +20% spike OR portfolio -3% intraday\n` +
    `DEFCON 2: VIX ≥25 OR portfolio -2% OR same directive 7+ days [NOW ACTIVE]\n` +
    `DEFCON 3: 3+ loss streak OR win rate <30% [NOW ACTIVE] OR FOMC ≤3 days\n\n` +
    `── NEXT FOMC ──────────────────────────\n` +
    `${fomcStatus}\n\n` +
    `${etNow().toLocaleString()} ET\nOracle is watching.`
  );
}

boot().catch(e => { console.error("ORACLE FATAL:", e.message); process.exit(1); });
