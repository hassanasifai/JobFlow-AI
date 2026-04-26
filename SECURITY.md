# Security Policy

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Instead, please email **hi@santifer.io** with:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You will receive a response within 72 hours. We will work with you to understand and address the issue before any public disclosure.

## Scope

Security issues in the following are in scope:

- **Scripts** (`*.mjs`) — command injection, path traversal, SSRF
- **Dashboard** (`dashboard/`) — any Go binary vulnerabilities
- **Templates** (`templates/`) — XSS in generated HTML/PDF
- **Configuration** — secrets exposure, unsafe defaults

## Out of Scope

- Issues in third-party dependencies (report upstream)
- Issues requiring physical access to the user's machine
- Social engineering attacks
- career-ops is a local tool — there is no hosted service to attack

## Dependency Vulnerabilities

Dependencies are tracked by Dependabot (npm root, npm dashboard-web, gomod dashboard, github-actions). Critical CVEs in transitive deps trigger an immediate patch release; subscribe to GitHub Releases to get notified. The GitHub Actions workflow `dependency-review.yml` blocks PRs that introduce high-severity vulnerabilities.

## Hardening Defaults

- Localhost-only HTTP server bind (`127.0.0.1:5177`)
- Strict Content-Security-Policy + X-Frame-Options DENY on every response
- Atomic file writes (temp + rename) for tracker mutations
- SSRF guard on every outbound `fetch` (rejects private IPs, cloud metadata)
- Prototype-pollution guard on every JSON parse of untrusted input
- Wallclock timeouts on all streaming endpoints
- Provider HTML sanitized via DOMPurify before rendering in the dashboard

## Disclosure Policy

We follow coordinated disclosure. Once a fix is released, we will credit the reporter (unless they prefer anonymity) in the release notes.
