# Burwinkle

*Don't Get Yourself Burwinkled.*

Anonymous workplace gossip. Employees call out coworkers with a short story, everyone upvotes, the best burns enter the **Burwinkle HOF**, and companies are ranked on the **Most Burwinkled** leaderboard.

## Stack
- **Front-end**: one mobile-first page (`public/`), no framework, no build step.
- **API**: Node 20 + Express (`server/`).
- **Storage**: SQLite (default, zero config) or Postgres (`DATABASE_URL`).
- **Deploy**: Docker. See **[DEPLOY.md](DEPLOY.md)** for DigitalOcean Droplet and App Platform instructions.

## Run locally
```bash
npm install
cp .env.example .env            # optional; defaults work in development
ADMIN_TOKEN=letmein npm run dev  # http://localhost:8080
npm run seed                    # example stories (tagged "Example" in the UI)
npm run smoke                   # end-to-end API check against the running server
```

## Layout
```
public/            index.html, app.css, app.js, favicon.svg   — the app
                   terms.html, terms.js                       — /terms (Terms & Takedowns, abuse@burwinkle.com)
server/index.js    Express API + static serving + security headers
server/db.js       SQLite / Postgres adapter and schema
server/seed.js     example stories (npm run seed [-- --clear])
scripts/smoke.js   API smoke test
deploy/            Caddyfile (HTTPS), App Platform spec, Droplet setup script
Dockerfile, docker-compose.yml, .env.example
```

## API
| Method | Path | What |
|---|---|---|
| GET | `/api/health` | liveness + storage kind |
| GET | `/api/me` | your anonymous id, admin state |
| GET | `/api/stories` | all stories with vote counts and your votes |
| POST | `/api/stories` | `{company, who, title, body}` |
| DELETE | `/api/stories/:id` | author or admin |
| POST | `/api/stories/:id/vote` | toggle your upvote |
| POST | `/api/stories/:id/report` | flag for moderation |
| POST | `/api/admin/login` | `{token}` → admin cookie (12h) |
| GET | `/api/admin/reports` | reported stories (admin) |

Rankings are computed in the browser from `/api/stories`: **Hot** = (votes+1)/(hours+2)^1.2, **HOF** = top 25 by votes, **Burn Score** = votes + 5×stories per company, scaled so the leader is 100.

## Data model
```
stories(id, company, company_key, who, title, body, author, example, created_at)
votes(user_id, story_id, created_at)   -- primary key (user_id, story_id): one vote per person
reports(id, story_id, user_id, reason, created_at)
```
`author` and `user_id` are the anonymous cookie id (`u_…`); nothing identifying is stored.
