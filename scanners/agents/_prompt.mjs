// scanners/agents/_prompt.mjs
//
// Pure helpers extracted from gemini-eval.mjs so every provider composes the
// same prompt and parses the same `---SCORE_SUMMARY---` block. No I/O happens
// here apart from reading mode/cv files (synchronously, since they're small);
// no network calls; no fs writes.

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ── Path resolution ────────────────────────────────────────────────────

/**
 * Resolve a mode name (e.g. "oferta") against a project root and an optional
 * language directory. Returns the absolute path and the file's text. Falls
 * back from `modes/{lang}/{mode}.md` → `modes/{mode}.md` so multi-language is
 * additive.
 */
export function resolveModeFile(root, mode, language = '') {
  const candidates = [];
  if (language && language !== 'en') candidates.push(join(root, 'modes', language, `${mode}.md`));
  candidates.push(join(root, 'modes', `${mode}.md`));
  for (const p of candidates) if (existsSync(p)) return { path: p, text: readFileSync(p, 'utf-8') };
  throw new Error(`Mode "${mode}" not found. Tried: ${candidates.join(', ')}`);
}

/**
 * Read CV + shared context + (optional) article-digest. Tolerant of missing
 * files — a fresh workspace can still run an evaluation; the agent will just
 * be told the section is missing.
 */
export function readContextBundle(root, { language = '' } = {}) {
  const optional = (path, label) =>
    existsSync(path) ? readFileSync(path, 'utf-8') : `[${label} not found — proceed without it]`;
  return {
    shared: optional(join(root, 'modes', '_shared.md'), 'modes/_shared.md'),
    profile: optional(join(root, 'modes', '_profile.md'), 'modes/_profile.md'),
    cv: optional(join(root, 'cv.md'), 'cv.md'),
    digest: optional(join(root, 'article-digest.md'), 'article-digest.md'),
    profileYml: optional(join(root, 'config', 'profile.yml'), 'config/profile.yml'),
    language,
  };
}

// ── System-prompt composer ────────────────────────────────────────────

/**
 * Build the system prompt that gets sent to every provider. This is the same
 * structure gemini-eval.mjs uses, generalized to accept any mode. The mode
 * file is the only piece that varies between operations (oferta / apply /
 * deep / contacto / pdf / etc.).
 */
export function composeSystemPrompt({ shared, profile, modeText, modeName, cv, digest }) {
  return [
    `You are career-ops, an AI-powered job search assistant.`,
    `You operate in mode "${modeName}". Follow its instructions exactly.`,
    ``,
    `═══════════════════════════════════════════════════════`,
    `SYSTEM CONTEXT (modes/_shared.md)`,
    `═══════════════════════════════════════════════════════`,
    shared,
    ``,
    `═══════════════════════════════════════════════════════`,
    `USER PROFILE (modes/_profile.md)`,
    `═══════════════════════════════════════════════════════`,
    profile,
    ``,
    `═══════════════════════════════════════════════════════`,
    `MODE INSTRUCTIONS (${modeName}.md)`,
    `═══════════════════════════════════════════════════════`,
    modeText,
    ``,
    `═══════════════════════════════════════════════════════`,
    `CANDIDATE RESUME (cv.md)`,
    `═══════════════════════════════════════════════════════`,
    cv,
    ``,
    `═══════════════════════════════════════════════════════`,
    `PROOF POINTS (article-digest.md)`,
    `═══════════════════════════════════════════════════════`,
    digest,
    ``,
    `═══════════════════════════════════════════════════════`,
    `OPERATING RULES FOR THIS REQUEST`,
    `═══════════════════════════════════════════════════════`,
    `1. You do NOT have access to WebSearch, Playwright, or file-writing tools in this session.`,
    `2. Where the mode references those tools, work from training data and clearly note any uncertainty.`,
    `3. The host process saves output to disk — you do NOT need to write files.`,
    `4. Respond in the language of the JD when it isn't English; otherwise English.`,
    `5. If the mode requires a SCORE_SUMMARY block, output it verbatim at the very end:`,
    ``,
    `   ---SCORE_SUMMARY---`,
    `   COMPANY: <company>`,
    `   ROLE: <role>`,
    `   SCORE: <decimal 1.0–5.0>`,
    `   ARCHETYPE: <archetype>`,
    `   LEGITIMACY: <High Confidence | Proceed with Caution | Suspicious>`,
    `   ---END_SUMMARY---`,
  ].join('\n');
}

