#!/usr/bin/env node

/**
 * scan.mjs — zero-token global job discovery
 *
 * Backward-compatible entrypoint for /career-ops scan. It preserves the
 * existing data/pipeline.md and data/scan-history.tsv flow while delegating to
 * the provider-based scanner under scanners/.
 */

import { parseScanArgs, printScanSummary, runGlobalScan } from './scanners/_global_scan.mjs';

async function main() {
  const argv = parseScanArgs(process.argv.slice(2));
  const result = await runGlobalScan({ argv });
  printScanSummary(result);
  process.stderr.write('\n→ Run /career-ops pipeline to evaluate new offers.\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
