# Job Ingestion Research — Free Sources Worldwide

**Date:** 2026-04-25
**Scope:** Identify FREE (no-paid-API) job-data sources covering (a) worldwide remote, (b) Pakistan, (c) Gulf (UAE, KSA, Qatar, Oman, Bahrain, Kuwait). All endpoints below were live-tested on the date above unless otherwise noted.

---

## TL;DR — What we will build first

**Tier-1 (no auth, ship now):**

| Adapter | Region | Mechanism | Approx daily volume |
|---|---|---|---|
| Remotive | Worldwide remote | Public JSON | ~2k active |
| RemoteOK | Worldwide remote (tech) | Public JSON | ~100 latest |
| Arbeitnow | EU + remote | Public JSON, paginated | ~1k+ |
| Jobicy | Worldwide remote | Public JSON v2 | ~500+ |
| Working Nomads | Worldwide remote | Public JSON | ~700 |
| Himalayas | Worldwide remote | Public JSON, paginated | **~101,000** (largest single source) |
| WeWorkRemotely | Worldwide remote | 10 RSS feeds by category | curated |
| The Muse | Worldwide (incl. Dubai/Riyadh/Doha) | Public JSON, free key 3.6k req/h | mid-market global |
| HN "Who is Hiring" | Worldwide remote | Algolia Search API | monthly thread |
| Greenhouse / Ashby / Lever (already in scan.mjs) | Worldwide direct ATS | Public JSON | per-company |
| **Mustakbil** | Pakistan | RSS 2.0 with company/city/category | ~100/feed |
| **Dubizzle Jobs** | UAE | sitemap.xml → JSON-LD per page (AR + EN) | high |
| **QatarLiving** | Qatar | sitemap-jobs.xml → JSON-LD (AR + EN, AI bots welcomed) | high |
| **Careem (Greenhouse)** | Gulf direct ATS | `boards-api.greenhouse.io/v1/boards/careem/jobs` | 53 confirmed |

**Tier-2 (free but need signup or key):**
- CareerJet API (Pakistan + worldwide, requires affiliate ID)
- Jooble API (Pakistan + Gulf, free key by request form)
- Adzuna (no Pakistan/Gulf country codes — worldwide remote only)
- USAJobs (US public sector)
- Findwork.dev (token required)
- Web3.career (`?token=public` works)
- JSearch on RapidAPI (200 req/month free — testing only)

**Tier-3 (legal/technical risk, use proxies + JobSpy library):**
- Indeed PK / Indeed Gulf (Cloudflare + ToS issues)
- LinkedIn jobs-guest endpoint (works without auth, but ToS prohibits automation)

**Hard SKIP:**
- Bayt.com (`robots.txt` disallows /jobs/, Cloudflare-protected)
- Akhtaboot (robots explicitly bans Claude/GPT/CC bots)
- Jadarat.sa (auth wall)
- BrightSpyre.com (`Disallow: /` for all SEO bots)
- GitHub Jobs (sunset 2021), Stack Overflow Jobs (closed 2022)
- Adzuna for Gulf/Pakistan (not in their 12 supported countries)
- Google Jobs direct (no free path)

---

## 1. Worldwide Remote (Tier-1, all live-tested)

