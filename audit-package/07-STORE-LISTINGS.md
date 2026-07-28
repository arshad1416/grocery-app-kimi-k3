# Store Listings — Name Check, Descriptions, Screenshots, Intro Video

Researched 2026-07-08. Complements `06-MARKETING-KIT.md` (social posts,
channels); this doc is the submission-ready listing package.

---

## 1. Name-collision check: "Grocery App"

**Google Play — TAKEN, verbatim.** An app literally titled "Grocery App"
exists: a grocery-delivery template app
(https://play.google.com/store/apps/details?id=com.mstoreapp.grocery).

**Apple App Store — no exact "Grocery App"** in results, but the space is
saturated with near-names: "Grocery - Smart Shopping List"
(apps.apple.com/us/app/grocery-smart-shopping-list/id1195676848), "Grocery
List" (id1359785050), "Grocery Shopping List - Alist" (id6739451339), plus
AnyList/Bring!/OurGroceries all carrying "Grocery" in their titles.

**Verdict: do NOT rename to "Grocery App".** It's already claimed on Play,
it's generic (weak/no trademark protection, unbrandable, un-searchable — you'd
be competing with every app containing the words "grocery app"), and Apple's
metadata rules disfavor generic keyword names.

**"PantryRun" is clear.** Nearest names anywhere: "Stop Hopper" (a transit
ride-share app, play.google.com/…/com.sparelabs.platform.rider.pantryrunper) and
the long-dead HopStop transit app (acquired by Apple 2013, delisted 2015 —
en.wikipedia.org/wiki/HopStop). Different category, visually and phonetically
distinguishable → no store-name or practical trademark collision for a
grocery app. Keep **PantryRun**, keep "Grocery" in the subtitle/title suffix for
search: `PantryRun: Family Grocery List`.

---

## 2. Apple App Store listing (copy-paste ready)

| Field | Value | Limit |
|---|---|---|
| **Name** | `PantryRun: Family Grocery List` | 28/30 |
| **Subtitle** | `Private shared lists & prices` | 29/30 |
| **Promotional text** | `Your family's grocery list, end-to-end encrypted. Compare local prices, scan store flyers, and find which stores save you the most — without giving up your data.` | 160/170 |
| **Keywords** | `grocery,shopping list,family,shared list,price compare,flyer,deals,private,encrypted,meal,pantry` | 98/100 |
| **Category** | Primary: Shopping · Secondary: Food & Drink | |
| **Age rating** | 4+ | |

**Description** (≤4000 chars; ~1,700 used):

> **The grocery list that respects your family's privacy.**
>
> PantryRun keeps your household's shopping in sync — without accounts, ads,
> or anyone reading your data. Lists are end-to-end encrypted on your device;
> not even the sync server can see what's on them.
>
> SHARED FAMILY LISTS
> Add "milk" on your phone; it appears on your partner's in the store aisle.
> Claim items so two people don't buy the same thing. Works fully offline —
> changes sync when you're back online.
>
> ACTUALLY PRIVATE
> • End-to-end encrypted sync (XChaCha20-Poly1305)
> • No account, no email, no phone number — ever
> • No ads, no analytics, no tracking
> • Run the sync server in your own home if you want — it's open source
>
> PAY LESS FOR THE SAME CART
> • See local prices next to your list items (opt-in)
> • Add a photo of a store flyer — AI reads the deals into your price list
> • Trip Optimizer: "Costco + No Frills saves you $11.40 this week"
> • Weekly flyer deals matched to what's already on your list
>
> HANDS-FREE
> Add items with Siri or by voice while your hands are full.
>
> YOUR KEYS, YOUR DATA
> A 12-word recovery phrase — like a crypto wallet, but for your grocery
> list. Lose a phone, not your data.
>
> PantryRun is built for households that think a grocery list shouldn't be
> anyone else's business.
>
> Privacy policy & terms: https://groceryapp.app/privacy

