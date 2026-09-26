import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { STORES, storePins } from './pins.ts';

const root = resolve(import.meta.dirname, '..');
const pins = storePins(readFileSync(join(root, 'action.yml'), 'utf8'));

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

for (const store of STORES) {
  const pin = pins[store];
  const dir = join(root, 'stores', store);
  if (existsSync(join(dir, '.git')) && git(dir, 'rev-parse', 'HEAD') === pin.ref) {
    git(dir, 'reset', '--quiet', '--hard');
    git(dir, 'clean', '--quiet', '-d', '-x', '--force');
    console.log(`stores/${store} is ${pin.repository} ${pin.version} at ${pin.ref}, reset to a clean checkout.`);
    continue;
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '--quiet');
  git(dir, 'fetch', '--quiet', '--depth', '1', `https://github.com/${pin.repository}.git`, pin.ref);
  git(dir, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');
  console.log(`stores/${store} is ${pin.repository} ${pin.version} at ${pin.ref}.`);
}