| Source | Endpoint | Auth | Notes |
|---|---|---|---|
| Remotive | `https://remotive.com/api/remote-jobs?limit=&category=&search=` | none | 13 fields incl salary, tags, description, apply URL |
| RemoteOK | `https://remoteok.com/api` | UA header | salary_min/max, tags, ~99 jobs in single dump |
| Arbeitnow | `https://www.arbeitnow.com/api/job-board-api` | none | Paginated, EU-strong |
| Jobicy | `https://jobicy.com/api/v2/remote-jobs?count=50&geo=&industry=` | none | salary range with currency, geo filter |
| Working Nomads | `https://www.workingnomads.com/api/exposed_jobs/` | UA header | tags, location |
| Himalayas | `https://himalayas.app/jobs/api?offset=0&limit=20` | none | totalCount=101,140; salary, seniority, timezone, expiryDate |
| The Muse | `https://www.themuse.com/api/public/jobs?page=1&category=&location=Flexible%2FRemote` | optional key (free) | 500/h unauth, 3,600/h with key |
| HN "Who is Hiring" | `https://hn.algolia.com/api/v1/search?tags=comment,story_<MONTHLY_ID>&query=remote&hitsPerPage=100` | none | 10,000 req/h per IP |
| WeWorkRemotely | `weworkremotely.com/categories/{slug}.rss` for: `remote-programming-jobs`, `remote-back-end-programming-jobs`, `remote-full-stack-programming-jobs`, `remote-devops-sysadmin-jobs`, `remote-sales-and-marketing-jobs`, `remote-management-and-finance-jobs`, `remote-product-jobs`, `remote-customer-support-jobs`, `remote-design-jobs`, `all-other-remote-jobs` | none | RSS 2.0 |
| Jobspresso | `https://jobspresso.co/feed/` | none | WP RSS |

**Direct ATS (already partly supported in scan.mjs — extend to more providers):**
- Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` — confirmed working for Airbnb (231 jobs), Careem (53 jobs)
- Ashby: `https://api.ashbyhq.com/posting-api/job-board/{id}?includeCompensation=true`
- Lever: `https://api.lever.co/v0/postings/{company}?mode=json`
- Workable (v1 widget by slug): `https://apply.workable.com/api/v1/widget/accounts/{slug}`
- SmartRecruiters: `https://api.smartrecruiters.com/v1/companies/{name}/postings`
- Recruitee: `https://{company}.recruitee.com/api/offers/`
- Personio: `https://{company}.jobs.personio.de/xml`
- Teamtailor: per-company `*.teamtailor.com/jobs.json`

---

## 2. Pakistan

| Source | Path | Verdict |
|---|---|---|
| **Mustakbil.com** | `https://rss.mustakbil.com/jobs-rss?c={category}` (master at `/jobs-rss`) | **TIER-1 GOOD** — RSS 2.0, structured fields (title, company, city, country, content:encoded, referencenumber) |
| **CareerJet PK** | `search.api.careerjet.net/v4/query` with `locale_code=en_PK` | TIER-2 — official free API, requires affiliate ID, returns title/company/description/salary/location/URL |
| **Jooble PK** | POST `https://jooble.org/api/{key}` (key by free request) | TIER-2 — `pk.jooble.org` aggregates ~14k+ Pakistani vacancies |
| **Rozee.pk** | `https://www.rozee.pk/sitemap_index.xml` → `jobs.xml` | TIER-2 OK — sitemap is the gold path; detail pages may 302 to `rozeegpt.ai` (AI co-pilot wrapper); plan for redirect handling |
| **PakistanJobsBank.com** | HTML crawl | TIER-2 OK — permissive robots, no sitemap, throttle to 1 req/2s |
| **Jobz.pk** | `/feed/` (WP) | TIER-2 OK — needs realistic UA, 2s crawl-delay |
| **PSCs (FPSC, PPSC, KPPSC, BPSC, NTS, AJKPSC, SPSC)** | HTML crawl per-domain | TIER-2 — public bodies; some use ASP.NET postback paging (PPSC); SPSC has invalid TLS cert; all SSR |
| Indeed PK (`pk.indeed.com`) | Publisher API deprecated 2023 | TIER-3 — use JobSpy library + proxies, accept ToS risk |
| LinkedIn Jobs PK | `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?location=Pakistan` | TIER-3 — guest endpoint works, ToS prohibits automation |
| BrightSpyre | — | **AVOID** — robots.txt `Disallow: /` for all SEO bots |
| openings.com.pk | — | **AVOID** — defunct, merged into Rozee |
| DAWN.com / JANG classifieds | image-based | **AVOID** — image scans not parseable |
| Adzuna PK | — | **BLOCKED** — Pakistan not in Adzuna's 12 supported countries |

