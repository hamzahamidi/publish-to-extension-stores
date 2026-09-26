import { runReport } from './lib/report.mjs';

process.exitCode = runReport(process.env, console.log);
