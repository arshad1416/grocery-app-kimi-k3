# Competitor & Pricing Landscape (researched 2026-07-10)

Live web research (store listings, vendor sites, pricing pages). Prices USD.

## Competitor table

| App | iOS rating | Free tier | Paid price | Family sync | Price compare | Flyer deals | Trip optimizer | Privacy (account / ads / E2EE) |
|---|---|---|---|---|---|---|---|---|
| **AnyList** | 4.9 ★ (79K) | Full core lists + sharing, no ads | **$9.99/yr** individual · **$14.99/yr household** | ✅ real-time | ◐ manual per-item price tracking (paid), no cross-store compare | ❌ | ❌ | Account required; no ads, nothing in "Data Used to Track You" — best-in-class mainstream, but plaintext server-side, no E2EE |
| **OurGroceries** | 4.8 ★ (84K) | Unlimited lists + family sync, banner ads | $0.99/mo · **$5.99/yr** · $19.99 lifetime (ad removal) | ✅ core feature | ❌ ("on roadmap") | ❌ | ❌ | Account for sharing; ads on free; label: identifiers/usage **used for tracking**; no E2EE |
| **Bring!** | 4.8 ★ (9.8K) | All core free, offer-supported | $1.99/mo · **$8.99/yr** (ad-free, themes) | ✅ + change notifications | ❌ | ✅ retailer offers built in (their business model) | ❌ | Account required; label: **precise location + identifiers used to track**; no E2EE |
| **Listonic** | 4.7 ★ (9.9K) | Core free, ads | $0.99–1.99/mo · **$10.49–15.99/yr** · $13.99–19.99 lifetime | ✅ real-time | ◐ per-item price fields | ❌ (region-dependent) | ❌ | Account; label: **location, content, identifiers, usage used to track** (3rd-party ads); no E2EE |
| **Flipp** | 4.8 ★ (**521K**) | Entirely free | None — retailer CPE ads + analytics resale | ◐ weak lists | ✅ 2,000+ retailers; 2026 "Smart Shopping" AI lowest-basket | ✅ **category leader** | ◐ nascent AI multi-store basket | Heavily tracked; **identifiers used to track**, precise location + search history linked; data sold to brands; no E2EE |
| **Cozi** | 4.8 ★ (392K) | Shared list + calendar (30-day limit since 2024), ads | **Gold $39/yr** · Max $79.99/yr | ✅ household model | ❌ | ❌ | ❌ | Account; label: identifiers/usage **for tracking/advertising**; no E2EE |
| **Out of Milk** | 4.5 ★ (10K) | Free with ads | small PRO unlock (maintenance mode) | ◐ basic | ◐ running-total fields | ❌ | ❌ | Owned by **inMarket (location-ad company)**; location + identifiers **used to track**; no E2EE |
| **Mealime** | 4.8 ★ (54K) | Free meal plans + auto list | **$2.99/mo** (2026 reports of move to $5.99/mo) | ❌ (common complaint) | ❌ | ❌ | ❌ | Account; data linked for marketing; no E2EE |

Excluded as unmaintained: Grocery King (last real update 2015).
Niche/adjacent: **GroceryChop** (free web, US-only, UPC price-compare + list
optimizer — closest optimizer overlap, ad-funded, no family/E2EE), **Basket**
(basket-level store compare), and self-hosted open source **KitchenOwl** /
**Grocy** (self-hosting exists only in this hobbyist tier; even these are NOT
E2EE — their server sees plaintext — and have zero price/flyer intelligence).

Sources: anylist.com/complete · ourgroceries.com/faq · getbring.com ·
App Store listings for each (AnyList id522167641, OurGroceries id325851015,
Bring! id580669177, Listonic id331302745, Flipp id725097967, Cozi id407108860,
Mealime id1079999103, Out of Milk id564974992) · cozi.com/cozi-gold ·
usecalendara.com/blog/cozi-pricing-2026 · mealthinker.com/blog/mealime-alternative ·
vizologi.com (Flipp model) · github.com/tombursch/kitchenowl · grocy.info ·
grocerychop.com · familywall.com/premium.html.

## Pricing clusters (what the market bears, 2026)

1. **Pure list apps: $6–16/yr** (OurGroceries 5.99 → AnyList household 14.99).
   Monthly: $0.99–1.99. Lifetime: $14–20. Family premium over individual is
   small (+$5/yr at AnyList — the only true household split).
2. **Family-organizer suites: $39–45/yr** (Cozi Gold, FamilyWall), super-tier
   ~$80 (Cozi Max) — but these bundle calendars/location, not just lists.
3. **Meal planners: ~$36–72/yr** ($2.99–5.99/mo).
4. **Price-comparison/flyer apps: $0** — because the *user* is the product
   (retailer ads, analytics resale). This is the free anchor StopHop's paid
   savings features must respect.

## Verified: nobody offers the E2EE + self-hosting combination

Confirmed across privacy labels and vendor docs. **No mainstream competitor
offers E2EE or self-hosting.** Bring!, Listonic, Out of Milk, Flipp,
OurGroceries, Cozi all declare tracking identifiers (several with precise
location). AnyList is the cleanest mainstream option but is account-based,
plaintext server-side. Self-hosting does exist — but only in open-source
hobby projects (KitchenOwl, Grocy) that still aren't E2EE (their server sees
plaintext) and have no savings features. **StopHop's combination — E2EE + no
account + self-hostable + price intelligence — has no direct competitor.**

## Positioning takeaway

Users today approximate StopHop by running Flipp (privacy-hostile) alongside
AnyList/Bring (list-only). The savings layer justifies pricing above the
$6–16/yr list cluster; free-Flipp caps it well below the $39 organizer tier.
Credible sweet spot: **$14.99–19.99/yr family premium** ($1.99–2.99/mo),
anchored on AnyList's household plan, with room to test $24.99/yr if AI flyer
scanning is the hero paid feature. Keep E2EE sync itself free — privacy as a
paywall reads badly and undercuts the brand; monetize the intelligence
(optimizer, AI scanning, voice). The App-Store-visible contrast — StopHop's
empty "Data Used to Track You" label next to Bring!/Listonic/Out of Milk —
is a differentiator no tracking-funded incumbent can copy quickly (AnyList
already has a clean label, but lacks E2EE, no-account, and self-hosting).
