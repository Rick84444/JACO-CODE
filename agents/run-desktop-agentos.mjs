#!/usr/bin/env node
import { main } from './desktop-agentos.mjs';

main().catch(error => {
  console.error(`[AGENTOS] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
