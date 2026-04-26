# scan-v2 — Multi-source job ingestion

The new scanner (`scan-v2.mjs`) runs alongside the legacy `scan.mjs` and pulls
from **27 free job sources** worldwide. Nothing is hardcoded — every keyword,
location, country, and company slug comes from `portals.yml`. The future SaaS
frontend writes to the same YAML shape (or, eventually, a Postgres table with the
same fields).

## Quick start

```bash
# 1. install the new dep
npm install

# 2. set your contact email + any optional adapter keys
cp .env.example .env
#  → edit .env and set SCANNER_EMAIL (sent in the UA so source operators can reach you)

# 3. give portals.yml a sources: block. Two ways:
#    a) start fresh from the template
cp templates/portals.example.yml portals.yml
#    b) keep your existing portals.yml and append the sources: block to it
node scan-v2.mjs --init-sources

# 4. discover what's available
npm run scan:v2:list                          # JSON list of every adapter
node scan-v2.mjs --list-options remotive      # one adapter's preset values

# 5. run it
npm run scan:v2:dry                           # dry-run (no files written)
npm run scan:v2                               # real run, writes data/*

# 6. ad-hoc query without editing portals.yml
node scan-v2.mjs --source remotive,mustakbil \
  --titles "AI Engineer, Senior Backend" \
  --regions "pakistan,worldwide-remote" \
  --include-disabled --dry-run --json
```

## CLI flags

