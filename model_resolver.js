// ============================================================
// MODEL RESOLVER — Shared self-healing Claude model resolution
// Used by Savant v2.3, Oracle v1.4, Herald v1.1
//
// Implements Pillar 1 of the Autonomy & Resilience Design:
//   • No hardcoded model strings in any service
//   • Boot-time resolution against Anthropic Models API
//   • Automatic re-resolution on 404 / model_not_found
//   • CLAUDE_MODEL env var treated as preference, not hard dep
//   • Falls back gracefully if Models API is unreachable
//
// SAFETY: Model selection is not a risk decision. This module
// never touches directives, allocations, or trading logic.
// ============================================================

const https = require("https");

// Known good models in preference order — newest first.
// Updated when Anthropic releases new models. These are the
// fallback candidates if the Models API is unreachable.
const KNOWN_GOOD_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
];

// Cache resolved model per process — re-resolve on failure only
let _resolvedModel = null;
let _lastResolutionTime = 0;
const RESOLUTION_CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours

// ── Fetch current model list from Anthropic ────────────────────
async function fetchLiveModels(apiKey) {
  return new Promise((resolve) => {
    if (!apiKey) { resolve(null); return; }
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/models",
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "User-Agent": "apex-model-resolver/1.0",
      },
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) { resolve(null); return; }
          const body = JSON.parse(d);
          resolve(body.data || null);
        } catch (_) { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── Select best model from live list ──────────────────────────
function selectFromLiveModels(models, preference) {
  if (!models || !models.length) return null;
  const ids = models.map(m => m.id || m);

  // 1. Exact preference match
  if (preference && ids.includes(preference)) return preference;

  // 2. Newest sonnet-4 variant
  const sonnets = ids
    .filter(id => /claude-sonnet-4/i.test(id))
    .sort()
    .reverse();
  if (sonnets.length) return sonnets[0];

  // 3. Any claude-4 variant
  const claude4 = ids
    .filter(id => /claude-(sonnet|opus|haiku)-4/i.test(id))
    .sort()
    .reverse();
  if (claude4.length) return claude4[0];

  // 4. Any non-deprecated model
  return ids[0] || null;
}

// ── Primary resolution function ───────────────────────────────
// Called at boot and on failure. Returns a live model string.
// Never throws — returns a known-good fallback on all errors.
async function resolveModel(apiKey, logFn) {
  const log = logFn || console.log;
  const now = Date.now();
  const preference = process.env.CLAUDE_MODEL || null;

  // Use cache if fresh and not a forced re-resolution
  if (_resolvedModel && (now - _lastResolutionTime) < RESOLUTION_CACHE_MS) {
    return _resolvedModel;
  }

  log(`[ModelResolver] Resolving live Claude model (preference: ${preference || "none"})...`);

  const liveModels = await fetchLiveModels(apiKey);

  if (liveModels) {
    const selected = selectFromLiveModels(liveModels, preference);
    if (selected) {
      const changed = _resolvedModel && _resolvedModel !== selected;
      _resolvedModel = selected;
      _lastResolutionTime = now;
      if (changed) {
        log(`[ModelResolver] ⚡ Model changed: ${_resolvedModel} → ${selected}`);
      } else {
        log(`[ModelResolver] ✓ Resolved: ${selected} (from ${liveModels.length} live models)`);
      }
      return selected;
    }
  }

  // Models API unreachable — use preference or known-good fallback
  const fallback = preference || KNOWN_GOOD_MODELS[0];
  log(`[ModelResolver] ⚠ Models API unreachable — using ${fallback} as fallback`);
  _resolvedModel = fallback;
  _lastResolutionTime = now;
  return fallback;
}

// ── On-failure re-resolution ───────────────────────────────────
// Called when a Claude API call returns 404 or model_not_found.
// Forces a fresh resolution bypassing the cache.
async function resolveOnFailure(apiKey, failedModel, logFn) {
  const log = logFn || console.log;
  log(`[ModelResolver] ⚠ Model '${failedModel}' returned failure — forcing re-resolution`);
  _lastResolutionTime = 0; // bust cache
  _resolvedModel = null;
  return resolveModel(apiKey, log);
}

// ── Get current resolved model (sync, no API call) ────────────
function currentModel() {
  return _resolvedModel || process.env.CLAUDE_MODEL || KNOWN_GOOD_MODELS[0];
}

module.exports = { resolveModel, resolveOnFailure, currentModel };
