# Pool Isolation — Deploying Issuer and Pool on Separate Origins

The crowdsourced price pool is designed so that **who you are** (relay/token
issuer) and **what you contribute** (pool) can never be joined:

- The **token issuer** (part of the relay, `POST /relay/request-token`) knows
  your device identity but only ever sees a *blinded* message (RFC 9474 Blind
  RSA, RSABSSA-SHA384-PSS-Randomized). It cannot recognize the token later.
- The **pool** (`POST /api/pool/contribute`) verifies tokens with only the
  issuer's *public* key and accepts no identity, cookies, or auth headers.
  It fails closed if `ISSUER_PUBLIC_KEY` is not configured.

Cryptographic unlinkability is already end-to-end. What separate origins add
is **network-layer isolation**: a single origin could still correlate a
device's token request and its contribution by source IP + timing in one log.

## v1 deployment (separate origin, honest disclosure)

1. The relay container serves the pool on its own port (`POOL_PORT=8081` in
   `docker-compose.yml`; the relay + issuer stay on `8080`).

2. Publish the two ports under **different origins** at your reverse proxy —
   ideally on separate hosts/IPs; at minimum separate subdomains:

   ```caddy
   # Caddyfile
   relay.example.com {
     reverse_proxy localhost:8080
   }

   pool.example.com {
     reverse_proxy localhost:8081
     # Do not log client IPs for contributions:
     log {
       format filter {
         request>remote_ip delete
         request>client_ip delete
       }
     }
   }
   ```

   nginx equivalent: two `server` blocks, and for the pool server block use a
   custom `log_format` without `$remote_addr` (or `access_log off;`).

3. Point the app at the pool origin: Settings → Pricing → `poolUrl =
   https://pool.example.com`. (When `poolUrl` is empty the client falls back
   to the relay origin — fine for self-hosters, not for a community pool.)

4. Give the pool its verification key at startup:

   ```bash
   ISSUER_PUBLIC_KEY="$(cat keys/issuer-public-key.pem)"
   ```

## Honest disclosure (required until OHTTP)

Even with separate origins, the pool server sees contributors' IP addresses
at the TCP layer. Publish this in your privacy documentation, e.g.:

> The community pool cannot link contributions to your identity or device
> (blind-signature tokens), but like any web server it can see the IP address
> a contribution arrives from. Run your own relay for full IP privacy, or
> wait for OHTTP relay support (planned v2, RFC 9458).

## What NOT to do

- Don't run a "strip the IP" logging proxy and call it privacy — that is an
  operational promise, not a technical guarantee.
- Don't serve the community pool from the relay origin (`POOL_PORT=8080`):
  one origin means one log that can join identity and contributions.
