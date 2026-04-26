# JobFlow AI

> **An AI-driven job-search command center.** Discover jobs across 35+ sources, evaluate them against your CV with Claude / Gemini / OpenAI, generate tailored ATS-clean CVs per posting, and track every application from lead → offer in one dashboard.

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js 22">
  <img src="https://img.shields.io/badge/Next.js-16-000?style=flat&logo=next.js&logoColor=white" alt="Next.js 16">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Claude-Opus_4.7-000?style=flat&logo=anthropic&logoColor=white" alt="Claude">
  <img src="https://img.shields.io/badge/Gemini-2.5-4285F4?style=flat&logo=google&logoColor=white" alt="Gemini">
  <img src="https://img.shields.io/badge/OpenAI-supported-412991?style=flat&logo=openai&logoColor=white" alt="OpenAI">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
</p>

---

## Why JobFlow AI

Most job search "tools" are either **scrapers that drown you in noise** or **resume builders that don't know your target.** JobFlow does both — and connects them.

- **35 free job sources.** No paid APIs required for the default loadout. Greenhouse, Lever, Ashby, Workable, Remotive, RemoteOK, Arbeitnow, Mustakbil (Pakistan), Get-on-Board (LATAM), Hacker News Jobs, Landing.jobs, Python Jobs, weworkremotely, themuse, jobicy, working-nomads, himalayas, hn-whoishiring + 6 keyed APIs (Adzuna, CareerJet, Jooble, JSearch, FindWork, USAJobs) when you want them.
- **Region-aware out of the box.** Pakistan, Gulf (UAE / KSA / Qatar / Oman / Bahrain / Kuwait), Europe, US, worldwide-remote — region filters baked into the adapter contract, not bolted on.
- **AI evaluation that actually reads your CV.** A–G scoring against your real proof points — not generic keyword matching.
- **Tailored CV per job in 90 seconds.** CV Studio runs `pdf.md` → fills the HTML template → renders via Playwright. ATS-clean, keyword-injected, single-column.
- **Multi-model.** Pick Claude, Gemini, or OpenAI per run from the model picker.
- **Local-first.** No SaaS, no telemetry, no account. Everything in `data/` and `output/` on your disk.

---

## Quick start

```bash
# 1. Install (Node 22+)
npm install
cd dashboard-web && npm install && cd ..

# 2. Bootstrap your data
cp templates/portals.example.yml portals.yml          # source config
cp config/profile.example.yml config/profile.yml      # your identity
cp .env.example .env                                  # API keys (optional)

# 3. Drop your CV at the project root
echo "# Your CV in markdown" > cv.md

# 4. Run a probe sweep — verifies every adapter is alive
node scripts/probe-sources.mjs

# 5. Build + start the dashboard
npm run dashboard:build
npm run web                                            # → http://localhost:5177/dashboard
```

That's it. Open the dashboard and click **Scan Now** to pull jobs, then **Apply** / **Evaluate** / **CV Studio** on any row.

---

## Features

### Job discovery (35 adapters)

```
api/         arbeitnow · adzuna · careerjet · findwork · getonbrd · himalayas
             · hn-jobstories · hn-whoishiring · jobicy · jooble · jsearch
             · landing-jobs · remoteok · remotive · themuse · usajobs
             · web3career · working-nomads
ats/         greenhouse · lever · ashby · workable · personio · recruitee
             · smartrecruiters · teamtailor
rss/         mustakbil · python-jobs · weworkremotely · jobspresso
sitemap/     dubizzle · qatarliving · rozee
jsonld/      universal (any site with JobPosting JSON-LD)
scrape/      linkedin-guest (ToS-gated; off by default)
```

Every adapter implements the same contract: `meta` block (regions, requiresKey, requiresInputs, signupUrl, freeTier) + `default async (config, ctx) => Job[]`. Adding a new source is a single file under `scanners/{kind}/`.

### AI agent flow

| Mode | What it does | Endpoint |
|------|--------------|----------|
| `oferta` / Evaluate | A–G scoring against CV + proof points | `POST /api/evaluate` |
| `pdf` / CV Studio | Tailor CV → render HTML → Playwright PDF | `POST /api/generate-cv` |
| `apply` | Draft form answers from JD + report | `POST /api/draft-application` |
| `deep` | Company research dossier | `POST /api/deep-research` |
| `contacto` | LinkedIn outreach drafting | `POST /api/contacto` |
| `interview-prep` | Company-specific interview intel | `POST /api/interview-prep` |
| `patterns` | Rejection-pattern analysis | `POST /api/patterns` |
| `followup` | Cadence-aware follow-up drafting | `POST /api/draft-followup` |

Every endpoint is SSE-streamed with token-by-token output and supports `Claude`, `Gemini`, or `OpenAI` via the model picker.

### Dashboard (Next.js 16 + React 19)

18 pages: Overview · Pipeline · Applications (kanban) · Jobs (filterable) · Sources Health · Saved Searches · Reports · Outputs · Compare · Patterns · Followups · Stories · Interview Prep · JDs · Settings · Run · Analytics. Built with shadcn/ui + Tailwind + TanStack Query/Virtual + Sonner + react-hook-form + Zod.

### Reliability

