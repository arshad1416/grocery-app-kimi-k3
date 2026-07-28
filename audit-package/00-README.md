# PantryRun — Audit & Monetization Package

**Audit target (confirmed by owner):** worktree
`~/Documents/ShiftLogic_HQ/GroceryApp/dreamy-faraday-758d4e`, branch
`claude/dreamy-faraday-758d4e` @ `b9d959d6` (2026-07-06) — the most recently
changed checkout, containing the full hardening/launch pass.
`~/Documents/GroceryApp` (main @ `e3705d19`, 2026-06-17) is a stale checkout
of the same repo and was **not** audited.

## Contents
| Doc | What it is |
|---|---|
| `01-USABILITY-AUDIT.md` | Severity-ranked usability issues, each with a concrete fix (fresh-context review; audit-only — no source edits made) |
| `02-APPLE-READINESS.md` | App Store Review Guidelines checklist, pass/fail per guideline |
| `03-GOOGLE-READINESS.md` | Google Play policy checklist, pass/fail per policy |
| `04-COMPETITORS-PRICING.md` | 5+ competitor table with features and current prices (web-researched, sourced) |
| `05-PREMIUM-FEATURES-PRICING.md` | Paywalled premium feature set + recommended price |
| `06-MARKETING-KIT.md` | Store-listing copy (both stores), 3 social posts, ranked promo channels |

## Assumptions about the app's intended purpose (flagged per instructions)
1. **Primary purpose:** a privacy-first, family-shared grocery list with E2EE
   sync — derived from README, `docs/threat-model.md`, and the AC test suite.
   Price comparison / trip optimization are treated as the value-add layer,
   not the core.
2. **Target user:** privacy-conscious households; at least one member is
   technical enough to run (or rent) a relay. The self-hosted tier is assumed
   to be the launch default since the managed tier is hidden in v1.
3. **Launch scope:** v1 ships **free** with no purchase path (owner's Option 1
   decision, 2026-07-06); monetization (Trip Optimizer + Smart Home) is
   post-v1 per `GroceryApp/docs/MONETIZATION.md`.
4. **Geography:** pricing/flyer features are Canada/US-leaning (Flipp FSA
   postal-code prefixes, CAD-oriented store set); listings are written for a
   North-American launch.

If any of these is wrong, say so — the paywall and marketing recommendations
lean on them.

## Constraint compliance
- **No app source was edited** for this package; everything lives in
  `audit-package/` as new files. Proposed changes are described in the docs,
  not applied.
- Nothing was deleted or overwritten.

## Verification
Every doc was adversarially fact-checked by six independent fresh-context
verifiers (claims vs code with file:line spot-checks, internal consistency,
exact character counts for store copy). 10 inaccuracies were found and
corrected — notably: flyer scanning's camera path is broken (usability #3),
so docs 05/06 carry explicit caveats; invite tokens are Ed25519-signed (not
blind-signed); pricing-cluster figures were made consistent ($6–16/yr).
Docs 01 and 03 passed with zero corrections.