**Accuracy guardrails (Apple 2.3.1):** no Alexa/Google Assistant, no
"premium/subscription", no managed-cloud plan (all hidden/off in v1). "Add a
photo of a store flyer" — keep this wording until the camera-capture fix is
device-verified, then "Snap a photo" is fine.

---

## 3. Google Play listing (copy-paste ready)

| Field | Value | Limit |
|---|---|---|
| **Title** | `PantryRun: Family Grocery List` | 28/30 |
| **Short description** | `Private, encrypted family grocery lists with local price comparison.` | 68/80 |
| **Category** | Shopping · Tags: shopping list, family organizer | |
| **Content rating** | Everyone | |

**Full description** (≤4000): use the Apple description above verbatim minus
the Siri line's "with Siri" (Android: "by voice"), i.e.:

> HANDS-FREE
> Add items by voice while your hands are full.

Play allows light formatting/emoji; the 🛒🔒💰 variants from
`06-MARKETING-KIT.md` are fine here if you prefer the emoji headers.

---

## 4. Screenshots — plan + production

**Honesty rule first:** Apple 2.3.3 and Play metadata policy require
screenshots of the *actual running app*. Nothing has been captured yet because
the app hasn't been run on a device/simulator this cycle — so this is a
shot list + capture pipeline, deliberately not fabricated mockups.

