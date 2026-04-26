# Career-Ops Dashboard

Single-user Next.js dashboard for the career-ops scanner.

## Stack

- **Next.js 16** (App Router, React Server Components)
- **TypeScript** + **Tailwind CSS**
- **shadcn/ui** (Radix primitives) — Button, Card, Dialog, Tabs, Sheet, Popover, etc.
- **TanStack Query** — server state, infinite queries, optimistic updates
- **TanStack Virtual** — virtualized infinite scroll (handles 10k+ jobs)
- **Sonner** — toast notifications
- **next-themes** — light/dark mode
- **React Hook Form** + **Zod** — saved-search dialog
- **Lucide** — icons

## Screens

| Path | Component | What it does |
|---|---|---|
| `/` | `JobsList` | Virtualized infinite-scroll list of jobs from `/api/jobs`, with region/source/q/since/remote filters |
| `/sources` | `SourcesPage` | Per-provider health grid (status, totals, last_seen, missing env keys) — auto-refreshes every 30 s |
| `/saved` | `SavedSearchesPage` | List + Create / Edit / Delete saved filters; "Run" loads them straight into the Scan Now dialog |
| Modal | `ScanNowDialog` | Pick providers + free-text query, kicks off `POST /api/scan/run`, polls progress every 1.5 s |

## Run

```bash
# from the project root, in two terminals:
node web-server.mjs                        # Terminal 1 — backend on 5177
cd dashboard-web && npm run dev            # Terminal 2 — UI on 3000

# or from project root:
npm run dashboard:dev
```

Dev mode proxies `/api/*` from `:3000` → `:5177` via `next.config.ts`. Override
the upstream with `CAREER_OPS_API_BASE=http://other-host:1234`.

## Build

```bash
npm run dashboard:build && npm run dashboard:start
```

## Architecture notes

- **No state for pre-existing job data** — every list / detail / status is fetched on demand from the backend. TanStack Query caches and invalidates per query key.
- **Filters live in local state** today; URL-state sync is a Phase I follow-up.
- **Scan progress** is implemented via 1.5 s polling. SSE/WebSockets would be a nicer upgrade once the backend has a worker queue.
- **No auth** — the dashboard inherits the backend's "localhost-only" stance. Multi-tenant SaaS UI is a separate phase.
