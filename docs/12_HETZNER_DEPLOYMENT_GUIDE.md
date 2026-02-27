# Hetzner Docker Deployment Guide (Iderwell Server)

Last verified against code: 2026-02-12

This runbook is the practical guide to move this system from local development to your Hetzner server, where other Docker projects already exist.

If any instruction here conflicts with `docs/03_SECURITY_REQUIREMENTS.md`, the security document takes priority.

## Goal

Deploy the current Restaurant Ops baseline to your existing Docker host safely, without breaking other running projects, and prepare environment wiring for Hubtel integration.

## Current Baseline Being Deployed

- Node.js app (`src/server.js`) with SQLite (`data/app.db`)
- Admin UI under `/admin/*`
- Rider web scaffold under `/rider/index.html`
- Receipts under `/receipts/*`
- APIs under `/api/*` and `/api/admin/*`

## Deployment Strategy

- Use an isolated Docker Compose project name and directory.
- Use unique container name, volume names, and internal port mapping.
- Attach to your existing reverse proxy network (do not replace other proxy stacks).
- Keep secrets in `.env` file on the server, not in git.
- Persist `data/` directory with Docker volume or bind mount.

## Phase 1: Server Discovery (Run After SSH Connect)

Run these commands and keep output for deployment decisions:

```bash
hostnamectl
docker version
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}"
docker network ls
docker volume ls
docker system df
```

If you use Docker Compose plugin:

```bash
docker compose version
```

If you use legacy binary:

```bash
docker-compose version
```

Find existing reverse proxy stack (Traefik / Nginx Proxy Manager / Caddy / custom nginx):

```bash
docker ps --format "{{.Names}} {{.Image}}" | grep -Ei "traefik|nginx|proxy|caddy"
```

## Phase 2: Server Directory Layout

Recommended:

```bash
sudo mkdir -p /opt/iderwell/restaurant-ops
sudo chown -R $USER:$USER /opt/iderwell/restaurant-ops
cd /opt/iderwell/restaurant-ops
```

Suggested structure:

- `/opt/iderwell/restaurant-ops/app` (project code)
- `/opt/iderwell/restaurant-ops/env/.env` (runtime secrets)
- `/opt/iderwell/restaurant-ops/data` (sqlite + receipts, if bind mounting)

## Phase 3: Add Container Artifacts in This Repo

Create the following in this project:

- `Dockerfile`
- `.dockerignore`
- `docker-compose.prod.yml`

Use this baseline `Dockerfile`:

```dockerfile
FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 4000

CMD ["npm", "start"]
```

Use this baseline `.dockerignore`:

```text
node_modules
npm-debug.log
data
.env
.git
.gitignore
```

Use this baseline `docker-compose.prod.yml`:

```yaml
name: restaurant_ops

services:
  restaurant_ops_app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: restaurant_ops_app
    restart: unless-stopped
    env_file:
      - ./env/.env
    ports:
      - "127.0.0.1:4010:4000"
    volumes:
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - restaurant_ops_net

networks:
  restaurant_ops_net:
    driver: bridge
```

Notes:

- Host bind uses `127.0.0.1:4010` to avoid public direct exposure.
- Your reverse proxy should route domain traffic to `127.0.0.1:4010`.
- If your proxy requires shared Docker network (Traefik style), we will add that after Phase 1 discovery.

## Phase 4: Prepare Production Environment File

Start from `.env.example` and create server runtime env file:

```bash
mkdir -p env data
cp .env.example env/.env
```

Set at minimum:

```dotenv
NODE_ENV=production
PORT=4000
PUBLIC_BASE_URL=https://<your-domain>
JWT_SECRET=<strong-random-secret>
HUBTEL_CALLBACK_SECRET=<strong-random-secret>
COOKIE_SECURE=true

DATABASE_PATH=./data/app.db

ADMIN_DEFAULT_EMAIL=<admin-email>
ADMIN_DEFAULT_PASSWORD=<strong-admin-password>
```

Hubtel-ready values (populate when going live):