### Required sizes
- **iOS:** 6.9" (1320×2868) required; 6.5" (1284×2778) recommended.
  **iPad 13" (2064×2752) is required while `supportsTablet: true`** — either
  capture iPad shots or flip `supportsTablet` to false for v1 (one line in
  app.json; recommended if you don't want to polish iPad layout now).
- **Android:** phone screenshots min 1080px wide, 9:16 (min 2, max 8), plus
  **feature graphic 1024×500** (required; no text near edges — it gets
  cropped in some placements).

### The 8 shots (same narrative both stores; caption strip on each)
| # | Screen to capture | Caption overlay |
|---|---|---|
| 1 | GroceryListScreen with a realistic 10-item list, 2 checked off | **Your family's list, always in sync** |
| 2 | Two-device composite (or notification moment): item appears on second phone | **Add milk here, it shows up there** |
| 3 | List with price badges visible + store totals bar | **See local prices on your list** |
| 4 | Trip Plan sheet: "2 stops — save $11.40" proposal view | **Which stores are worth the trip** |
| 5 | FlyerScanFlow result: "14 prices captured from [store]" | **Point at a flyer, get the deals** |
| 6 | PrivacyScreen ("How Your Data Is Handled" card) | **Encrypted end-to-end. No account. No ads.** |
| 7 | Pairing QR screen (with dummy QR) | **Invite family with one QR code** |
| 8 | Recovery phrase screen (blur/dummy words!) | **Your keys, your data — 12 words** |

Seed data for shots: use a plausible weekly list (milk, eggs, bread, chicken
thighs, bananas, coffee…) and CAD prices; set device clock to a clean time,
full battery, no notifications (iOS: `xcrun simctl status_bar override`).

### Capture pipeline
```bash
# iOS (after eas build or local prebuild)
npx expo run:ios --device "iPhone 16 Pro Max"   # 6.9" class
xcrun simctl status_bar "iPhone 16 Pro Max" override --time "9:41" --batteryState charged --batteryLevel 100
xcrun simctl io booted screenshot shot1.png

# Android
npx expo run:android   # Pixel-class emulator, 1080×2400+
adb exec-out screencap -p > shot1.png
```
Frame + caption the raw captures with any device-frame tool (e.g. Figma with
Apple's device frames, or `fastlane frameit`). Keep caption text in the top
1/4, 44pt+, same accent color as the app (#10B981).

### Feature graphic (Play, 1024×500)
Dark background (#0B0F19), app icon left, headline right:
"**Private family grocery lists** — with price superpowers". No screenshot
inside it (crops badly at small sizes).

---

## 5. Short intro video

- **Apple App Preview:** 15–30s, portrait, uploaded per size class; must be
  ~entirely on-device screen recording (no hands/lifestyle footage); audio
  optional (assume muted autoplay). Capture with `xcrun simctl io booted
  recordVideo` or QuickTime from a real device.
- **Google Play:** a YouTube link on the listing; same footage works, can add
  a 1s logo bumper.

### 30-second storyboard (screen recording + text overlays, no voiceover)
| Time | On screen (real app) | Text overlay |
|---|---|---|
| 0–3s | Logo splash → Home | **PantryRun** — the private family grocery list |
| 3–8s | Type "milk", "eggs", quick-add; check one off (satisfying tick) | Fast lists. Works offline. |
| 8–13s | Cut: second device — the same items appear | Syncs with your family — **end-to-end encrypted** |
| 13–18s | Price badges pop in on the list; store totals bar | See local prices while you plan |
| 18–24s | Trip Plan sheet opens: "2 stops — save $11.40" | Know **which stores** are worth it |
| 24–28s | Flyer photo → "14 prices captured" | Point at a flyer. Get the deals. |
| 28–30s | Privacy screen card → end card: icon + name | No account. No ads. **Your data stays home.** |

Production notes: record at 60fps, trim taps to feel instant (cut dead time),
end card is the only non-screen frame Apple tolerates (~1s, static). One
recording session can yield the video AND all 8 screenshots — do it right
after the two-device smoke test, since that setup (two paired simulators/
devices with seeded data) is exactly what shots 2 and the 8–13s scene need.

---

## 6. Prerequisites recap (from the readiness checklists)
Screenshots/video are the last asset gap on both stores' checklists
(`02-APPLE-READINESS.md`, `03-GOOGLE-READINESS.md`). Everything here assumes
the same session as the two-device smoke test — one afternoon: smoke test →
seed data → capture screenshots → record video → frame/caption → upload.

---

## 7. Friendlier name candidates (verified 2026-07-08)

Store search (both stores) + live domain checks. "Store hits" = any existing
app found under that name.

| Candidate | Vibe | Store hits | .app domain | .com | Verdict |
|---|---|---|---|---|---|
| **CartNest** | warm — nest = home/family | none found | ✅ available | ✅ available | **Top pick** — only candidate with both domains free; obvious icon (nest+cart) |
| **SnugCart** | coziest, most playful | none found | ✅ available | — | Strong #2 — friendliest word, says feeling not function |
| **KinCart** | family-forward ("kin") | none found | ✅ available | ❌ taken | Solid #3 |
| HomeCart | friendly but plain | none found | ✅ available | — | OK; generic-adjacent, delivery-service confusion risk |
| ToteCart | neutral | none | ✅ available | — | Clunky to say |
| ~~CartHop~~ | — | **direct competitor** (carthop.store: multi-store price splitting!) | ❌ | — | Eliminated |
| ~~Basketful~~ | — | live grocery-list app (Play co.basketful.basketful + iOS) | ✅ | — | Eliminated |
| ~~Grocery App~~ | — | taken verbatim on Play; generic | — | — | Eliminated |
| ~~PantryPal / Cartly / MilkRun / Grocerly / OurCart / ListNest / FamCart~~ | — | domains taken → brands occupied | ❌ | — | Eliminated |

Registration (user action — do not auto-purchase):
- cartnest.app / cartnest.com: godaddy.com/domainsearch/find?domainToCheck=cartnest.app
- snugcart.app: godaddy.com/domainsearch/find?domainToCheck=snugcart.app
- kincart.app: godaddy.com/domainsearch/find?domainToCheck=kincart.app

**Rename cost (pre-launch = cheap):** display name lives in app.json
(`name`, listing titles) + marketing docs; the bundle id
(`com.shiftlogichq.pantryrun`) is user-invisible and can stay, but decide BEFORE
first submission (iOS locks it after). Invite-link domain is brand-neutral
(`groceryapp.app`) and keeps working; if switching to cartnest.app for links,
update `associatedDomains`, AASA, assetlinks + DEEP-LINK-HOSTING.md.
Listing copy: "CartNest: Family Grocery List" = 29 chars — fits.
