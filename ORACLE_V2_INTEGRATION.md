# Oracle v2.0 Shadow Integration

## Purpose
Oracle v2 is an independent strategic-governance service. It exists to test whether an orthogonal market-structure and mandate-audit layer adds value to the stabilized Savant/Apex system.

It is deliberately **not** a second portfolio manager.

## Hard authority contract
Oracle v2 ships with four false capabilities in every persisted record and health response:

- `canTrade = false`
- `canSetTargetWeights = false`
- `canOverrideSavant = false`
- `canIncreaseRisk = false`

No v2 module contains an Alpaca order endpoint or a Savant write endpoint.

## Daily evidence cycle
- 08:35–08:55 ET: **pre-open independent read**. Oracle forms a market-structure view before consuming Savant's new directive.
- 09:05–09:25 ET: **decision audit**. Oracle reads Savant's published directive and records agreement/disagreement, evidence, counter-evidence, falsification conditions, and confidence.
- 16:05–16:30 ET: **close evidence**. Oracle records QQQ/SPY and account daily returns and updates the provisional mandate scorecard.
- Every 5 sessions: mature shadow challenges receive a directional outcome score. This is evidence, not a counterfactual return claim.

## Current independent inputs
Oracle v2 initially reads liquid public proxies:

- QQQ, SPY — mandate/benchmark trend
- RSP — equal-weight breadth proxy
- IWM — small-cap participation proxy
- HYG/TLT — credit-versus-duration proxy
- VIX — volatility regime
- 10Y yield (`^TNX`) — rates context
- GLD, SLV, GDXJ — metals context

These are intentionally modest. Do not add large indicator catalogs until the shadow ledger shows that a missing variable would improve discrimination.

## Persistence
Oracle v2 uses a **separate private GitHub Gist** named `oracle-v2-ledger.json`.

On the first run, if `GITHUB_ORACLE_V2_ID` is not set, the service creates the Gist and logs:

`LEDGER CREATED — set GITHUB_ORACLE_V2_ID=<id> ...`

Set that ID on the v2 service immediately after first boot so future redeploys reuse the same evidence ledger.

The v2 ledger must never be written into the v1 `GITHUB_ORACLE_ID` Gist because Savant currently consumes that Gist.

## Environment variables
Required or inherited from current Oracle:

- `GITHUB_TOKEN`
- `GITHUB_GIST_ID` (Savant bridge; read-only)
- `ALPACA_KEY_ID` (paper account read only)
- `ALPACA_SECRET_KEY`
- `RESEND_KEY`
- `EMAIL_FROM`
- `EMAIL_TO`

New:

- `GITHUB_ORACLE_V2_ID` — set after first boot
- `ORACLE_V2_BOOTSTRAP_SNAPSHOT` — default enabled
- `ORACLE_V2_EMAIL_DAILY_AUDIT` — default enabled

Optional:

- `GITHUB_JOURNAL_ID` — reserved for later RCA/Socratic integration; v2.0 does not use it to alter decisions.

## Email upgrade for Oracle v1
`email_renderer.js` is a pure presentation layer. The patch changes the existing `sendEmail()` function to submit both `text` and `html` to Resend. It does not change triggers, thresholds, context writes, or trading-related state.

## Validation gates before any Savant integration
Oracle v2 should not influence Savant merely because 20–30 calendar days have passed. Influence is earned only after enough *clean, scorable* observations exist.

Minimum evidence questions:

1. Does Oracle identify excessive defensiveness before meaningful positive benchmark continuation more often than it falsely flags caution?
2. Does Oracle identify excessive risk before meaningful downside more often than chance/simple Savant rules?
3. Does the mandate audit correctly separate market participation, cash drag, and execution effects?
4. Are Oracle's strongest signals genuinely orthogonal to Savant, or just renamed duplicates?
5. Does Oracle produce a manageable number of actionable challenges rather than continuous noise?

Only then should a narrow, typed advisory contract be considered for Savant.

## Deliberately deferred from v2.0
- LLM-generated target allocations
- automatic strategy rewrites
- direct Savant ceilings
- direct Apex kill switches
- ML regime classification
- autonomous parameter tuning
- causal/counterfactual performance claims

These are deferred because they would contaminate the experiment or exceed the available evidence base.
