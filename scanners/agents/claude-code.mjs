// scanners/agents/claude-code.mjs
//
// Claude provider — original Career-Ops flow. Shells out to `claude -p` (the
// non-interactive Claude Code mode) and pipes the system+user prompt on
// stdin. We do NOT replace this with the Anthropic SDK at this stage —
// keeping the original CLI as the canonical Claude path means existing users
// don't pay for tokens they're already getting via Claude Code.
//
// Future: an `anthropic-api` provider can layer on top of the SDK once the
// SaaS migration begins (see Phase N in the plan).

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import { ProviderError } from './_base.mjs';

const execP = promisify(exec);
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const CLAUDE_BIN = process.env.CLAUDE_CODE_BIN || 'claude';

let _availabilityCache = null;

export const claudeCode = {
  id: 'claude-code',
  label: 'Claude (via Claude Code)',
  family: 'claude',
  defaultModel: DEFAULT_MODEL,
  costsMoney: false,

  async available() {
    if (_availabilityCache) return _availabilityCache;
    try {
      // `claude --version` exits 0 quickly when the binary is on PATH.
      await execP(`${quote(CLAUDE_BIN)} --version`, { timeout: 5_000, windowsHide: true });
      _availabilityCache = { available: true };
    } catch (err) {
      const msg = String(err?.message || err);
      _availabilityCache = {
        available: false,
        reason: 'claude binary not on PATH',
        hint: 'Install Claude Code from https://docs.claude.com/claude-code, or set CLAUDE_CODE_BIN to the full path',
      };
      // Gentle log so users notice the first time the dashboard loads.
      if (process.env.DEBUG_AGENTS) process.stderr.write(`claude-code unavailable: ${msg}\n`);
    }
    return _availabilityCache;
  },

  async run({ system, user, onToken, signal, model }) {
    const avail = await claudeCode.available();
    if (!avail.available) throw new ProviderError('claude-code', avail.reason || 'unavailable', { hint: avail.hint });

    const modelName = model || DEFAULT_MODEL;
    // Compose the prompt — `claude -p` accepts the prompt as a positional
    // argument when streaming via stdin is awkward. We pipe through stdin so
    // very long prompts (CV + JD + mode = often > 100 KB) don't hit Windows
    // command-line length limits.
    const prompt = `${system}\n\n${user}`;

    const args = ['-p', '-', '--model', modelName, '--output-format', 'text'];

    const t0 = Date.now();
    let combined = '';
    const child = spawn(CLAUDE_BIN, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Forward signal to the child so the UI can abort an in-flight evaluation.
    if (signal) {
      const onAbort = () => child.kill('SIGTERM');
      signal.addEventListener('abort', onAbort, { once: true });
    }

    let i = 0;
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      combined += text;
      onToken?.({ chunk: text, tokenIndex: i++ });
    });

    let stderr = '';
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    // Write prompt + close stdin.
    child.stdin.write(prompt, 'utf-8');
    child.stdin.end();

    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? 1));
    });

    if (signal?.aborted) {
      throw new ProviderError('claude-code', 'aborted', { retriable: true });
    }
    if (exitCode !== 0) {
      // Surface the most helpful slice of stderr — often "not authenticated"
      // or "model not available".
      const detail = stderr.trim().slice(-400) || `claude exited ${exitCode}`;
      const hint = /auth/i.test(detail) ? 'Run `claude login` to authenticate' : undefined;
      throw new ProviderError('claude-code', detail, { hint });
    }

    return {
      text: combined,
      model: modelName,
      family: 'claude',
      durationMs: Date.now() - t0,
    };
  },
};

function quote(s) {
  // Minimal PATH-safe quoting for the version probe. Spaces in CLAUDE_CODE_BIN
  // are common when users install via Anthropic's installer on macOS/Windows.
  return /\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

export default claudeCode;
