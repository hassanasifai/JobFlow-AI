# Free Job Sources

Career-Ops now uses the zero-token scanner in `scan.mjs` for global job discovery.
It keeps the existing pipeline flow intact: accepted jobs are appended to
`data/pipeline.md`, `data/scan-history.tsv`, and `data/jobs.jsonl`.

## Zero-Cost, No-Key Providers

These are enabled first and do not require paid APIs or scraping services:

- Greenhouse public job board API
- Lever public postings API
- Ashby public posting API
- Workable public account/widget endpoints
- Recruitee public careers API
- SmartRecruiters public company postings API
- RemoteOK public JSON feed
- Remotive public remote jobs API
- Arbeitnow public job-board API
- Personio public XML feed

RemoteOK and Remotive require attribution/link-back. Career-Ops preserves the
source provider and original job URL in every normalized job.

## Optional Free-With-Key Providers

These stay disabled by default and only run when explicitly enabled and the
environment variables exist:

- Adzuna: `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`
- USAJobs: `USAJOBS_USER_EMAIL`, `USAJOBS_API_KEY`

Use `--no-optional` to disable them even when keys are present.

## Running Scans

```bash
node scan.mjs --dry-run
node scan.mjs --dry-run --all-free --region pakistan,gcc,remote,ireland,poland,usa,uk
node scan.mjs --dry-run --provider remoteok --region remote
node scan.mjs --dry-run --provider remotive --region remote
node scan.mjs --dry-run --provider arbeitnow --region europe,remote
node scan.mjs --dry-run --region pakistan
node scan.mjs --dry-run --region gcc
node scan.mjs --dry-run --limit 100 --since-days 7
```

`--dry-run` prints results and does not write files. `--limit` applies after
normalization, filtering, and dedupe. `--since-days` only filters jobs when the
provider supplies a valid posting date.

## Regions

Supported region filters include:

- `pakistan`
- `gcc`, `gulf`, `uae`, `saudi_arabia`, `qatar`, `oman`, `kuwait`, `bahrain`
- `ireland`
- `poland`
- `usa`
- `uk`
- `europe`, `emea`
- `remote`, `worldwide`, `remote_worldwide`, `remote_region`

The scanner normalizes cities such as Lahore, Karachi, Islamabad, Dubai, Abu
Dhabi, Riyadh, Doha, Dublin, Warsaw, Krakow, London, and Manchester into the
same region groups.

## Adding Tracked Companies

Add ATS identifiers under `tracked_companies` in `portals.yml`:

```yaml
tracked_companies:
  - name: Example Company
    enabled: true
    ats:
      provider: greenhouse
      board_token: example

  - name: Example Lever Company
    enabled: true
    ats:
      provider: lever
      account: example

  - name: Example Ashby Company
    enabled: true
    ats:
      provider: ashby
      board: Example

  - name: Example Workable Company
    enabled: true
    ats:
      provider: workable
      subdomain: example

  - name: Example Recruitee Company
    enabled: true
    ats:
      provider: recruitee
      company_id: example

  - name: Example SmartRecruiters Company
    enabled: true
    ats:
      provider: smartrecruiters
      company_identifier: example

  - name: Example Personio Company
    enabled: true
    ats:
      provider: personio
      company_slug: example
```

Legacy `careers_url` and Greenhouse `api` fields are still detected for backward
compatibility.

## Cache and Rate Limits

Provider responses are cached under `data/cache/job-sources/`.

- RemoteOK, Remotive, Arbeitnow: 6 hours
- ATS company endpoints: 1 hour
- Workable: 6 hours
- Personio: 2 hours

Use `--no-cache` to bypass cache. One failed provider is logged and skipped; it
does not stop the scan.

## Known Limitations

The first release intentionally avoids LinkedIn, Indeed, Glassdoor, Bayt,
NaukriGulf, Rozee, Monster, and similar sites as default sources because they
often block automation, require browser sessions, or have rate/terms concerns.
Public JSON/XML ATS feeds and free remote-job APIs are the production default.