---

## 3. Gulf (UAE, KSA, Qatar, Oman, Bahrain, Kuwait)

| Source | Path | Verdict |
|---|---|---|
| **Dubizzle Jobs (UAE)** | `https://dubai.dubizzle.com/sitemaps/sitemap.xml` → `jobs-dpv-en-1.xml`, `jobs-dpv-ar-1.xml` (separate AR + EN streams) | **TIER-1 GOOD** — clean sitemap-driven crawl, JSON-LD on detail pages |
| **QatarLiving (Qatar)** | `https://www.qatarliving.com/sitemap.xml` → `sitemap-jobs.xml`, `sitemap-companies.xml` (under `/en/jobs/sitemap/`, AR equivalents available) | **TIER-1 GOOD** — robots explicitly **allows** ClaudeBot/GPTBot/PerplexityBot |
| **Careem (Greenhouse)** | `https://boards-api.greenhouse.io/v1/boards/careem/jobs` | **TIER-1 GOOD** — 53 jobs confirmed |
| The Muse (Dubai/Riyadh/Doha) | `themuse.com/api/public/jobs?location=Dubai%2C+United+Arab+Emirates` | TIER-1 — covers global tech employers in Gulf |
| Probe these Greenhouse slugs for Gulf coverage (untested) | `tabby`, `kitopi`, `swvl`, `delivery-hero`, `chalhoub`, `mamopay`, `cobone` | check `boards-api.greenhouse.io/v1/boards/{slug}/jobs` returning 200 with non-empty `meta.total` |
| GulfTalent | sitemap 403 to anon, needs proxy/headless | TIER-2 OK |
| Naukrigulf | timeouts on direct fetch (WAF) | TIER-2 OK with proxy |
| MonsterGulf (founditgulf.com) | `/info/sitemap` HTML, JSON-LD on detail | TIER-2 OK |
| Tanqeeb | empty robots, mostly aggregator duplicates | TIER-2 low-value |
| Jooble Gulf (`ae.jooble.org`) | same Jooble API key | TIER-2 |
| JSearch Gulf | RapidAPI, country=ae/sa/qa/kw | TIER-2 — only 200 req/mo free |
| Bayt.com | robots **Disallows** `/{en,ar,fr}/jobs/?` + Cloudflare | **AVOID** |
| Akhtaboot | robots explicitly bans ClaudeBot/GPTBot/CCBot/anthropic-ai | **AVOID** |
| Indeed Gulf (ae/sa/qa) | robots disallow non-search-engine UAs + Cloudflare/DataDome | **AVOID** (use TIER-3 JobSpy if accepting ToS risk) |
| Jadarat.sa, HRSD, Mihnati | auth wall / unstable infra | **BLOCKED** |
| Jobzella, DubaiCareers.ae, TasjeelUAE/Tawteen | TLS reset / auth walls | **BLOCKED** |
| Adzuna Gulf | not in supported countries | **BLOCKED** |

---

## 4. Universal JSON-LD JobPosting fallback scraper

