import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatProblem, pinProblem, readPins } from './pins.ts';

const root = resolve(import.meta.dirname, '..');
const pins = readPins(readFileSync(join(root, 'action.yml'), 'utf8'));
let failures = pins.length === 0 ? 1 : 0;
if (pins.length === 0) console.log('::error file=action.yml::action.yml has no uses: line to check.');

for (const pin of pins) {
  let problem = formatProblem(pin);
  if (!problem) {
    const tag = `refs/tags/${pin.version}`;
    const lsRemote = execFileSync('git', ['ls-remote', `https://github.com/${pin.repository}.git`, tag, `${tag}^{}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    problem = pinProblem(pin, lsRemote);
  }
  if (problem) {
    failures++;
    console.log(`::error file=action.yml,line=${pin.line}::${problem}`);
  } else {
    console.log(`${pin.action}@${pin.ref} is ${pin.version}.`);
  }
}
process.exitCode = failures > 0 ? 1 : 0;