```dotenv
HUBTEL_POS_SALES_ID=
HUBTEL_BASIC_AUTH=
HUBTEL_TXN_STATUS_BASE_URL=https://api-txnstatus.hubtel.com
HUBTEL_TXN_STATUS_BASIC_AUTH=
HUBTEL_RECEIVE_MONEY_BASE_URL=https://rmp.hubtel.com
HUBTEL_RECEIVE_MONEY_BASIC_AUTH=
HUBTEL_RECEIVE_MONEY_CALLBACK_URL=https://<your-domain>/api/payments/hubtel/callback
HUBTEL_VERIFICATION_BASE_URL=https://rnv.hubtel.com/v2
HUBTEL_VERIFICATION_BASIC_AUTH=
ENABLE_MOMO_NAME_VERIFICATION=true

HUBTEL_SMS_BASE_URL=https://sms.hubtel.com/v1/messages/send
HUBTEL_SMS_CLIENT_ID=
HUBTEL_SMS_CLIENT_SECRET=
HUBTEL_SMS_FROM=<sender-id>
```

Optional:

```dotenv
RIDER_APP_KEY=<rider-api-key>
ENABLE_STATUS_CHECK_JOB=true
STATUS_CHECK_INTERVAL_MS=300000
```

## Phase 5: Transfer and Deploy

Option A (git on server):

```bash
cd /opt/iderwell/restaurant-ops
git clone <repo-url> app
cd app
```

Option B (rsync from local machine):

```bash
rsync -av --exclude node_modules --exclude .git ./ <server-user>@<server-ip>:/opt/iderwell/restaurant-ops/app/
```

Then deploy:

```bash
cd /opt/iderwell/restaurant-ops/app
mkdir -p env data
# ensure env/.env exists here (or symlink to /opt/iderwell/restaurant-ops/env/.env)

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=120
```

## Phase 6: Initialize Database + Seed

Run one-time setup inside the running container:

```bash
docker exec -it restaurant_ops_app npm run setup
```

If admin already exists and only menu seed needed:

```bash
docker exec -it restaurant_ops_app npm run seed:menu
```

## Phase 7: Reverse Proxy Routing

Route your chosen domain/subdomain to `http://127.0.0.1:4010`.

Required paths to pass through:

- `/admin/*`
- `/rider/*`
- `/receipts/*`
- `/api/*`

Do not strip path prefixes.

Ensure TLS is active and valid before enabling `COOKIE_SECURE=true`.

## Phase 8: Validation Checklist

From server:

```bash
curl -sS http://127.0.0.1:4010/api/health
```

From browser:

1. Open `https://<your-domain>/admin/login.html`
2. Login with seeded admin
3. Open operations, in-store, menu, analytics, settings pages
4. Create in-store cash order and confirm it reaches kitchen lane
5. Run local simulation against deployed API if needed

Optional smoke test:

```bash
docker exec -it restaurant_ops_app npm test
```

## Phase 9: Hubtel Readiness

Before switching to live Hubtel:

1. Confirm callback public URL:
   - `https://<your-domain>/api/payments/hubtel/callback`
2. Confirm callback secret configured identically on both sides.
3. Test callback signature validation with a controlled payload.
4. Verify outbound SMS credentials and sender ID.
5. Verify in-store MoMo prompt initiation with test number.

## Operations and Maintenance

Logs:

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=200
```

Restart:

```bash
docker compose -f docker-compose.prod.yml restart
```

Update:

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Backup and Rollback

Backup app data:

```bash
tar -czf backup-restaurant-ops-$(date +%F).tar.gz data env/.env
```

Rollback strategy:

1. Keep previous image tag or previous commit checked out.
2. Rebuild and redeploy previous revision.
3. Restore `data/` backup only if schema/data corruption occurred.

## Live Session Plan (When You SSH in VS Code)

When you connect, we will do this in order:

1. Run Phase 1 discovery commands and map your current Docker/proxy setup.
2. Finalize compose networking/labels to fit your existing server architecture.
3. Create deployment files in repo (if not already committed).
4. Transfer and deploy container.
5. Seed DB and validate all admin/rider/public endpoints.
6. Configure Hubtel callback + credential readiness.
7. Prepare a separate implementation plan for Rider APK packaging.
