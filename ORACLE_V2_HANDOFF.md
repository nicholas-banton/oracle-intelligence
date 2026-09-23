# Harness / Codex Handoff — Oracle v2 Shadow

Implement this patch as a **new shadow service**. Protect `savant-intelligence` as the production control.

## Non-negotiable constraints
1. Do not alter Savant posture logic, thresholds, target weights, bridge schema, or Apex execution behavior.
2. Do not grant Oracle v2 any order submission capability.
3. Do not point Savant's `GITHUB_ORACLE_ID` at the v2 ledger.
4. Keep existing Oracle v1 behavior unchanged except for the presentation-only HTML email renderer.
5. Do not add AI/LLM calls in v2.0. Establish a deterministic evidence baseline first.
6. Avoid broad repo refactors. Apply only the additive files and the surgical `sendEmail()`/package-script patch.

## Files in this patchset
- `email_renderer.js` — human-friendly HTML email presentation
- `oracle_v2.js` — independent shadow service
- `v2/analytics.js` — pure market-structure, challenge, scoring, and mandate functions
- `v2/ledger.js` — bounded immutable-style evidence ledger helpers
- `tests/oracle_v2_run.js` — zero-dependency tests
- `oracle-v2-ledger.schema.json` — authority/evidence schema
- `patches/patch_existing_repo.py` — exact-anchor patcher for current `oracle.js` and `package.json`

## Verification
Run:

```bash
npm run test:v2
node -c oracle.js
node -c oracle_v2.js
```

Then inspect the diff. There should be **no changes** to Oracle v1 triggers/thresholds/handlers except the addition of `html` in Resend payload and the renderer require.

## Deployment
Create a separate Railway service, e.g. `oracle-v2-shadow`, sourced from the Oracle repo after merge, start command:

```bash
npm run start:v2
```

Copy/read-reference the current Oracle service's GitHub, Alpaca-paper, and Resend variables. Do not copy any live-broker endpoint or execution flag.

After first boot, capture the logged `GITHUB_ORACLE_V2_ID` and persist it on the v2 service.

## Success condition for this sprint
The new service is healthy, writes its own private ledger, records a bootstrap snapshot, sends a readable daily shadow audit email, and has no write path to Savant or order path to Alpaca.
