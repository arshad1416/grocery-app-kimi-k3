# StopHop — Marketing Kit

Copy claims only shipped v1 features (no Alexa/Google Assistant, no managed
plan — both hidden in v1). Siri, price comparison, and the trip optimizer are
shipped and claimable. **Flyer scanning carries a caveat:** the camera-capture
path is currently broken (`01-USABILITY-AUDIT.md` #3) — only adding an
existing photo works — so the copy below says "Add a photo" rather than
"Snap a photo". Restore the stronger wording once that bug is fixed.

---

## 1. Store-listing copy

### Apple App Store
- **Name (≤30):** `StopHop: Family Grocery List` *(28 chars)*
- **Subtitle (≤30):** `Private shared lists & prices` *(29 chars)*
- **Promotional text (≤170):**
  `Your family's grocery list, end-to-end encrypted. Compare local prices, scan store flyers, and find which stores save you the most — without giving up your data.`
- **Keywords (≤100 chars):**
  `grocery,shopping list,family,shared list,price compare,flyer,deals,private,encrypted,meal,pantry`

### Google Play
- **Title (≤30):** `StopHop: Family Grocery List`
- **Short description (≤80):**
  `Private, encrypted family grocery lists with local price comparison.` *(68 chars)*

### Full description (both stores)

> **The grocery list that respects your family's privacy.**
>
> StopHop keeps your household's shopping in sync — without accounts, ads,
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
> **💰 Pay less for the same cart**
> • See local prices next to your list items (opt-in)
> • Add a photo of a store flyer — AI reads the deals into your price list
> • Trip Optimizer: "Costco + No Frills saves you $11.40 this week"
> • Weekly flyer deals matched to what's already on your list
>
> **🎙️ Hands-free**
> Add items with Siri or by voice while your hands are full.
>
> **🔑 Your keys, your data**
> A 12-word recovery phrase — like a crypto wallet, but for your grocery
> list. Lose a phone, not your data.
>
> StopHop is built for households that think a grocery list shouldn't be
> anyone else's business. Privacy policy: https://groceryapp.app/privacy

*(Both stores ≤4000 chars — this is ~1,600.)*

**Listing don'ts (accuracy per Apple 2.3.1 / Play metadata policy):** don't
mention Alexa/Google Assistant, "premium", "subscription", or a managed/cloud
plan until those ship; don't claim Android↔iOS family sync until the
two-device cross-platform smoke test has actually been run; don't say "snap"
or "photograph" a flyer until the camera-capture bug is fixed.

---

## 2. Three social posts

**Post 1 — X/Twitter (launch announcement)**
> Your grocery list knows when you eat, what you can afford, and when you're
> pregnant before your family does. Most list apps sell that.
>
> We built StopHop: end-to-end encrypted family grocery lists. No account.
> No ads. Self-host it if you don't trust us — you don't have to.
>
> 🛒🔒 App Store / Google Play → [link]

**Post 2 — Reddit r/selfhosted (technical audience, no marketing voice)**
> **StopHop — E2EE family grocery list with a self-hostable relay (Docker, ~256MB)**
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
> We visited 2 stores instead of 4 and still saved $23 this week 🛒
>
> StopHop compares prices across your local stores and tells you which trip
> is actually worth it. Your list syncs with your partner instantly — and
> it's fully encrypted, so your shopping habits stay in your family.
>
> Free on iPhone & Android. #grocerylist #mealplanning #privacy

---

## 3. Promo channels, ranked

| # | Channel | Why this rank | Concrete first move |
|---|---|---|---|
| 1 | **r/selfhosted + r/privacy + r/degoogle** | The only audience that fully values the differentiator and tolerates v1 rough edges; self-hosters become evangelists and free QA | Post 2 above; be present in comments for 48h; add relay `docker-compose` one-liner to README first |
| 2 | **Hacker News (Show HN)** | E2EE + CRDTs + self-hosting + honest threat-model doc is exactly HN-shaped; one good thread outperforms months of ads | "Show HN: StopHop – E2EE family grocery list you can self-host". Link the threat model, disclose the flyer-channel caveat up front — HN rewards honesty |
| 3 | **Product Hunt** | Broader early-adopter reach; privacy products chart well | Launch AFTER the Reddit/HN feedback round fixes the top usability items; ship with real screenshots |
| 4 | **Privacy-recommendation lists** (PrivacyGuides forum, AlternativeTo, awesome-privacy / awesome-selfhosted GitHub lists) | Durable, compounding discovery — people search "private AnyList alternative" | Submit to AlternativeTo as alternative to AnyList/Bring!/OurGroceries; PR to awesome-selfhosted |
| 5 | **Frugal/couponing communities** (r/Frugal, r/EatCheapAndHealthy, PF Canada subs) | The price-optimizer story lands here; bigger but less differentiated audience | Post a real "saved $X across 2 stores" walkthrough with screenshots — value-first, not launch-y |
| 6 | **YouTube self-hosting channels** (e.g., the Docker/homelab reviewers) | High-trust, evergreen installs; they need a working `docker-compose` demo | Offer early access + a 5-minute setup script; wait until managed tier exists for their non-technical viewers |
| 7 | Paid ads (ASA/Google App Campaigns) | **Not yet** — CAC will exceed $0 revenue in a free v1; revisit when the premium tier launches | — |

**Sequencing note:** channels 1-2 first (they also double as beta QA), fix
what they find, then 3-5 in the same week for the compounding-launch effect.
