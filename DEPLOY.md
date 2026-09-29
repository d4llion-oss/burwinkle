# Deploying Burwinkle on DigitalOcean

Two supported paths. Pick one.

| | **A. Droplet + Docker Compose** (recommended to start) | **B. App Platform + Managed Postgres** |
|---|---|---|
| Cost | ~$6–12/mo (one Droplet) | ~$5/mo app + ~$7/mo dev Postgres |
| Storage | SQLite file in a Docker volume | Managed Postgres |
| HTTPS | Automatic (Caddy + Let's Encrypt) | Automatic |
| Deploys | `git pull && docker compose up -d --build` | Push to GitHub |
| Ops | You own the box (updates, backups) | DigitalOcean runs it |

Both use the same code. The app picks SQLite when `DATABASE_URL` is unset and Postgres when it is set.

---

## Before you start (both paths)

1. **Generate secrets** on your laptop:
   ```bash
   openssl rand -base64 48   # SESSION_SECRET — signs the anonymous identity cookie
   openssl rand -base64 24   # ADMIN_TOKEN    — unlocks moderation in the app (Me > Moderation)
   ```
   Keep both somewhere safe. Rotating `SESSION_SECRET` logs every visitor out of their anonymous identity (they lose "mine" on their stories and their votes are orphaned), so treat it as permanent.
2. **A domain** you control, with DNS managed anywhere (DigitalOcean DNS works well).

---

## A. Droplet + Docker Compose

### 1. Create the Droplet
- DigitalOcean console → **Create → Droplets**
- Image: **Ubuntu 24.04 LTS**
- Size: **Basic, Regular, $6/mo (1 vCPU / 1 GB)** is plenty to start
- Authentication: **SSH key**
- Enable **Monitoring**; enable **Backups** if you want DO to snapshot the whole box weekly
- Create it and note the public IPv4 address

### 2. Point DNS at it
In your DNS provider add an **A record**: `burwinkle.com` (or `app.burwinkle.com`) → the Droplet's IP. Add `www` too if you want it. Wait until `dig +short burwinkle.com` returns the IP (usually a few minutes).

### 3. Prepare the box
```bash
ssh root@YOUR_DROPLET_IP
# paste the contents of deploy/droplet-setup.sh, or:
bash <(curl -fsSL https://raw.githubusercontent.com/YOUR_USER/burwinkle/main/deploy/droplet-setup.sh)
```
That installs Docker, opens ports 22/80/443 in the firewall, and creates `/opt/burwinkle`.

### 4. Copy the app up
From your laptop, in the folder that contains this package:
```bash
scp -r burwinkle/ root@YOUR_DROPLET_IP:/opt/
```
(or `git clone` your repo into `/opt/burwinkle` on the Droplet).

### 5. Configure
```bash
ssh root@YOUR_DROPLET_IP
cd /opt/burwinkle
cp .env.example .env
nano .env        # set DOMAIN, SESSION_SECRET, ADMIN_TOKEN
```

### 6. Launch
```bash
docker compose up -d --build
docker compose logs -f        # watch Caddy obtain the certificate; Ctrl-C to stop watching
```
Open `https://YOUR_DOMAIN`. Caddy fetches the TLS certificate on the first request; if it fails, DNS hasn't propagated yet or port 80/443 is blocked.

Optional example stories (tagged "Example" in the app; remove later with `--clear`):
```bash
docker compose exec app npm run seed
docker compose exec app npm run seed -- --clear
```

### 7. Verify
```bash
docker compose exec app node scripts/smoke.js          # runs against the container
curl -s https://YOUR_DOMAIN/api/health                  # {"ok":true,"storage":"sqlite"}
```
In the app, go to **Me → Moderation**, paste `ADMIN_TOKEN`, and confirm you can delete any story.

### Day-2 operations
- **Update the app**: `cd /opt/burwinkle && git pull && docker compose up -d --build`
- **Logs**: `docker compose logs -f app` / `docker compose logs -f caddy`
- **Back up the database** (SQLite file lives in the `burwinkle-data` volume):
  ```bash
  docker compose exec app node -e "require('better-sqlite3')('/data/burwinkle.sqlite').backup('/data/backup-'+Date.now()+'.sqlite')"
  docker cp $(docker compose ps -q app):/data/ ./backups/
  ```
  Or put a nightly cron on the Droplet that runs the two lines above and uploads to a DO Space with `s3cmd`.
- **Restore**: stop the app, copy the `.sqlite` file back into the volume as `burwinkle.sqlite`, start it.
- **Move to Postgres later**: create a Managed Postgres cluster, set `DATABASE_URL` in `.env`, restart. Data does not migrate automatically; export stories/votes from SQLite and insert them if you need to keep history.
- **No domain yet?** Edit `deploy/Caddyfile`: comment out the `{$DOMAIN}` block and uncomment the `:80` block, then `docker compose restart caddy`. The site serves over plain HTTP on the IP (cookies still work; the app only marks them `Secure` behind HTTPS in production, so switch to a real domain before launch).

---

## B. App Platform + Managed Postgres

App Platform containers have no persistent disk, so this path uses Managed Postgres.

### 1. Push the code to GitHub
Create a repo (private is fine) and push this folder to `main`.

### 2. Create the app
Either in the console (**Create → Apps → GitHub → pick the repo**, choose **Dockerfile** as the build) or with the spec:

```bash
# edit deploy/app-platform.yaml first: set github.repo and the two secrets
doctl apps create --spec deploy/app-platform.yaml
```
The spec provisions a dev Postgres database (`burwinkle-db`) and wires its connection string into `DATABASE_URL`. If you create the app in the console instead, add a **Dev Database** component and set these environment variables on the `web` service:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${burwinkle-db.DATABASE_URL}` (bindable variable) |
| `SESSION_SECRET` | your generated secret (mark **Encrypt**) |
| `ADMIN_TOKEN` | your generated token (mark **Encrypt**) |

Health check path: `/api/health`. HTTP port: `8080`.

### 3. Domain
**Settings → Domains → Add Domain**, enter your domain, and add the CNAME/A records DigitalOcean shows you. HTTPS is automatic.

### 4. Seed and verify
```bash
doctl apps list                       # get the app id
doctl apps console <app-id> web       # opens a shell in the running container
npm run seed                          # optional example stories
node scripts/smoke.js                 # BASE defaults to localhost:8080 inside the container
```
Then `curl https://YOUR_DOMAIN/api/health` should return `{"ok":true,"storage":"postgres"}`.

### Notes
- Every push to `main` redeploys.
- The dev database has no automated backups; upgrade to a production Postgres node before real launch (**Databases → Upgrade**), which adds daily backups and point-in-time restore.
- App Platform sets `PORT`; the app reads it.

---

## Environment variables (reference)

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | yes (prod) | HMAC key for the anonymous identity cookie |
| `ADMIN_TOKEN` | recommended | Moderation password. Unset = moderation disabled |
| `DATABASE_URL` | no | Postgres connection string. Unset = SQLite in `DATA_DIR` |
| `DATA_DIR` | no | SQLite directory (default `./data`; `/data` in Docker) |
| `PORT` | no | Listen port (default `8080`) |
| `NODE_ENV` | yes (prod) | `production` turns on `Secure` cookies and HSTS |
| `DOMAIN` | Droplet only | Read by Caddy for the certificate |

## What the app enforces on the server
- One anonymous identity per browser (signed, HttpOnly cookie, 2 years). No accounts, no email.
- One upvote per identity per story; a second tap removes it.
- Posting limits: 10 stories/hour and 60 votes/minute per identity; 5 admin login attempts per 15 minutes per IP.
- Content rules: company 2–60 chars, who 2–40, one-liner 8–120, story ≤500; rejects anything containing an email, URL, or phone number.
- Authors can delete their own stories; the admin can delete any and sees reported stories.
- Security headers including a CSP that only allows the app's own scripts and Google Fonts.

## Things to decide before a public launch
- **Terms and takedown**: the site ships with `/terms` (Terms & Takedowns) pointing people to **abuse@burwinkle.com**. Create that mailbox before launch (Google Workspace, Fastmail, or a forwarder in DO DNS/Cloudflare Email Routing), watch it daily, and honor the response times the page promises (acknowledge in 2 business days, decide in 5). Have a lawyer read the page once; it's a plain-language starting point, not legal advice.
- **Abuse**: the in-memory rate limiter resets on restart and is per-instance. If you scale past one container or see abuse, move limits to Postgres or Redis.
- **Analytics/CDN**: Cloudflare in front of the Droplet is a cheap way to add DDoS protection and caching; keep "Full (strict)" TLS mode so Caddy's certificate still works.
