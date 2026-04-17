// ============================================================
// ORACLE — Strategic Intelligence Engine v1
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
//   3. The Scenario Engine      — FOMC / earnings pre-gaming
//   4. The Socratic Loop        — post-mortem decision quality (Phase 4)
//   5. The Unified Portfolio Lens — combined exposure view (Phase 5)
//
// Oracle is watching. 🔮
// ============================================================

const https = require("https");
const http  = require("http");

// ── CONFIG ────────────────────────────────────────────────────
const CONFIG = {
  CLAUDE_API_KEY:    process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY,
  CLAUDE_MODEL:      process.env.CLAUDE_MODEL   || "claude-sonnet-4-20250514",
  GITHUB_TOKEN:      process.env.GITHUB_TOKEN,
  GITHUB_GIST_ID:    process.env.GITHUB_GIST_ID,      // Savant directive (read)
  GITHUB_JOURNAL_ID: process.env.GITHUB_JOURNAL_ID,   // trade journal (read)
  GITHUB_ORACLE_ID:  process.env.GITHUB_ORACLE_ID,    // oracle-context (read/write, blank on first deploy)
  ALPACA_KEY_ID:     process.env.ALPACA_KEY_ID,
  ALPACA_SECRET_KEY: process.env.ALPACA_SECRET_KEY,
  ALPACA_PAPER:      process.env.ALPACA_PAPER !== "false",
  RESEND_KEY:        process.env.RESEND_KEY,
  EMAIL_FROM:        process.env.EMAIL_FROM || "onboarding@resend.dev",
  EMAIL_TO:          process.env.EMAIL_TO   || "nicholas@coraemjen.com",
  PORT:              process.env.PORT || 8080,
};

const ALPACA_HOST = CONFIG.ALPACA_PAPER
  ? "paper-api.alpaca.markets"
  : "api.alpaca.markets";

// In-memory state (resets on container restart; Gist is source of truth)
const COOLDOWNS = { DEFCON1: 0, DEFCON2: 0, DEFCON3: 0, SCENARIO: 0, ARCHITECT: 0 };
const COOLDOWN_MS = 4 * 60 * 60 * 1000;  // 4 hours
let ORACLE_GIST_ID = CONFIG.GITHUB_ORACLE_ID || null;

// ── LOG ───────────────────────────────────────────────────────
function etNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function tsET() {
  return etNow().toLocaleTimeString("en-US", { hour12: true });
}
function log(msg)  { console.log(`[${tsET()} ET] [ORACLE] [INFO]  ${msg}`); }
function warn(msg) { console.log(`[${tsET()} ET] [ORACLE] [WARN]  ${msg}`); }
function err(msg)  { console.log(`[${tsET()} ET] [ORACLE] [ERROR] ${msg}`); }

// ── MARKET HOURS ──────────────────────────────────────────────
function isMarketHours() {
  const now = etNow();
  const day = now.getDay();              // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const h = now.getHours();
  const m = now.getMinutes();
  const mins = h * 60 + m;
  return mins >= 570 && mins < 960;      // 9:30 AM – 4:00 PM ET
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
  const res = await httpsRequest({
    host, path, method: "GET",
    headers: { "User-Agent": "oracle/1.0", ...headers },
  }, null, timeoutMs);
  return res;
}

async function apiPost(host, path, headers, body, timeoutMs = 30000) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const res = await httpsRequest({
    host, path, method: "POST",
    headers: {
      "User-Agent": "oracle/1.0",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      ...headers,
    },
  }, payload, timeoutMs);
  return res;
}

async function apiPatch(host, path, headers, body, timeoutMs = 30000) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const res = await httpsRequest({
    host, path, method: "PATCH",
    headers: {
      "User-Agent": "oracle/1.0",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      ...headers,
    },
  }, payload, timeoutMs);
  return res;
}

