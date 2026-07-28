# PantryRun Usability Audit

Read-only review at `b9d959d6` by a fresh-context reviewer (no involvement in
the app's development). All paths relative to `GroceryApp/`. **No fixes were
applied — audit only.** Severity: CRITICAL = blocks a mainstream user from
core value · MAJOR = significant friction/confusion · MINOR = polish.

> ⚠️ **Notable finding:** issue #3 is not just UX — it's a functional bug
> (camera-path flyer capture never takes a real photo). It escaped the earlier
> engineering pass because tests exercise the pipeline, not the camera. It
> should be fixed before any store build.

## 1. First-run reality check

**To first list — good, ~4 interactions:** install → 2s splash
(`App.tsx:206-213`) → "Create your first list" (`HomeScreen.tsx:486-503`) →
FAB "+" → type → add. This core loop is polished and fast.

**To first *shared* list — ~12 steps, two outside the app entirely:**
deploy a relay server (managed tier is compiled out, `SettingsScreen.tsx:59`)
→ find the unlabeled people icon → type a `ws://` URL + port → Test
Connection → Settings → Generate QR → separately view + transcribe the
12-word recovery phrase (`SettingsScreen.tsx:674-693`) → share invite (raw
`groceryapp://…` link — dead if the recipient lacks the app) → invitee scans →
"One More Step" alert → invitee phones the inviter for the 12 words →
Recovery screen → done. Non-technical users bail at server hosting, at
`ws://`, or at the out-of-band phrase relay.

## 2. Issues, severity-ranked, each with a concrete fix

### CRITICAL

| # | Issue | Evidence | Concrete fix |
|---|---|---|---|
| 1 | Sharing is unreachable for mainstream users: managed tier disabled; invite creation throws "Set up your relay connection first" with no path forward | `SettingsScreen.tsx:59`; `src/identity/invite-link.ts:59-64` | Guided "Set up sharing" wizard + either a hosted default relay or an honest "requires a home server" gate before users hit the dead end |
| 2 | Fresh install shows a green "Connected" dot with no relay configured (`syncState: 'idle'` falls into the Connected branch) | `useSyncStore.ts:35`; `HomeScreen.tsx:452-459, 784-792` | Add a `not_configured` state rendered "Local only — tap to set up sharing", linking to Pairing |
| 3 | **Camera-path flyer capture is fake**: with a working camera it pushes `captured-${Date.now()}.jpg` placeholder URIs instead of photographing, so every camera scan ends "Nothing extracted" | `CameraScanner.tsx:179-184` | Wire `takePictureAsync` via a CameraView ref; until then route flyer mode to the image-picker fallback (which works) |
| 4 | App-init failure is a dead end: raw exception text, no Retry | `App.tsx:186-203, 251-252` | "PantryRun couldn't start" + Retry button re-running `init()`; raw message behind a details disclosure |
| 5 | No first-run onboarding: nothing explains local-vs-synced, the pairing icon, or the recovery phrase before users hit errors | `App.tsx:232-240` | 2-3 card first-launch flow: instant local lists / share with family (setup) / encrypted + save your phrase |

### MAJOR

| # | Issue | Evidence | Concrete fix |
|---|---|---|---|
| 6 | Every list is "My Grocery List"; **no rename UI exists** (`updateList` never called from UI) | `HomeScreen.tsx:167-178`; `ContextMenu.tsx:104-134` | Name prompt on create; Rename in context menu |
| 7 | Editing an item needs an undiscoverable double-tap (first tap = price banner, second = editor) | `GroceryListScreen.tsx:487-498` | Single tap → editor; prices via long-press or a price-chip target |
| 8 | Join flow is Alert-driven jargon: "Pair with Relay", "Enrolling this device…", raw Family/Device ID hex shown | `PairingScreen.tsx:83, 113, 233, 356-370` | "Join your family" copy; plain status lines; IDs behind an Advanced disclosure |
| 9 | Recovery-phrase handoff disjointed: inviter told invitee "will need your phrase" but never routed to it; invitee told mid-alert to go ask for it | `PairingScreen.tsx:127-146`; `SettingsScreen.tsx:489-495` | "Show recovery phrase now" button after Generate QR; in-screen step 2-of-2 indicator instead of alert |
| 10 | Deals feature demands Turso URL, JWT, and knowing "FSA"; dev's personal DB name "pantryrun-arshad1416" ships in UI copy/placeholder | `SettingsScreen.tsx:871-896`; `HomeScreen.tsx:627-649` | "Enter your postal code" backed by a bundled default endpoint; remove personal DB name + token field from user-facing settings (build-time env already exists, `App.tsx:142-143`) |
| 11 | Flyer scanning is undiscoverable: icon hidden unless `flyerScanEnabled && pricingOptedIn`, and opt-in defaults false — zero hint the feature exists | `GroceryListScreen.tsx:891-903`; `settings.ts:44` | Always show the icon; tapping it un-opted-in presents the existing pricing disclosure inline |
| 12 | Raw technical strings in user alerts: `Alert.alert('Error', err.message)` on toggle/delete/reorder/load; pairing dumps parser messages; flyer error names "Ollama or Qwen" | `GroceryListScreen.tsx:207, 515, 539, 568, 599-610, 641`; `PairingScreen.tsx:73, 148-153`; `FlyerScanFlow.tsx:99-103` | Map known failures to plain sentences ("That invite link isn't valid — ask for a new one"); raw messages → Sentry, not UI |
| 13 | Dark mode broken on the whole setup path: Pairing/Recovery/ItemEdit hardcode light styles; StatusBar permanently `style="light"` | `PairingScreen.tsx:382-391`; `RecoveryScreen.tsx:392-414`; `ItemEditScreen.tsx:446-464`; `App.tsx:242` | Apply the existing `themeColors` to those 3 screens; drive StatusBar from `useActiveTheme()` |
| 14 | Accessibility: 9 labels across 291 touchables; check-off checkbox has no role/label/state; tab bar lacks tab roles; swipe-delete has no screen-reader alternative; 36px header buttons < 44pt | `ItemRow.tsx:111-136`; `BottomTabBar.tsx:59-83`; `SwipeableListCard.tsx:87-129`; `HomeScreen.tsx:1057-1063` | Prioritize check-off row (role=checkbox + item-name label), tab roles, steppers; hitSlop sub-44pt targets |
| 15 | Tab bar semantics shift per screen: "Scan" does different things on Home vs list; "Lists" pops you out of a list; Home/Lists identical; "Account" is Settings | `HomeScreen.tsx:727-749`; `GroceryListScreen.tsx:686-702` | 4 tabs (Lists/Scan/Deals/Settings), one behavior each; list detail = pushed screen, back chevron only |
| 16 | Dead settings: Voice Input & Barcode toggles persisted but never checked (AddItemSheet ignores them); 4 overlapping pricing switches with no hierarchy | `SettingsScreen.tsx:572-628, 772-817`; `AddItemSheet.tsx:595-616` | Honor or remove the toggles; one master "Price comparison" switch with revealed sub-options |
| 17 | Blocking success Alerts everywhere ("Success — Added X to Y", "QR Code Generated") | `HomeScreen.tsx:372, 411`; `ItemEditScreen.tsx:402` | Reuse the existing `UndoToast` for non-blocking confirmation |

### MINOR

| # | Issue | Evidence | Concrete fix |
|---|---|---|---|
| 18 | Relay URL/port SecureStore-write on every keystroke; empty port silently snaps to 8080 | `SettingsScreen.tsx:424-444`; `settings.ts:100-110` | Buffer locally, save on blur; inline port validation |
| 19 | Raw multi-hundred-char pairing token rendered to users twice | `SettingsScreen.tsx:478-479, 512-514` | Hide the token; QR + "Copy invite link" only |
| 20 | Manual pairing: no paste button, no `ws://` normalization (Recovery *has* paste — inconsistent) | `PairingScreen.tsx:271-310` vs `RecoveryScreen.tsx:351-353` | Add paste + auto-prepend `ws://`, split trailing port |
| 21 | `PermissionRationaleModal` built but never mounted; camera permission fires cold; denial has no "Open Settings" | `PermissionRationaleModal.tsx` (unused); `BarcodeScannerScreen.tsx:62-79` | Mount the modal pre-request; add `Linking.openSettings()` to denial state |
| 22 | Terminology drift: "Join my grocery list!" vs family-wide model; delete modal warns "all family members" for solo users; "Leave Family (Unpair Device)" mixes metaphors | `HomeScreen.tsx:230-233`; `DeleteConfirmationModal.tsx:62-64`; `SettingsScreen.tsx:740-742` | Standardize on "family"; condition the delete warning on member count |
| 23 | Trip optimizer buried in a collapsed emoji header; "Plan My Trip" with no prices yields all-unassigned plan with no pointer to enable pricing | `StopOptimizer.tsx:79-97, 161-174`; `TripPlanSheet.tsx:173-196` | No-prices state → "Find prices first" CTA; auto-expand when proposals exist |
| 24 | Icon-only "+" on deal cards unlabeled; 16px dismiss target on price summary | `HomeScreen.tsx:700-709`; `GroceryListScreen.tsx:1040-1049` | Labels + hitSlop |
| 25 | Splash hard-codes 2s even when init finishes sooner | `App.tsx:206-213`; `SplashScreen.tsx:32` | Dismiss at `max(ready, ~800ms)` |

## 3. Verdict

A non-technical user gets a fast, polished **local** list in under a minute —
the core loop (create → quick-add → check off → undo) is genuinely good. The
same user **cannot reach the headline feature — a shared, synced family
list — unaided**: it presupposes a self-hosted WebSocket relay, `ws://` URLs,
a QR/token handoff, and an out-of-band 12-word phrase exchange, with a
misleading "Connected" indicator hiding where things stand. Until there's a
hosted default relay (or an honest "requires a home server" gate) plus an
invite wizard that carries the recovery phrase alongside the QR, family sync
is enthusiast-only.

## Suggested fix order (if/when edits are approved — none made in this audit)
1. #3 (functional bug), #2 (false "Connected"), #4 (init dead end) — trust killers
2. #5 + #1 (onboarding + sharing gate) — determines mainstream viability
3. #6, #7, #12 (rename, tap-to-edit, plain-language errors) — daily-use friction
4. #13, #14 (dark-mode setup path, a11y) — store-review-adjacent polish
5. Everything else opportunistically
