# PantryRun Premium — Paywalled Features & Recommended Price

Builds on the owner's direction (2026-07-06): monetize via subscription for
Trip Optimizer + Smart Home. Grounded in `04-COMPETITORS-PRICING.md` and the
technical state in `GroceryApp/docs/MONETIZATION.md`.

## Principle: privacy is the brand, intelligence is the product
E2EE family sync, offline lists, barcode scanning, and manual prices stay
**free forever**. Charging for privacy reads as extortion to exactly the
audience PantryRun courts; charging for *savings intelligence* reads as fair —
it visibly pays for itself and it has real marginal costs (AI inference,
managed infrastructure).

## The paywall: "PantryRun Plus" — 4 features (≥3 required; 4 proposed)

| # | Feature | Why it's paywallable | State today |
|---|---|---|---|
| 1 | **Trip Optimizer** — "Costco + No Frills saves you $11.40 this week"; multi-store split plans, per-store totals, savings vs one-stop | The hero: quantifiable weekly value; already matches the annual fee in 1-2 trips. No mainstream competitor has it (only free-web GroceryChop and Flipp's nascent AI basket) | ✅ In the codebase but **gated out of v1** (`TRIP_OPTIMIZER_ENABLED = false` — never reachable in a release build); ships now with PantryRun Plus behind the entitlement gate (`src/config/entitlements.ts`). Optimizer core unit-tested (`stop-optimizer.test.ts`); `trip-plan.ts` now has direct unit tests too (`trip-plan.test.ts`, 20 cases, added with the Plus release) |
| 2 | **AI Flyer Scanning (managed)** — photograph any store flyer; vision model extracts prices into your price list | Real per-use inference cost (~$0.005/image via Qwen-VL) makes "unlimited scanning" a natural subscription; self-hosters with their own Ollama keep it free (community goodwill + zero cost to you) | ✅ Extraction pipeline shipped & tested end-to-end. ⚠️ **Camera capture is currently broken** (placeholder URIs, never calls `takePictureAsync` — see `01-USABILITY-AUDIT.md` #3, CRITICAL); only the image-picker path works, and the scan icon is hidden by default (#11). **Must be fixed before this can be sold.** Managed backend = flip `QWEN_API_KEY` |
| 3 | **Smart Home / Voice Assistants** — Alexa & Google Assistant ("add milk to my list" from the kitchen speaker) | Household convenience feature with hosting cost (webhook) and clear willingness-to-pay in family segment; Siri stays free (on-device, costless) | ⚠️ Gated off in v1. **Prereqs before selling** (from MONETIZATION.md): deploy webhook, in-app key-custody disclosure, privacy-label updates, ideally derived sync subkey. Ship in the *second* premium release |
| 4 | **Managed Relay** — zero-setup cloud sync for non-technical families (we run the relay; still E2EE — custody fix means the relay cannot read anything) | Removes the #1 adoption barrier (self-hosting) for mainstream users; direct hosting cost | ⚠️ Tier exists but hidden in v1; needs ops (hosting, key provisioning, support) + IAP before enabling |

Launch sequencing: **Plus v1 = features 1+2+4** (all shipped or ops-only).
Feature 3 joins when its prereqs land. No grandfathering exists or is needed:
the optimizer was gated off before v1 shipped (`TRIP_OPTIMIZER_ENABLED =
false` in the v1 binary), so no pre-paywall cohort ever had it free and there
is nothing to claw back. (Corrects earlier guidance written before the v1
gating decision.)

## Recommended price

| | Recommendation | Rationale |
|---|---|---|
| **Headline** | **$14.99/year — PantryRun Plus (whole family, all devices)** | Anchors exactly on AnyList Household ($14.99/yr, the category's only true family plan) while delivering strictly more (optimizer + AI scanning + managed sync). Sits atop the $6–16 list-app cluster, far under the $39 organizer tier, and respects the "Flipp is free" anchor. One SKU, family-inclusive — per-seat pricing fights the family-first brand |
| Monthly | $1.99/mo | Matches Bring!/Listonic monthly points; exists to lower trial friction, annual is the real product |
| Test cell | $19.99–24.99/yr | Worth A/B testing once AI flyer scanning proves out as the hero feature; don't launch there |
| Anti-recommendation | Lifetime unlock | Managed relay + AI inference are recurring costs; lifetime revenue vs perpetual COGS is a trap (OurGroceries can do it — pure ad-removal has no COGS; PantryRun Plus does) |

**Unit-economics sanity check at $14.99/yr:** relay cost ≈ $0.10–0.30/family-mo
(256MB container, shared), AI scanning ≈ $0.005/image → a family scanning 20
flyer pages/mo costs ≈ $0.10 — gross margin >80% even before annual-prepay
float. Break-even on a $5/mo VPS ≈ 4 subscribing families.

## Store-compliance notes for the paywall release (from this repo's audit)
- Must ship via **Apple IAP / Google Play Billing** (Apple 3.1.1) — external
  payment for in-app digital features is not an option for this app class.
- Re-check privacy labels when Smart Home ships (webhook transiently
  decrypts voice-requested list content — must be disclosed; see
  `docs/MONETIZATION.md` and the key-custody notes in the threat model).
- The subscription-key/managed-tier UI currently hidden behind
  `MANAGED_TIER_ENABLED=false` should be *replaced by* the IAP flow, not
  re-exposed (an un-buyable key-entry field was the original 3.1.1 risk).