/**
 * Build the user-facing message for evaluation modes (oferta, ofertas, deep, …)
 * — JD text plus optional URL. For modes like apply/contacto/pdf the caller
 * builds its own user message because the inputs differ.
 */
export function composeJdMessage({ jdText, jdUrl, extraContext }) {
  const parts = [];
  if (jdUrl) parts.push(`JOB POSTING URL: ${jdUrl}`);
  parts.push(`JOB DESCRIPTION:\n\n${jdText}`);
  if (extraContext) parts.push(`\n\nADDITIONAL CONTEXT:\n${extraContext}`);
  return parts.join('\n\n');
}

// ── Score-summary parser ───────────────────────────────────────────────

/**
 * Parse the `---SCORE_SUMMARY---` block from a model response. Tolerant of
 * missing fields and trailing whitespace. Returns null when no block is
 * found, which the caller treats as a soft warning, not an error.
 */
export function parseScoreSummary(text) {
  if (!text) return null;
  const m = text.match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/i);
  if (!m) return null;
  const block = m[1];
  const grab = (key) => {
    const r = block.match(new RegExp(`${key}\\s*:\\s*([^\\n\\r]+)`, 'i'));
    return r ? r[1].trim() : null;
  };
  const scoreRaw = grab('SCORE');
  const scoreNum = scoreRaw ? Number(String(scoreRaw).match(/\d+(?:\.\d+)?/)?.[0]) : NaN;
  return {
    company: grab('COMPANY') || 'Unknown',
    role: grab('ROLE') || 'Unknown',
    score: Number.isFinite(scoreNum) ? scoreNum : null,
    scoreRaw,
    archetype: grab('ARCHETYPE'),
    legitimacy: grab('LEGITIMACY'),
  };
}

/**
 * Strip the SCORE_SUMMARY block out of a response so the saved report doesn't
 * carry the machine-readable footer. (We persist the parsed values into the
 * report header instead.)
 */
export function stripScoreSummary(text) {
  return String(text || '').replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/i, '').trim();
}

// ── Report file naming + saving ────────────────────────────────────────

/**
 * Find the next 3-digit-padded report number by scanning reports/ directory.
 * Pure function over fs reads — caller passes the absolute reports dir.
 */
export function nextReportNumber(reportsDir) {
  if (!existsSync(reportsDir)) return '001';
  const used = readdirSync(reportsDir)
    .filter((f) => /^\d{3}-/.test(f))
    .map((f) => parseInt(f.slice(0, 3), 10))
    .filter((n) => !Number.isNaN(n));
  if (used.length === 0) return '001';
  return String(Math.max(...used) + 1).padStart(3, '0');
}

/**
 * Slugify a company name for filename use. Mirrors the existing convention
 * in gemini-eval.mjs:288 to keep file naming consistent across providers.
 */
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Persist an evaluation report to reports/{NNN}-{slug}-{date}.md with the
 * canonical header (Score / Legitimacy / Archetype / Tool / Model / PDF). The
 * caller passes the parsed summary fields and the stripped body. Returns the
 * relative path so the API can hand it back to the UI.
 */
export function saveReport({
  reportsDir,
  rootDir,
  body,
  summary,
  toolLabel,
  modelLabel,
}) {
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const num = nextReportNumber(reportsDir);
  const company = summary?.company || 'unknown';
  const slug = slugify(company);
  const filename = `${num}-${slug}-${date}.md`;
  const fullPath = join(reportsDir, filename);

  const header = [
    `# Evaluation: ${company} — ${summary?.role || 'Unknown role'}`,
    ``,
    `**Date:** ${date}`,
    summary?.archetype ? `**Archetype:** ${summary.archetype}` : null,
    summary?.scoreRaw ? `**Score:** ${summary.scoreRaw}` : null,
    summary?.legitimacy ? `**Legitimacy:** ${summary.legitimacy}` : null,
    `**PDF:** pending`,
    `**Tool:** ${toolLabel}`,
    `**Model:** ${modelLabel}`,
    ``,
    `---`,
    ``,
  ].filter(Boolean).join('\n');

  writeFileSync(fullPath, header + body + '\n', 'utf-8');
  // The path is stored relative to project root for portability.
  const relative = rootDir ? fullPath.slice(rootDir.length + 1).replace(/\\/g, '/') : filename;
  return { path: relative, number: num, company, slug, filename };
}