Almost every Google-for-Jobs-eligible board injects `<script type="application/ld+json">` blocks that follow [schema.org/JobPosting](https://schema.org/JobPosting). One scraper covers hundreds of long-tail boards.

**Algorithm:**
1. Discover URLs via per-source sitemap.xml or RSS.
2. Fetch HTML, parse all `<script type="application/ld+json">` blocks. Some pages wrap inside `@graph`.
3. Filter `@type === "JobPosting"`. Map: `title`, `description`, `datePosted`, `validThrough`, `employmentType`, `hiringOrganization.{name,logo}`, `jobLocation`, `jobLocationType: "TELECOMMUTE"`, `applicantLocationRequirements`, `baseSalary.value.{minValue,maxValue,unitText,currency}`, `directApply`, `url`.
4. Remote signal = `jobLocationType === "TELECOMMUTE"` OR `applicantLocationRequirements` present OR title/description regex `/\b(remote|work[- ]from[- ]home|distributed|anywhere)\b/i`.
5. Dedup by `(hiringOrganization.name, title, datePosted)` plus URL canonicalization.

Confirmed JSON-LD-emitting sources: WeWorkRemotely, Himalayas, Jobicy, Arbeitnow, RemoteOK, Greenhouse-hosted, Ashby-hosted, Lever-hosted, Workable-hosted, Personio, Teamtailor, SmartRecruiters, The Muse, Dubizzle Jobs, QatarLiving.

---

## 5. Community OSS to lift / depend on

- **`speedyapply/JobSpy`** — Python; scrapes LinkedIn, Indeed, Glassdoor, Google, ZipRecruiter, Bayt, Naukri, BDJobs. Pakistan via `country_indeed='pakistan'`. Ships with proxy support.
- **`remoteintech/remote-jobs`** — ~500 remote-friendly companies with careers URLs (Greenhouse/Lever/Ashby tokens visible). Use as seed list.
- **`lukasz-madon/awesome-remote-job`** — curated index of every remote board.
- **`arbeitnow/job-board-api`** — open Laravel-based board you can crib selectors from.
- **`nomansiddiqui0000/rozee.pk-jobs-scrapper`** — reference Rozee.pk Puppeteer scraper.
- **`tareq7755/scrapy-sphinx`** — Bayt Scrapy demo (only useful if you decide to engage Bayt despite robots.txt).

---

## 6. Localization needs (record for later, don't block ingestion on these)

- Detect Arabic JD by Unicode block; route through `modes/ar/` prompts.
- Currency parsing: AED, SAR, QAR, OMR, BHD, KWD, PKR — normalize to USD/EUR for scoring.
- Gulf context: Saudization (Nitaqat tiers), Emiratisation quotas, iqama transfer rules, Friday/Saturday weekend (KSA: Fri/Sat; UAE: Sat/Sun since 2022).
- Pakistan context: PEC certifications, NTN/CNIC handling for govt jobs, EOBI, Punjab/Sindh/KPK provincial labor laws.

---

## 7. Per-domain crawler discipline

- Send realistic UA + `From:` email header.
- Per-domain throttle: 1 req / 2s (override per source).
- Honor `Crawl-delay` if present.
- Cache `Last-Modified` / `ETag` from sitemaps; skip unchanged.
- Retry 5xx with exponential backoff (max 3); 429 → cool-down ≥60s.
- Always respect robots.txt; disable a source automatically if its robots.txt newly disallows our UA.
- For Tier-3 sources (LinkedIn, Indeed): residential IP rotation, ~1 req/2s, accept that ToS risk is on the operator.

---

## 8. Phase-1 ingestion stack (week 1 build)

1. Pull JSON APIs hourly: Remotive, RemoteOK, Arbeitnow, Jobicy, Working Nomads, Himalayas, The Muse, HN Algolia (current month thread).
2. Pull RSS hourly: 10 WeWorkRemotely categories, Jobspresso, **Mustakbil PK**.
3. Pull sitemaps hourly: **Dubizzle Jobs**, **QatarLiving**, Rozee.pk.
4. Direct ATS (extend existing scan.mjs): Greenhouse, Ashby, Lever, Workable, SmartRecruiters, Recruitee, Personio, Teamtailor — seed company list from `remoteintech/remote-jobs` + Gulf probes (`careem`, `tabby`, `kitopi`, `swvl`, `delivery-hero`, `chalhoub`).
5. Universal JSON-LD scraper as fallback for any URL not matching a known ATS.

Phase-2 (after free key signups): CareerJet PK, Jooble PK+Gulf, Adzuna (worldwide remote only), USAJobs, Findwork, Web3.career.
Phase-3 (with proxies + ToS-risk acceptance): Indeed PK/Gulf via JobSpy, LinkedIn jobs-guest.