// ── GIST I/O ──────────────────────────────────────────────────
async function readGist(gistId) {
  if (!gistId) return null;
  const res = await apiGet("api.github.com", `/gists/${gistId}`, {
    "Authorization": `token ${CONFIG.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
  });
  if (res.status !== 200) {
    warn(`Gist read ${gistId} failed: ${res.status}`);
    return null;
  }
  try {
    const data = JSON.parse(res.body);
    const firstFile = Object.values(data.files)[0];
    return firstFile ? firstFile.content : null;
  } catch (e) {
    err(`Gist parse failed: ${e.message}`);
    return null;
  }
}

async function writeGist(gistId, filename, content) {
  const res = await apiPatch("api.github.com", `/gists/${gistId}`, {
    "Authorization": `token ${CONFIG.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
  }, {
    files: { [filename]: { content } },
  });
  if (res.status !== 200) throw new Error(`Gist write failed: ${res.status} ${res.body.slice(0, 200)}`);
  return true;
}

async function createGist(filename, content, description) {
  const res = await apiPost("api.github.com", "/gists", {
    "Authorization": `token ${CONFIG.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
  }, {
    description: description || "Oracle strategic context",
    public: false,
    files: { [filename]: { content } },
  });
  if (res.status !== 201) throw new Error(`Gist create failed: ${res.status} ${res.body.slice(0, 200)}`);
  const data = JSON.parse(res.body);
  return data.id;
}

// ── ORACLE CONTEXT READ/WRITE ─────────────────────────────────
async function readOracleContext() {
  if (!ORACLE_GIST_ID) return null;
  const raw = await readGist(ORACLE_GIST_ID);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function writeOracleContext(ctx) {
  const payload = {
    schemaVersion: "1.0",
    updatedAt: etNow().toISOString(),
    ...ctx,
  };
  const content = JSON.stringify(payload, null, 2);

  if (!ORACLE_GIST_ID) {
    ORACLE_GIST_ID = await createGist("oracle-context.json", content, "Oracle strategic context — read by Savant at 9 AM");
    log(`🔮 Oracle Context Gist created — GITHUB_ORACLE_ID=${ORACLE_GIST_ID}`);
    log(`   Set this env var on BOTH oracle-intelligence AND savant-intelligence.`);
  } else {
    await writeGist(ORACLE_GIST_ID, "oracle-context.json", content);
  }
  return ORACLE_GIST_ID;
}

// ── DATA FETCHERS ─────────────────────────────────────────────
async function fetchVIX() {
  try {
    const res = await apiGet(
      "query1.finance.yahoo.com",
      "/v8/finance/chart/%5EVIX?interval=1d&range=5d",
      {}, 8000
    );
    if (res.status !== 200) return null;
    const data = JSON.parse(res.body);
    const r = data?.chart?.result?.[0];
    if (!r) return null;
    const closes = (r.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    if (last == null || prev == null) return null;
    return {
      current: +last.toFixed(2),
      previous: +prev.toFixed(2),
      changePct: +(((last - prev) / prev) * 100).toFixed(2),
    };
  } catch (e) {
    warn(`VIX fetch failed: ${e.message}`);
    return null;
  }
}

async function fetchTenYearYield() {
  try {
    const res = await apiGet(
      "query1.finance.yahoo.com",
      "/v8/finance/chart/%5ETNX?interval=1d&range=30d",
      {}, 8000
    );
    if (res.status !== 200) return null;
    const data = JSON.parse(res.body);
    const r = data?.chart?.result?.[0];
    const closes = (r?.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    if (closes.length < 2) return null;
    const last = closes[closes.length - 1];
    const monthAgo = closes[0];
    return {
      current: +last.toFixed(2),
      monthAgo: +monthAgo.toFixed(2),
      change30d: +(last - monthAgo).toFixed(2),
    };
  } catch (e) {
    warn(`10y yield fetch failed: ${e.message}`);
    return null;
  }
}

async function fetchAlpacaAccount() {
  try {
    const res = await apiGet(ALPACA_HOST, "/v2/account", {
      "APCA-API-KEY-ID": CONFIG.ALPACA_KEY_ID,
      "APCA-API-SECRET-KEY": CONFIG.ALPACA_SECRET_KEY,
    }, 10000);
    if (res.status !== 200) return null;
    return JSON.parse(res.body);
  } catch (e) {
    warn(`Alpaca account fetch failed: ${e.message}`);
    return null;
  }
}

async function fetchAlpacaPositions() {
  try {
    const res = await apiGet(ALPACA_HOST, "/v2/positions", {
      "APCA-API-KEY-ID": CONFIG.ALPACA_KEY_ID,
      "APCA-API-SECRET-KEY": CONFIG.ALPACA_SECRET_KEY,
    }, 10000);
    if (res.status !== 200) return [];
    return JSON.parse(res.body);
  } catch (e) {
    warn(`Alpaca positions fetch failed: ${e.message}`);
    return [];
  }
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
async function askClaude(prompt, maxTokens = 1024) {
  const body = {
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  const res = await apiPost("api.anthropic.com", "/v1/messages", {
    "x-api-key": CONFIG.CLAUDE_API_KEY,
    "anthropic-version": "2023-06-01",
  }, body, 60000);
  if (res.status !== 200) throw new Error(`Claude API ${res.status}: ${res.body.slice(0, 200)}`);
  const data = JSON.parse(res.body);
  return data.content?.[0]?.text || "";
}

// ── EMAIL ─────────────────────────────────────────────────────
async function sendEmail(subject, body) {
  if (!CONFIG.RESEND_KEY) { warn("RESEND_KEY not set — skipping email"); return; }
  try {
    const res = await apiPost("api.resend.com", "/emails", {
      "Authorization": `Bearer ${CONFIG.RESEND_KEY}`,
    }, {
      from: CONFIG.EMAIL_FROM,
      to: CONFIG.EMAIL_TO,
      subject,
      text: body,
    }, 15000);
    if (res.status >= 200 && res.status < 300) {
      log(`📧 Email sent: ${subject}`);
    } else {
      warn(`Email failed: ${res.status} ${res.body.slice(0, 150)}`);
    }
  } catch (e) {
    warn(`Email error: ${e.message}`);
  }
}

// ── COOLDOWN HELPERS ──────────────────────────────────────────
function onCooldown(level) {
  return Date.now() - (COOLDOWNS[level] || 0) < COOLDOWN_MS;
}
function setCooldown(level) {
  COOLDOWNS[level] = Date.now();
}

// ── ANALYSIS ENGINES ──────────────────────────────────────────

// 1. THE ASYMMETRIC SENTINEL — evaluates DEFCON conditions
async function checkSentinel(state) {
  const triggers = [];
  const { vix, account, journal, directive } = state;

  // DEFCON 1: VIX spike +20% OR portfolio -3% intraday
  if (vix && vix.changePct >= 20) {
    triggers.push({ level: "DEFCON1", reason: `VIX spiked ${vix.changePct}% (${vix.previous} → ${vix.current})` });
  }
  if (account) {
    const equity = +account.equity;
    const lastEquity = +account.last_equity;
    if (lastEquity > 0) {
      const pct = ((equity - lastEquity) / lastEquity) * 100;
      if (pct <= -3) {
        triggers.push({ level: "DEFCON1", reason: `Portfolio -${Math.abs(pct).toFixed(2)}% intraday ($${lastEquity.toFixed(0)} → $${equity.toFixed(0)})` });
      } else if (pct <= -2) {
        triggers.push({ level: "DEFCON2", reason: `Portfolio -${Math.abs(pct).toFixed(2)}% intraday` });
      }
    }
  }

  // DEFCON 2: VIX crosses 25 OR same directive 7+ days
  if (vix && vix.current >= 25 && vix.previous < 25) {
    triggers.push({ level: "DEFCON2", reason: `VIX crossed 25 (${vix.previous} → ${vix.current})` });
  }
  const stuckDays = countConsecutiveSameDirective(journal);
  if (stuckDays >= 7) {
    triggers.push({ level: "DEFCON2", reason: `Same directive (${directive?.mode || "?"}) for ${stuckDays} consecutive days` });
  }

  // DEFCON 3: 3+ loss streak OR win rate <30% OR FOMC within 3 days
  const lossStreak = countLossStreak(journal);
  if (lossStreak >= 3) {
    triggers.push({ level: "DEFCON3", reason: `${lossStreak} consecutive losses` });
  }
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

function countConsecutiveSameDirective(journal) {
  const d = (journal?.directives || []).slice().reverse();
  if (d.length === 0) return 0;
  const top = d[0].mode;
  let n = 0;
  for (const row of d) { if (row.mode === top) n++; else break; }
  return n;
}

function countLossStreak(journal) {
  const t = (journal?.trades || []).slice().reverse();
  let n = 0;
  for (const tr of t) {
    const pnl = +tr.pnl || 0;
    if (pnl < 0) n++; else break;
  }
  return n;
}

function computeWinRate(journal) {
  const t = (journal?.trades || []).filter(x => x.pnl != null);
  if (t.length === 0) return null;
  const wins = t.filter(x => +x.pnl > 0).length;
  return wins / t.length;
}

// 2. THE ADAPTIVE ARCHITECT — detects regime change
async function runAdaptiveArchitect(state) {
  if (onCooldown("ARCHITECT")) return null;
  const { vix, yield10, directive } = state;
  if (!vix || !yield10) return null;

  const signals = [];
  if (vix.current >= 25 && (directive?.regime || "").includes("bull")) {
    signals.push(`VIX at ${vix.current} inconsistent with ${directive.regime} regime`);
  }
  if (vix.current < 15 && (directive?.mode || "") === "REDUCED_RISK") {
    signals.push(`VIX calm (${vix.current}) but directive still REDUCED_RISK`);
  }
  if (yield10.change30d >= 0.50) {
    signals.push(`10y yield +${yield10.change30d.toFixed(2)} in 30d — TQQQ headwind`);
  }
  if (signals.length === 0) return null;

  setCooldown("ARCHITECT");
  return { signals, recommendation: "Re-examine regime assumption at next briefing" };
}

// 3. THE SCENARIO ENGINE — FOMC / earnings pre-gaming
async function runScenarioEngine(state) {
  if (onCooldown("SCENARIO")) return null;
  const fomcInDays = daysUntilNextFOMC();
  if (fomcInDays == null || fomcInDays < 0 || fomcInDays > 7) return null;

  const prompt = `You are Oracle, the strategic intelligence layer of the Apex Trading System.
Nicholas runs a $100K paper portfolio trading TQQQ, GDXJ, SLV with SGOV defensive posture.

An FOMC meeting is in ${fomcInDays} day(s). Current state:
- VIX: ${state.vix?.current ?? "n/a"} (${state.vix?.changePct ?? "n/a"}% day)
- 10y yield: ${state.yield10?.current ?? "n/a"}% (${state.yield10?.change30d ?? "n/a"} 30d)
- Portfolio equity: $${state.account?.equity ?? "n/a"}
- Current directive: ${state.directive?.mode ?? "n/a"} / ${state.directive?.regime ?? "n/a"}

Produce a concise scenario plan in <=180 words:
1. Three plausible outcomes (dovish hold, hawkish hold, cut surprise) with TQQQ/GDXJ/SLV directional bias
2. One specific positioning recommendation for the 48h before the meeting
3. One "do not do this" warning

Be direct. No hedging. Speak as a veteran.`;

  try {
    const text = await askClaude(prompt, 800);
    setCooldown("SCENARIO");
    return { fomcInDays, plan: text };
  } catch (e) {
    warn(`Scenario engine Claude call failed: ${e.message}`);
    return null;
  }
}

// 4. THE SOCRATIC LOOP — post-mortem (Phase 4 stub, activates with more trade history)
async function runSocraticLoop(state) {
  const trades = state.journal?.trades || [];
  if (trades.length < 10) return null;  // need enough data
  // Phase 4 — full implementation deferred. Return a placeholder signal for now.
  return null;
}

// ── FOMC CALENDAR ─────────────────────────────────────────────
// 2026 FOMC meetings (published schedule)
const FOMC_2026 = [
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
  "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-16",
];
function daysUntilNextFOMC() {
  const now = etNow();
  for (const d of FOMC_2026) {
    const t = new Date(d + "T14:00:00-04:00");
    if (t >= now) {
      const diff = Math.floor((t - now) / (24 * 60 * 60 * 1000));
      return diff;
    }
  }
  return null;
}

// ── DEFCON HANDLERS ───────────────────────────────────────────
async function fireDefcon1(trigger, state) {
  if (onCooldown("DEFCON1")) { log(`DEFCON 1 on cooldown — skipping: ${trigger.reason}`); return; }
  setCooldown("DEFCON1");
  log(`🚨 DEFCON 1 FIRED — ${trigger.reason}`);

  const prompt = `You are Oracle. DEFCON 1 has fired. This is the highest alert — autonomous intervention authorized.

TRIGGER: ${trigger.reason}

CURRENT STATE:
- VIX: ${state.vix?.current} (${state.vix?.changePct}% day)
- Portfolio: $${state.account?.equity} (${pctChange(state.account)}% intraday)
- Positions: ${(state.positions || []).map(p => `${p.symbol} ${p.qty} @ ${(+p.unrealized_plpc * 100).toFixed(1)}%`).join(", ") || "none"}
- Current directive: ${state.directive?.mode} / ${state.directive?.regime}

Produce a DEFCON 1 crisis directive in <=150 words:
1. Immediate posture (STAND_DOWN / REDUCED_RISK / HOLD)
2. TQQQ/GDXJ/SLV max allocation caps for next 24h
3. One sentence: what you're protecting against

Be blunt. No caveats.`;

  let response = "(Claude unavailable)";
  try { response = await askClaude(prompt, 600); } catch (e) { warn(`DEFCON 1 Claude call failed: ${e.message}`); }

  await writeOracleContext({
    defconLevel: 1,
    defconTrigger: trigger.reason,
    defconDirective: response,
    vix: state.vix,
    yield10: state.yield10,
    equity: state.account?.equity,
    activeSince: etNow().toISOString(),
  });

  await sendEmail(
    `🚨 ORACLE DEFCON 1 — ${trigger.reason.slice(0, 50)}`,
    `DEFCON 1 — AUTONOMOUS INTERVENTION\n\nTRIGGER: ${trigger.reason}\n\nORACLE DIRECTIVE:\n${response}\n\n${etNow().toLocaleString()} ET\nOracle is watching.`
  );
}

async function fireDefcon2(trigger, state) {
  if (onCooldown("DEFCON2")) { log(`DEFCON 2 on cooldown — skipping: ${trigger.reason}`); return; }
  setCooldown("DEFCON2");
  log(`⚠ DEFCON 2 FIRED — ${trigger.reason}`);

  const prompt = `You are Oracle. DEFCON 2 has fired. Approval-level alert — recommend action to Nicholas for sign-off.

TRIGGER: ${trigger.reason}

CURRENT STATE:
- VIX: ${state.vix?.current} (${state.vix?.changePct}% day)
- Portfolio: $${state.account?.equity}
- Current directive: ${state.directive?.mode} / ${state.directive?.regime}

Produce a DEFCON 2 recommendation in <=200 words:
1. What should change in the next directive cycle
2. Specific allocation shifts (TQQQ/GDXJ/SLV)
3. The reasoning in one paragraph

Speak as a seasoned advisor to his successor. Direct. No hedging.`;

  let response = "(Claude unavailable)";
  try { response = await askClaude(prompt, 700); } catch (e) { warn(`DEFCON 2 Claude call failed: ${e.message}`); }

  await writeOracleContext({
    defconLevel: 2,
    defconTrigger: trigger.reason,
    defconDirective: response,
    vix: state.vix,
    yield10: state.yield10,
    equity: state.account?.equity,
    activeSince: etNow().toISOString(),
  });

  await sendEmail(
    `⚠ ORACLE DEFCON 2 — ${trigger.reason.slice(0, 50)}`,
    `DEFCON 2 — APPROVAL RECOMMENDED\n\nTRIGGER: ${trigger.reason}\n\nORACLE RECOMMENDATION:\n${response}\n\nReply to approve or override.\n\n${etNow().toLocaleString()} ET\nOracle is watching.`
  );
}

async function fireDefcon3(trigger, state) {
  if (onCooldown("DEFCON3")) { log(`DEFCON 3 on cooldown — skipping: ${trigger.reason}`); return; }
  setCooldown("DEFCON3");
  log(`ℹ DEFCON 3 FLAGGED — ${trigger.reason}`);

  await writeOracleContext({
    defconLevel: 3,
    defconTrigger: trigger.reason,
    defconDirective: `Advisory flag: ${trigger.reason}. Savant should weight this in next directive.`,
    vix: state.vix,
    yield10: state.yield10,
    equity: state.account?.equity,
    activeSince: etNow().toISOString(),
  });

  await sendEmail(
    `ℹ ORACLE DEFCON 3 — ${trigger.reason.slice(0, 50)}`,
    `DEFCON 3 — ADVISORY FLAG\n\n${trigger.reason}\n\nFlagged for Savant's next briefing. No immediate action required.\n\n${etNow().toLocaleString()} ET\nOracle is watching.`
  );
}

function pctChange(account) {
  if (!account) return "?";
  const eq = +account.equity, last = +account.last_equity;
  if (!last) return "?";
  return (((eq - last) / last) * 100).toFixed(2);
}

// ── MAIN LOOP ─────────────────────────────────────────────────
async function mainLoop() {
  try {
    log("━━━ Sentinel cycle ━━━");

    const [vix, yield10, account, positions, directive, journal] = await Promise.all([
      fetchVIX(),
      fetchTenYearYield(),
      fetchAlpacaAccount(),
      fetchAlpacaPositions(),
      readSavantDirective(),
      readJournal(),
    ]);

    const state = { vix, yield10, account, positions, directive, journal };

    log(`State — VIX:${vix?.current ?? "?"} 10y:${yield10?.current ?? "?"} Eq:$${account?.equity ?? "?"} Dir:${directive?.mode ?? "?"}`);

    // 1. Sentinel — DEFCON triggers
    const triggers = await checkSentinel(state);
    if (triggers.length > 0) {
      log(`Sentinel triggers: ${triggers.length}`);
      // Fire highest severity first; stop after firing
      const byLevel = { DEFCON1: [], DEFCON2: [], DEFCON3: [] };
      for (const t of triggers) byLevel[t.level].push(t);
      if (byLevel.DEFCON1.length) await fireDefcon1(byLevel.DEFCON1[0], state);
      else if (byLevel.DEFCON2.length) await fireDefcon2(byLevel.DEFCON2[0], state);
      else if (byLevel.DEFCON3.length) await fireDefcon3(byLevel.DEFCON3[0], state);
    } else {
      log("Sentinel: all clear");
    }

    // 2. Adaptive Architect
    const arch = await runAdaptiveArchitect(state);
    if (arch) {
      log(`🏛 Architect: ${arch.signals.join(" | ")}`);
      await writeOracleContext({
        architectSignals: arch.signals,
        architectRecommendation: arch.recommendation,
        vix, yield10,
        equity: account?.equity,
      });
    }

    // 3. Scenario Engine (FOMC within 7 days)
    const scen = await runScenarioEngine(state);
    if (scen) {
      log(`🎯 Scenario plan written (FOMC in ${scen.fomcInDays}d)`);
      await writeOracleContext({
        scenarioPlan: scen.plan,
        scenarioEvent: `FOMC in ${scen.fomcInDays} day(s)`,
        vix, yield10,
        equity: account?.equity,
      });
      await sendEmail(
        `🎯 ORACLE SCENARIO — FOMC in ${scen.fomcInDays}d`,
        `SCENARIO ENGINE — PRE-GAMING\n\nEvent: FOMC in ${scen.fomcInDays} day(s)\n\n${scen.plan}\n\n${etNow().toLocaleString()} ET\nOracle is watching.`
      );
    }

    // 4. Socratic Loop (Phase 4 — deferred)
    await runSocraticLoop(state);

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
        marketHours: isMarketHours(),
        oracleGistId: ORACLE_GIST_ID ? "set" : "not-set",
        cooldowns: Object.fromEntries(Object.entries(COOLDOWNS).map(([k, v]) => [k, v ? Math.max(0, COOLDOWN_MS - (Date.now() - v)) : 0])),
        timestamp: etNow().toISOString(),
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
  log("◈◈◈ ORACLE INTELLIGENCE ENGINE v1 STARTING ◈◈◈");
  log(`Claude API: ${CONFIG.CLAUDE_API_KEY ? "✓ Configured" : "✗ Not configured"}`);
  log(`GitHub:     ${CONFIG.GITHUB_TOKEN ? "✓ Configured" : "✗ Not configured"}`);
  log(`Alpaca:     ${CONFIG.ALPACA_KEY_ID ? "✓ Configured" : "✗ Not configured"}`);
  log(`Email:      ${CONFIG.RESEND_KEY ? "✓ Configured" : "✗ Not configured"}`);
  log(`Bridge:     ${CONFIG.GITHUB_GIST_ID ? "✓ Connected" : "⚠ GITHUB_GIST_ID not set"}`);
  log(`Journal:    ${CONFIG.GITHUB_JOURNAL_ID ? "✓ Connected" : "⚠ GITHUB_JOURNAL_ID not set"}`);
  log(`Oracle ctx: ${ORACLE_GIST_ID ? "✓ Connected" : "⚠ Will create on first fire"}`);
  log(`Cadence:    Market hours 5min · After hours 30min · 4hr DEFCON cooldowns`);

  startServer();

  // Initial sentinel check
  await mainLoop();

  // Market-hours tick every 5 min
  setInterval(async () => {
    if (isMarketHours()) await mainLoop();
  }, 5 * 60 * 1000);

  // After-hours tick every 30 min
  setInterval(async () => {
    if (!isMarketHours()) await mainLoop();
  }, 30 * 60 * 1000);

  await sendEmail(
    "◈ ORACLE INTELLIGENCE ENGINE v1 ONLINE",
    `Oracle v1 has started.\n\n` +
    `CAPABILITIES ACTIVE:\n` +
    `• The Asymmetric Sentinel — DEFCON 1/2/3 trigger system\n` +
    `• The Adaptive Architect — regime change detection\n` +
    `• The Scenario Engine — FOMC/earnings pre-gaming\n` +
    `• The Socratic Loop — post-mortem quality scoring (Phase 4)\n` +
    `• The Unified Portfolio Lens — combined exposure (Phase 5)\n\n` +
    `DEFCON THRESHOLDS:\n` +
    `DEFCON 1 (autonomous): VIX +20% spike OR portfolio -3% intraday\n` +
    `DEFCON 2 (approval):   VIX crosses 25 OR portfolio -2% OR same directive 7+ days\n` +
    `DEFCON 3 (flag only):  3+ loss streak OR win rate <30% OR FOMC within 3 days\n\n` +
    `CADENCE: 5min market hours · 30min after hours · 4hr cooldowns\n\n` +
    `${etNow().toLocaleString()} ET\n` +
    `Oracle is watching.`
  );
}

boot().catch(e => { console.error("ORACLE FATAL:", e.message); process.exit(1); });
