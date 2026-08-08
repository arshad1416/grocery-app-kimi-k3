# PantryRun — Marketing Kit

Copy claims only shipped features. **Claimable:** shared E2EE family
lists, offline-first sync, self-hosted relay, 12-word recovery phrase, flyer
scanning (photo-add), local price display from scanned flyers, opt-in barcode
lookup, in-app Delete All Data, **and — restored for the PantryRun Plus
release — the Trip Optimizer** ("which stores save you the most"; ships
behind the $14.99/yr family IAP; the savings figure is honest: savings vs.
the cheapest single-store trip). **NOT claimable — do not write copy for
these:** Siri or any voice input (no voice feature ships; the mic
entitlements were removed), the weekly-deals feed and cross-store
price comparison outside the Trip Optimizer (compiled out with the community
price database),
Alexa/Google Assistant, and any managed/cloud plan. **Flyer scanning carries
a caveat:** the camera-capture path is currently broken
(`01-USABILITY-AUDIT.md` #3) — only adding an existing photo works — so the
copy below says "Add a photo" rather than "Snap a photo". Restore the
stronger wording once that bug is fixed.

---

## 1. Store-listing copy

### Apple App Store
- **Name (≤30):** `PantryRun: Family Grocery List` *(30 chars — exactly at the limit)*
- **Subtitle (≤30):** `Private shared lists & prices` *(29 chars)*
- **Promotional text (≤170):**
  `Your family's grocery list, end-to-end encrypted. Works offline, syncs through a relay you control, and reads store flyers into your local price list.` *(150 chars)*
- **Keywords (≤100 chars):**
  `grocery,shopping list,family,shared list,private,encrypted,offline,flyer,prices,pantry,sync` *(91 chars)*

### Google Play
- **Title (≤30):** `PantryRun: Family Grocery List` *(30 chars)*
- **Short description (≤80):**
  `Private, encrypted family grocery lists. Offline-first, no accounts, no ads.` *(76 chars)*

### Full description (both stores)

> **The grocery list that respects your family's privacy.**
>
> PantryRun keeps your household's shopping in sync — without accounts, ads,
> or anyone reading your data. Lists are end-to-end encrypted on your device;
> not even the sync server can see what's on them.
>
> **🛒 Shared family lists**
> Add "milk" on your phone; it appears on your partner's in the store aisle.
> Claim items so two people don't buy the same thing. Works fully offline —
> changes sync when you're back online.
>
> **🔒 Actually private**
> • End-to-end encrypted sync (XChaCha20-Poly1305)
> • No account, no email, no phone number — ever
> • No ads, no analytics, no tracking
> • Run the sync server in your own home if you want to — it's open
>
> **💰 Prices from your own flyers**
> • Add a photo of a store flyer — PantryRun reads the prices into your
>   local price list (opt-in)
> • See those prices next to your list items while you plan
> • Scan a barcode to add a product by name (opt-in lookup)
>
> **🗺️ Trip Optimizer — PantryRun Plus**
> • The cheapest way to split your list across nearby stores — "Costco +
>   No Frills saves you $11.40 this week"
> • Every plan shows exactly what you save vs. doing the whole trip at the
>   cheapest single store
> • One purchase unlocks your whole family — $14.99/year (auto-renewing;
>   manage or cancel anytime in your store account)
>
> **🔑 Your keys, your data**
> A 12-word recovery phrase — like a crypto wallet, but for your grocery
> list. Lose a phone, not your data. And when you want out: Settings →
> Delete All Data erases everything, no questions asked.
>
> PantryRun is built for households that think a grocery list shouldn't be
> anyone else's business. Privacy policy: https://groceryapp.app/privacy

*(Both stores ≤4000 chars — this is ~1,500.)*

**Listing don'ts (accuracy per Apple 2.3.1 / Play metadata policy):** don't
mention Siri or voice input (nothing voice-shaped ships), a deals
feed or cross-store price comparison outside the Trip Optimizer (compiled
out), Alexa/Google Assistant, or a managed/cloud plan until those ship. Trip
Optimizer and "PantryRun Plus" subscription copy ARE now allowed — keep the
savings framing at "vs. the cheapest single store" (what the app actually
computes) and always state price + renewal ($14.99/year, auto-renewing).
Don't
claim Android↔iOS family sync until the two-device cross-platform smoke test
has actually been run; don't say "snap" or "photograph" a flyer until the
camera-capture bug is fixed.

---

## 2. Three social posts

**Post 1 — X/Twitter (launch announcement)**
> Your grocery list knows when you eat, what you can afford, and when you're
> pregnant before your family does. Most list apps sell that.
>
> We built PantryRun: end-to-end encrypted family grocery lists. No account.
> No ads. Self-host it if you don't trust us — you don't have to.
>
> 🛒🔒 App Store / Google Play → [link]

**Post 2 — Reddit r/selfhosted (technical audience, no marketing voice)**
> **PantryRun — E2EE family grocery list with a self-hostable relay (Docker, ~256MB)**
>
> Built this because every shared-list app wanted an account and phoned home.
> Architecture: Yjs CRDTs for offline-first sync, XChaCha20-Poly1305
> client-side encryption (relay only ever sees ciphertext), libsodium,
> QR-based device pairing with Ed25519-signed one-time invite tokens (blind
> RSA per RFC 9474 is used separately for anonymous price-pool
> contributions), 12-word recovery phrase. The relay is a single Node
> container; docker-compose up and point the app at it. Optional: local AI
> flyer-price extraction via your own Ollama (qwen2.5-vl).
>
> Threat model and crypto docs are in the repo. Would love brutal feedback
> on both. [links]

**Post 3 — Instagram/Facebook (household decision-maker)**
> Our grocery list is nobody's business but ours 🛒
>
> PantryRun keeps your family's list in sync — add milk on your phone, it
> shows up on your partner's in the aisle. Fully encrypted, works offline,
> no account needed. Scan a store flyer and the prices land right on your
> list.
>
> And when it's time to shop: PantryRun Plus splits your list across nearby
> stores and shows what the split saves you vs. one-stop shopping 💰 —
> "Costco + No Frills saves you $11.40 this week." One purchase covers the
> whole family.
>
> Free on iPhone & Android · Plus $14.99/yr. #grocerylist #mealplanning #privacy

---

## 3. Promo channels, ranked

| # | Channel | Why this rank | Concrete first move |
|---|---|---|---|
| 1 | **r/selfhosted + r/privacy + r/degoogle** | The only audience that fully values the differentiator and tolerates v1 rough edges; self-hosters become evangelists and free QA | Post 2 above; be present in comments for 48h; add relay `docker-compose` one-liner to README first |
| 2 | **Hacker News (Show HN)** | E2EE + CRDTs + self-hosting + honest threat-model doc is exactly HN-shaped; one good thread outperforms months of ads | "Show HN: PantryRun – E2EE family grocery list you can self-host". Link the threat model, disclose the flyer-channel caveat up front — HN rewards honesty |
| 3 | **Product Hunt** | Broader early-adopter reach; privacy products chart well | Launch AFTER the Reddit/HN feedback round fixes the top usability items; ship with real screenshots |
| 4 | **Privacy-recommendation lists** (PrivacyGuides forum, AlternativeTo, awesome-privacy / awesome-selfhosted GitHub lists) | Durable, compounding discovery — people search "private AnyList alternative" | Submit to AlternativeTo as alternative to AnyList/Bring!/OurGroceries; PR to awesome-selfhosted |
| 5 | **Frugal/couponing communities** (r/Frugal, r/EatCheapAndHealthy, PF Canada subs) | The price-optimizer story lands here; bigger but less differentiated audience | Post a real "saved $X across 2 stores" walkthrough with screenshots — value-first, not launch-y |
| 6 | **YouTube self-hosting channels** (e.g., the Docker/homelab reviewers) | High-trust, evergreen installs; they need a working `docker-compose` demo | Offer early access + a 5-minute setup script; wait until managed tier exists for their non-technical viewers |
| 7 | Paid ads (ASA/Google App Campaigns) | **Not yet** — CAC will exceed $0 revenue in a free v1; revisit when the premium tier launches | — |

**Sequencing note:** channels 1-2 first (they also double as beta QA), fix
what they find, then 3-5 in the same week for the compounding-launch effect.
