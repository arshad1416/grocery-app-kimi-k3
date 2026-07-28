# Self-Hosted Security Requirements

## TLS is MANDATORY

The relay server uses raw HTTP by default. If you expose your server to the
internet **without TLS**, all authentication tokens and metadata traverse in
cleartext. While the grocery list payload is end-to-end encrypted (XChaCha20-
Poly1305), your device tokens, family IDs, and connection metadata are exposed
to man-in-the-middle (MITM) attacks.

**An attacker on the network path can:**
- Steal relay tokens and impersonate your devices
- Observe which family IDs are syncing (metadata leakage)
- Inject malicious relay messages (replay, denial of service)

## Required: TLS Termination

You **MUST** place a TLS-terminating reverse proxy in front of the relay server.

### Option A: Nginx (recommended)

```nginx
server {
    listen 443 ssl http2;
    server_name relay.yourdomain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # WebSocket support
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;  # keep WebSocket alive
    }
}
```

### Option B: Caddy (easiest — automatic TLS)

```bash
# Caddyfile
relay.yourdomain.com {
    reverse_proxy localhost:8080
}
```

Caddy automatically provisions and renews Let's Encrypt certificates.

### Option C: Cloudflare Tunnel (no port forwarding)

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Create a tunnel
cloudflared tunnel create grocery-relay
cloudflared tunnel route dns grocery-relay relay.yourdomain.com

# Run the tunnel
cloudflared tunnel run --url http://localhost:8080 grocery-relay
```

This is the easiest option if you don't want to manage certificates or open
firewall ports. Traffic is encrypted end-to-end through Cloudflare's network.

### Option D: Built-in TLS (for testing only)

The relay server supports TLS natively via environment variables:

```bash
TLS_CERT=/path/to/cert.pem TLS_KEY=/path/to/key.pem node server.js
```

**⚠️ Not recommended for production** — no automatic certificate renewal, no
HSTS headers, no rate limiting at the TLS layer.

## Don't Expose to the Internet

If you only need sync on your home network, there's no need to expose the relay
to the internet at all. Just run it locally and connect via LAN IP:

```bash
# On your home server
node server.js

# On your phone — connect via LAN IP in Settings
# e.g., http://192.168.1.50:8080
```

This is the most secure option: no attack surface beyond your local network.

## Certificate Management

For production deployments, use Let's Encrypt with automatic renewal:

```bash
# Certbot with Nginx
sudo certbot --nginx -d relay.yourdomain.com

# Auto-renewal (add to crontab)
0 12 * * * /usr/bin/certbot renew --quiet
```

## Security Headers

Add these headers in your reverse proxy for defense-in-depth:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
```