- **Circuit breaker** opens after 5 failures per adapter, 5-min cooldown
- **Domain-scoped rate limiter** (1.5s spacing per host)
- **fetchWithRetry** with backoff, 429 retry-after, on-disk response cache
- **SSE keepalive** every 20s on agent streams (proxy-friendly)
- **`safeJoin` path validation** on every endpoint that touches the filesystem
- **`requiresInputs` / `requiresAck`** registry skips with actionable hints rather than silent zero-runs

### Test coverage

- **120 backend tests** (Node `--test`): registry, agent providers, every API route, SSE shape, parser helpers, 11 adapter golden-fixture tests
- **20 dashboard tests** (Vitest + RTL): SSE consumer, format helpers, dialog smoke renders
- **Live probe sweep** (`scripts/probe-sources.mjs`): hits every adapter against real endpoints; fails CI if any enabled source returns 0 without a documented skip reason

---

## Architecture

```
┌──────────────────────────────┐
│  dashboard-web/  (Next.js)   │  18 pages · TanStack Query · shadcn/ui
└──────────────┬───────────────┘
               │ /api/*
┌──────────────▼───────────────┐
│  web-server.mjs              │  Express-style router · SSE streams
│   ├─ scan / health / jobs    │
│   ├─ evaluate / generate-cv  │
│   └─ apply / interview-prep  │
└──────────────┬───────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌─────────────┐   ┌─────────────────┐
│ scanners/   │   │ scanners/agents │
│  registry   │   │  Claude · Gemini│
│  35 sources │   │  · OpenAI       │
└─────────────┘   └─────────────────┘
```

Storage is plain markdown + JSONL on disk:
- `data/applications.md` — kanban tracker
- `data/pipeline.md` — pending URLs
- `data/jobs.jsonl` — append-only scanner output
- `reports/*.md` — A–G evaluations
- `output/*.{html,pdf}` — generated CVs

No database. No auth. Single-user. Easy to backup; easy to grep.

---

## Configuration

### `portals.yml`

Defines title filters, region presets, and per-adapter config. Companies for ATS adapters live here:

```yaml
sources:
  greenhouse:
    enabled: true
    companies: [careem, tamara, airbnb, stripe, figma, ...]
  lever:
    enabled: true
    companies: [palantir, spotify, qonto, pigment, mistral]
  mustakbil:
    enabled: true
    locations: [Karachi, Lahore, Islamabad, Rawalpindi]
```

### `.env`

Optional API keys for the 6 keyed adapters. Each adapter's "Get a free key →" link surfaces directly on the Sources page when the key is missing.

```bash
# Worldwide + PK + Gulf coverage
CAREERJET_AFFILIATE=               # https://www.careerjet.com/partners
JOOBLE_KEY=                        # https://jooble.org/api/about
ADZUNA_APP_ID=                     # https://developer.adzuna.com
ADZUNA_APP_KEY=

# Niche / optional
THE_MUSE_KEY=                      # raises rate limit; works unkeyed
USAJOBS_USER_EMAIL=                # US federal
USAJOBS_API_KEY=
FINDWORK_TOKEN=                    # tech-focused worldwide
RAPIDAPI_KEY=                      # for jsearch (200 req/mo free tier)
```

### `config/profile.yml`

Your identity, target roles, comp band, language preference. Used by every agent prompt.

### `cv.md`

Your CV in markdown. The single source of truth — every tailored PDF is generated from this.

---

## Scripts

```bash
npm test                        # backend tests (120)
npm run test:dashboard          # dashboard tests (20)
npm run test:all                # both
npm run web                     # start the API + dashboard server
npm run dashboard:dev           # Next.js dev server (live reload)
npm run dashboard:build         # production build of the dashboard
npm run scan:v2                 # CLI scan against portals.yml
npm run scan:v2:list            # list every adapter + its meta
node scripts/probe-sources.mjs  # live-probe every adapter, write data/source-health.json
```

---

## Roadmap

- [ ] Hosted SaaS tier (Postgres, auth, billing) — currently single-user only
- [ ] Browser extension for one-click "save to JobFlow" from any career page
- [ ] Slack / Telegram alerts on new high-fit roles
- [ ] Cmd+K command palette across the dashboard
- [ ] Mobile-responsive polish

---

## Credits

JobFlow AI is built on top of [**career-ops**](https://github.com/santifer/career-ops) by [Santiago Fernández de Valderrama](https://santifer.io). The agent orchestrator, mode files (`modes/*.md`), and original scanner architecture are his — JobFlow extends that foundation with:

- The Next.js dashboard (`dashboard-web/`)
- A modular 35-adapter scanner registry under `scanners/`
- The `web-server.mjs` API + SSE streaming layer
- CV Studio (3-stage agent → HTML → PDF pipeline)
- Multi-model agent abstraction (Claude / Gemini / OpenAI)
- Live probe + Sources Health dashboard
- 140 tests across backend + frontend

If you find this useful, star [the upstream](https://github.com/santifer/career-ops) too.

---

## License

MIT. See [LICENSE](LICENSE) — copyright remains with Santiago Fernández de Valderrama for the upstream foundation. Modifications and additional code in this fork © 2026 Hassan Asif.

---

<p align="center"><sub>Built with Claude Opus 4.7 (1M context) · Sonnet 4.6 · Gemini 2.5 · GPT-4o</sub></p>