| Flag | Description |
|---|---|
| `--source <ids>` | Comma-separated adapter ids to run (default: every enabled adapter) |
| `--titles <strings>` | Comma-separated keywords (mapped to each adapter's `queries`) |
| `--locations <strings>` | Comma-separated locations (mapped to each adapter's `locations`) |
| `--regions <tags>` | Filter adapters by `meta.regions` (`pakistan`, `gulf`, `worldwide-remote`, etc.) |
| `--companies <slugs>` | Comma-separated ATS slugs (mapped to each adapter's `companies`) |
| `--remote true\|false` | Toggles `remote_only` on adapters that support it |
| `--include-disabled` | Run adapters even if `enabled: false` in YAML (ad-hoc) |
| `--dry-run` | Skip persistence to `data/jobs.jsonl`, `pipeline.md`, `scan-history.tsv` |
| `--json` | Emit summary as JSON on stdout |
| `--quiet` | Silence per-adapter info logs |
| `--concurrency <n>` | Parallel adapter limit (default 5) |
| `--list-sources` | JSON dump of every adapter's metadata |
| `--list-options <id>` | JSON dump of one adapter's metadata |
| `--init-sources` | Append the default `sources:` block from the template into `portals.yml` |

CLI overrides win over YAML for the shared fields (`queries`, `locations`,
`companies`, `remote_only`); adapter-specific knobs (`categories`, `affiliate_id`,
…) stay sourced from YAML.

## What gets written

```
data/jobs.jsonl          # canonical, one normalized Job per line (Postgres-ready)
data/pipeline.md         # back-compat with existing CLI/web/dashboard
data/scan-history.tsv    # back-compat with original scan.mjs
```

The legacy `scan.mjs` and the existing web app keep working unchanged.

## Source catalogue (27 adapters)

| Kind | ID | Region(s) | Auth |
|---|---|---|---|
| API | remotive | worldwide-remote | none |
| API | remoteok | worldwide-remote (tech) | none |
| API | arbeitnow | europe + remote | none |
| API | jobicy | worldwide-remote | none |
| API | working-nomads | worldwide-remote | none |
| API | himalayas | worldwide-remote (~101k) | none |
| API | themuse | worldwide (incl. Gulf cities) | optional free key |
| API | hn-whoishiring | worldwide-remote | none |
| API | careerjet | **PK + entire Gulf** + worldwide | free affiliate ID |
| API | jooble | **PK + Gulf** + 70 countries | free key |
| API | adzuna | 12 countries (no PK/Gulf) | free app id+key |
| API | usajobs | USA public sector | free key |
| API | findwork | worldwide tech | free token |
| API | web3career | crypto/web3 | token "public" |
| API | jsearch | worldwide (Google for Jobs) | RapidAPI key (200/mo free) |
| RSS | weworkremotely | worldwide-remote | none |
| RSS | jobspresso | worldwide-remote | none |
| RSS | mustakbil | **Pakistan** | none |
| Sitemap | dubizzle | **UAE** (EN+AR) | none |
| Sitemap | qatarliving | **Qatar** (EN+AR) | none |
| Sitemap | rozee | **Pakistan** | none |
| ATS | greenhouse | per-company | none |
| ATS | ashby | per-company | none |
| ATS | lever | per-company | none |
| ATS | workable | per-company | none |
| ATS | smartrecruiters | per-company | none |
| ATS | recruitee | per-company | none |
| ATS | personio | per-company (EU) | none |
| ATS | teamtailor | per-company | none |
| JSON-LD | universal | any URL with schema.org/JobPosting | none |
| Scrape | linkedin-guest | worldwide (ToS-risk; off by default) | none |

## Config shape

`portals.yml` has a top-level `sources:` block. Every adapter has the same
top-level fields (`enabled`, plus its own optional fields):

```yaml
sources:
  remotive:
    enabled: true
    queries: ["python", "ai engineer"]   # free-text — pass any string
    categories: []                       # see --list-options remotive

  mustakbil:                              # Pakistan
    enabled: true
    categories: ["all"]                  # or ["IT","Engineering",...]

  dubizzle:                               # UAE
    enabled: true
    languages: ["en", "ar"]

  greenhouse:
    enabled: true
    companies: ["careem", "stripe"]      # any Greenhouse slug

  universal:                              # long-tail JSON-LD scraper
    enabled: true
    urls:
      - https://example.com/sitemap.xml
      - https://example.com/jobs.rss
    queries: ["senior"]
```

## Frontend integration

Each adapter exports a `meta` block with `presets` (known options) and `schema`
(field types). The orchestrator surfaces it via:

- `node scan-v2.mjs --list-sources` → JSON of every adapter's metadata
- `node scan-v2.mjs --list-options <id>` → one adapter's metadata

The frontend can render a chip-picker from `presets.*` AND a free-text input
that pushes arbitrary user values into the same array. The adapter accepts both
identically.

### HTTP API

The local `web-server.mjs` (port 5177, localhost-only) exposes the same
capability over HTTP so the future SaaS frontend can drive scans without
shelling out:

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/scanners` | List every adapter with `meta`, `enabledInConfig`, `requiresKeySatisfied`, missing env keys |
| `POST` | `/api/scan/run` | Start a scan. Body: `{ sources?: string[], query: { titles?, regions?, locations?, companies?, remote? }, dry_run?, concurrency?, include_disabled?, persist? }` → returns `{ job_id, state, progress }` |
| `GET`  | `/api/scan/status/:id` | Per-adapter progress, counts, errors, skipped reasons |
| `GET`  | `/api/scan/results/:id?limit=&offset=` | Paginated normalized `Job[]` for that scan |

Scans run in-process so progress events stream live. Finished jobs stay in
memory for 30 minutes (the durable record is `data/jobs.jsonl`).

Sample run:

```bash
JOB=$(curl -s -X POST localhost:5177/api/scan/run \
   -H 'content-type: application/json' \
   -d '{"sources":["remotive"],"query":{"titles":["AI Engineer"]},"dry_run":true,"include_disabled":true}' \
   | jq -r .job_id)
curl -s localhost:5177/api/scan/status/$JOB | jq '.progress, .counts'
curl -s "localhost:5177/api/scan/results/$JOB?limit=10" | jq '.items[].title'
```

## Production discipline (built into `_base.mjs`)

- Per-domain rate limit (default 1.5 s between requests to the same host)
- 15 s fetch timeout, exponential backoff on 5xx, honors `Retry-After` on 429
- Per-source circuit breaker (auto-disable for 5 min after 5 failures)
- robots.txt cache + check on sitemap/jsonld scrapers
- Deduplication on canonical URL + (company, role) tuple
- Adapter-level abort timeout (120 s) so one slow source can't block the run

## Adding a new source

Drop a file under `scanners/{api,rss,sitemap,ats,jsonld,scrape}/<name>.mjs`
that exports:

```js
export const meta = { id, kind, regions, supports, presets, schema, docs };
export default async function fetch(config, ctx) { /* return Job[] */ }
```

The registry auto-discovers it; add a config block with `enabled: true` to
`portals.yml`.

## Phase-3 ToS-risk sources

`scrape/linkedin-guest.mjs` is included for completeness but ships **disabled**.
To enable it the operator must explicitly set
`linkedin-guest.acknowledge_tos_risk: true` — even then, use proxies and a low
crawl rate. We do not include Indeed / Bayt / Akhtaboot direct scrapers because
their robots.txt or ToS explicitly disallow automation.
