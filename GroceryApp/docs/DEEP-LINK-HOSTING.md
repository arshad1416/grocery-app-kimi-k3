# Universal / App Links — Hosting Checklist

Invite links (`https://groceryapp.app/invite?token=…`) only open the app
directly (no browser chooser) if BOTH association files are hosted at the
domain. Custom-scheme links (`groceryapp://invite?token=…`) work without any
hosting, but the shareable/QR links use https.

Deploy both under `https://groceryapp.app/.well-known/`, served as
`Content-Type: application/json`, over HTTPS, with NO redirects:

| Platform | Source in repo | Deploy path | Fill in before deploy |
|----------|----------------|-------------|-----------------------|
| iOS | `ios/apple-app-site-association` | `/.well-known/apple-app-site-association` | Replace `TEAMID` with your Apple Team ID |
| Android | `android/assetlinks.json` | `/.well-known/assetlinks.json` | Replace fingerprint with your signing cert's SHA-256 |

Notes:
- The iOS file must be served **without** a `.json` extension and without the
  `_comment` key (strip it), signed by a valid TLS cert.
- Android: if you use Google Play App Signing (recommended), use the SHA-256
  from Play Console → App integrity → *App signing key certificate* (NOT just
  the upload key), otherwise verified links fail once Play re-signs.
- Verify after deploy:
  - Android: `adb shell pm verify-app-links --re-verify com.shiftlogichq.stophop`
    then `adb shell pm get-app-links com.shiftlogichq.stophop`
  - iOS: install a TestFlight build and tap an `https://groceryapp.app/invite?…`
    link; it should open StopHop's Pairing screen.
- In-app routing is already wired: the `invite` path is an alias of the
  `Pairing` screen (`src/navigation/deepLinks.ts`), which reads `token` and
  runs the full join flow.
