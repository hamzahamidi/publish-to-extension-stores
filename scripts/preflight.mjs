import { runPreflight } from './lib/preflight.mjs';

process.exitCode = runPreflight(process.env, console.log);
