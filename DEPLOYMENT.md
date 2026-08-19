# Deploying Foundable (seo-saas-microtool)

Production-style deployment for the backend (Fastify + Postgres + Drizzle) and the
frontend (Astro static site served by nginx). Everything runs behind a single
origin: nginx serves the site and proxies `/api/` to the backend container.

## Requirements

- Docker + Docker Compose
- A domain name and a host (any VPS works)

## 1. Configure environment variables

Create a `.env` file next to `docker-compose.prod.yml`:

```env
# The public origin(s) allowed to call the API. Comma-separated for multiple.
FRONTEND_ORIGIN=https://seo.example.com

# Postgres credentials (defaults shown)
POSTGRES_USER=foundable
POSTGRES_PASSWORD=replace-with-a-strong-password
POSTGRES_DB=foundable

# Public HTTP port on the host
PORT=80

# Optional: bake a different API origin into the frontend bundle.
# Leave empty for the same-origin nginx proxy (recommended).
# PUBLIC_API_BASE_URL=https://seo.example.com
```

Security notes:

- `NODE_ENV=production` makes the app require `FRONTEND_ORIGIN` and sets the
  session cookie to `Secure`.
- `TRUST_PROXY=true` lets the backend read the real client IP from
  `X-Forwarded-For` (set by nginx) so IP-based rate limiting works.
- SSRF protection is ON by default: the backend refuses to crawl
  localhost/private/internal network targets. Only set
  `CRAWL_ALLOW_PRIVATE_NETWORKS=true` for trusted local development.
- Rate limits are **in-memory** (per backend process) — see Limitations.

## 2. Build and start

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

The backend container applies Drizzle migrations on every start before launching,
so a fresh database is set up automatically. Verify:

```sh
docker compose -f docker-compose.prod.yml ps
curl -s http://localhost:80/api/health   # -> {"status":"ok"}
```

## 3. TLS (recommended)

Terminate TLS at the edge. The simplest route is to expose the frontend on an
internal port and put Caddy or a reverse proxy in front:

```sh
docker compose -f docker-compose.prod.yml --env-file .env run --rm -p 8080:80 frontend
```

then point Caddy at `localhost:8080`:

```
seo.example.com {
    reverse_proxy localhost:8080
}
```

Caddy obtains and renews Let's Encrypt certificates automatically and forwards
`X-Forwarded-Proto`, which the backend uses to keep cookies `Secure` and
`SameSite=Lax` (same-site, so Lax is correct).

## 4. Updating

```sh
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Limitations to address before a public launch

- **In-memory rate limiting**: limits reset when the backend restarts and are not
  shared across multiple backend replicas. Scale-out requires a shared store
  (e.g. Redis) or a reverse-proxy limiter.
- **Single backend process**: the crawl is fast (non-blocking) but CPU-heavy work
  (Reddit/Gemini analysis) runs in-process. Run more replicas behind a load
  balancer for larger traffic.
- **No persistent job queue**: long crawls survive a restart only up to the
  current run; a crashed run is recorded as FAILED.
- **Managed Postgres** (Neon, Supabase, RDS) is a drop-in replacement: just set
  `DATABASE_URL` directly and skip the bundled `postgres` service.
- **CI/CD and backups** are not configured here.