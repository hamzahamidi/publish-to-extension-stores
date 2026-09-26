import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { checkInputs, DRY_RUN_VALUES, FLAGS, runPreflight, STORES } from '../scripts/lib/preflight.mjs';

const SCRIPT = resolve(import.meta.dirname, '../scripts/preflight.mjs');
const ID_TOKEN = 'ACTIONS_ID_TOKEN_REQUEST_URL';
const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const CHROME_TOKEN = ['chrome-access-token', 'chrome-publisher-id', 'chrome-item-id', 'chrome-zip'];
const CHROME_TRIO = ['chrome-client-id', 'chrome-client-secret', 'chrome-refresh-token', 'chrome-publisher-id', 'chrome-item-id', 'chrome-zip'];
const CHROME_WIF = ['chrome-workload-identity-provider', 'chrome-service-account', 'chrome-publisher-id', 'chrome-item-id', 'chrome-zip'];
const FIREFOX = ['firefox-api-key', 'firefox-api-secret', 'firefox-addon-id', 'firefox-zip', 'firefox-channel'];
const EDGE = ['edge-api-key', 'edge-client-id', 'edge-product-id', 'edge-zip'];

type Env = Record<string, string | undefined>;

function env(names: string[], extra: Env = {}): Env {
  const flags = Object.fromEntries([...FLAGS].map(([name, flag]) => [flag, String(names.includes(name))]));
  return { DRY_RUN: 'false', ...flags, ...extra };
}

const without = (names: string[], ...removed: string[]) => names.filter((name) => !removed.includes(name));

function problems(names: string[], extra: Env = {}): string[] {
  return checkInputs(env(names, extra)).problems;
}

describe('store activation', () => {
  it('runs Chrome with an access token and skips the others', () => {
    const result = checkInputs(env(CHROME_TOKEN));
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.runs, { chrome: true, 'chrome-wif': false, firefox: false, edge: false });
    assert.deepEqual(result.lines, [
      'Runs: Chrome (access token). Skips: Firefox, no firefox-api-key or firefox-api-secret; Edge, no edge-api-key or edge-client-id.',
    ]);
  });

  it('runs Chrome through Workload Identity Federation when the job can request the OIDC token', () => {
    const result = checkInputs(env([...CHROME_WIF, ...FIREFOX], { [ID_TOKEN]: 'https://token.example' }));
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.runs, { chrome: true, 'chrome-wif': true, firefox: true, edge: false });
    assert.deepEqual(result.lines, ['Runs: Chrome (Workload Identity Federation) and Firefox. Skips: Edge, no edge-api-key or edge-client-id.']);
  });

  it('runs all three stores, Chrome through the refresh token', () => {
    const result = checkInputs(env([...CHROME_TRIO, ...FIREFOX, ...EDGE], { DRY_RUN: 'true' }));
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.runs, { chrome: true, 'chrome-wif': false, firefox: true, edge: true });
    assert.deepEqual(result.lines, [
      'Runs: Chrome (refresh token), Firefox and Edge.',
      'Dry run: each store action checks its inputs and reports what a real run would do, without uploading.',
    ]);
  });

  it('activates a store on any one of its credential inputs, so a partial set fails instead of being skipped', () => {
    for (const name of STORES.flatMap((store) => store.credentials)) {
      const { runs } = checkInputs(env([name]));
      const store = STORES.find((each) => each.credentials.includes(name))!;
      assert.equal(runs[store.key as 'chrome' | 'firefox' | 'edge'], true, name);
    }
    assert.match(problems(['firefox-api-key']).join('\n'), /Firefox runs because firefox-api-key is set, but firefox-api-secret, firefox-addon-id, firefox-zip and firefox-channel are empty\./);
  });

  it('treats only the exact flag value true as set', () => {
    const result = checkInputs({ ...env(EDGE), EDGE_API_KEY_SET: 'TRUE', EDGE_CLIENT_ID_SET: '' });
    assert.equal(result.runs.edge, false);
    assert.match(result.problems.join('\n'), /No store has credentials/);
  });
});

describe('rules', () => {
  it('P1 refuses a dry-run value the store actions would refuse', () => {
    assert.deepEqual(problems(EDGE, { DRY_RUN: 'yes' }), ['Input dry-run must be true or false, got "yes".']);
    for (const value of [...DRY_RUN_VALUES, '', ' true ']) assert.deepEqual(problems(EDGE, { DRY_RUN: value }), [], JSON.stringify(value));
    assert.deepEqual(problems(EDGE, { DRY_RUN: undefined }), []);
  });

  it('P2 refuses a run where no store has credentials', () => {
    assert.deepEqual(problems([]), [
      "No store has credentials. Pass the chrome-*, firefox-* or edge-* credential inputs from secrets, and check that the secrets exist in this job's environment.",
    ]);
  });

  it('P3 refuses an identifier without any credential of its store', () => {
    const hint = "If you pass them from secrets, check the secret names and that the secrets exist in this job's environment.";
    assert.deepEqual(problems([...EDGE, 'firefox-addon-id']), [`firefox-addon-id is set, but firefox-api-key and firefox-api-secret are empty. ${hint}`]);
    assert.deepEqual(problems([...EDGE, 'chrome-item-id']), [
      `chrome-item-id is set, but chrome-workload-identity-provider, chrome-service-account, chrome-access-token, chrome-client-id, chrome-client-secret and chrome-refresh-token are empty. ${hint}`,
    ]);
    assert.deepEqual(problems([...FIREFOX, 'edge-product-id']), [`edge-product-id is set, but edge-api-key and edge-client-id are empty. ${hint}`]);
    assert.deepEqual(problems([...FIREFOX, 'edge-zip']), [], 'only the identifier triggers the guard');
  });

  it('P4 refuses half of the Workload Identity pair', () => {
    const token = { [ID_TOKEN]: 'https://token.example' };
    assert.deepEqual(problems(without(CHROME_WIF, 'chrome-service-account'), token), [
      'Pass chrome-workload-identity-provider and chrome-service-account together; chrome-service-account is empty.',
    ]);
    assert.deepEqual(problems(without(CHROME_WIF, 'chrome-workload-identity-provider'), token), [
      'Pass chrome-workload-identity-provider and chrome-service-account together; chrome-workload-identity-provider is empty.',
    ]);
  });

  it('P5 refuses Workload Identity together with another Chrome credential', () => {
    const token = { [ID_TOKEN]: 'https://token.example' };
    assert.deepEqual(problems([...CHROME_WIF, 'chrome-access-token'], token), [
      'chrome-workload-identity-provider makes this action get the Chrome token itself. Leave out chrome-access-token.',
    ]);
    assert.deepEqual(problems([...CHROME_WIF, 'chrome-access-token', 'chrome-refresh-token'], token), [
      'chrome-workload-identity-provider makes this action get the Chrome token itself. Leave out chrome-access-token and chrome-refresh-token.',
    ]);
    assert.deepEqual(problems([...CHROME_WIF, 'chrome-client-id'], token), [
      'chrome-workload-identity-provider makes this action get the Chrome token itself. Leave out chrome-client-id.',
    ]);
  });

  it('P6 refuses an access token with the trio, and part of the trio', () => {
    assert.deepEqual(problems([...CHROME_TOKEN, 'chrome-client-id', 'chrome-refresh-token']), [
      'Pass either chrome-access-token or chrome-client-id, chrome-client-secret and chrome-refresh-token, not both (got chrome-access-token, chrome-client-id and chrome-refresh-token).',
    ]);
    assert.deepEqual(problems(without(CHROME_TRIO, 'chrome-client-secret', 'chrome-refresh-token')), [
      'Missing chrome-client-secret and chrome-refresh-token. The refresh token route needs chrome-client-id, chrome-client-secret and chrome-refresh-token.',
    ]);
    assert.deepEqual(problems(without(CHROME_TRIO, 'chrome-client-id')), [
      'Missing chrome-client-id. The refresh token route needs chrome-client-id, chrome-client-secret and chrome-refresh-token.',
    ]);
  });

  it('P7 refuses Workload Identity when the job did not grant id-token: write', () => {
    assert.deepEqual(problems(CHROME_WIF), ['chrome-workload-identity-provider needs permissions: id-token: write on the job. A composite action cannot request it.']);
    assert.deepEqual(problems(CHROME_WIF, { [ID_TOKEN]: '' }), ['chrome-workload-identity-provider needs permissions: id-token: write on the job. A composite action cannot request it.']);
  });

  it('P8 refuses a Chrome run without its publisher, item and exactly one package', () => {
    assert.deepEqual(problems(without(CHROME_TOKEN, 'chrome-publisher-id', 'chrome-item-id')), [
      'Chrome runs because chrome-access-token is set, but chrome-publisher-id and chrome-item-id are empty.',
    ]);
    assert.deepEqual(problems(without(CHROME_TOKEN, 'chrome-zip')), ['Chrome runs, but chrome-zip and chrome-crx are both empty. Pass one of them.']);
    assert.deepEqual(problems([...CHROME_TOKEN, 'chrome-crx']), ['Pass either chrome-zip or chrome-crx, not both.']);
    assert.deepEqual(problems([...without(CHROME_TOKEN, 'chrome-zip'), 'chrome-crx']), []);
  });

  it('P9 refuses a Firefox run with a required input missing', () => {
    assert.deepEqual(problems(without(FIREFOX, 'firefox-channel')), ['Firefox runs because firefox-api-key and firefox-api-secret are set, but firefox-channel is empty.']);
    assert.deepEqual(problems(without(FIREFOX, 'firefox-api-key', 'firefox-zip')), ['Firefox runs because firefox-api-secret is set, but firefox-api-key and firefox-zip are empty.']);
  });

  it('P10 refuses an Edge run with a required input missing', () => {
    assert.deepEqual(problems(without(EDGE, 'edge-product-id', 'edge-zip')), ['Edge runs because edge-api-key and edge-client-id are set, but edge-product-id and edge-zip are empty.']);
    assert.deepEqual(problems(without(EDGE, 'edge-api-key')), ['Edge runs because edge-client-id is set, but edge-api-key is empty.']);
  });

  it('reports every problem of one run together', () => {
    const found = problems(['chrome-workload-identity-provider', 'chrome-access-token', 'firefox-api-key', 'edge-product-id'], { DRY_RUN: 'maybe' });
    assert.equal(found.length, 8, found.join('\n'));
    assert.ok(found.some((problem) => problem.startsWith('Input dry-run')));
    assert.ok(found.some((problem) => problem.startsWith('edge-product-id is set')));
    assert.ok(found.some((problem) => problem.includes('id-token: write')));
  });
});

type Runs = { chrome: boolean; 'chrome-wif': boolean; firefox: boolean; edge: boolean };

function assertSafe(names: string[], extra: Env, label: string): boolean {
  const { problems: found, runs } = checkInputs(env(names, extra));
  const has = (name: string) => names.includes(name);
  if (found.length > 0) return false;
  assert.deepEqual(
    { chrome: runs.chrome, firefox: runs.firefox, edge: runs.edge },
    Object.fromEntries(STORES.map((store) => [store.key, store.credentials.some(has)])),
    `${label}: outputs differ from the activation rule`,
  );
  if (!runs.chrome) assert.equal(runs['chrome-wif'], false, `${label}: chrome-wif without Chrome`);
  for (const store of STORES) {
    const key = store.key as keyof Runs;
    if (!runs[key]) continue;
    assert.ok(store.credentials.some(has), `${label}: ${store.key} runs without a credential input`);
    for (const name of store.required) assert.ok(has(name), `${label}: ${store.key} runs without ${name}`);
  }
  if (runs.chrome) {
    assert.equal(Number(has('chrome-zip')) + Number(has('chrome-crx')), 1, `${label}: Chrome runs without exactly one package`);
    const wif = has('chrome-workload-identity-provider') && has('chrome-service-account') && Boolean(extra[ID_TOKEN]);
    const token = has('chrome-access-token');
    const trio = has('chrome-client-id') && has('chrome-client-secret') && has('chrome-refresh-token');
    const partial = ['chrome-workload-identity-provider', 'chrome-service-account', 'chrome-client-id', 'chrome-client-secret', 'chrome-refresh-token'].some(has);
    assert.equal([wif, token, trio].filter(Boolean).length, 1, `${label}: Chrome runs without exactly one complete credential form`);
    if (token) assert.ok(!partial, `${label}: Chrome runs with an access token and another credential input`);
    assert.equal(runs['chrome-wif'], wif, `${label}: chrome-wif does not match the credential form`);
  }
  return true;
}

function subsets<T>(items: T[]): T[][] {
  return Array.from({ length: 2 ** items.length }, (_, mask) => items.filter((_, bit) => mask & (1 << bit)));
}

describe('every combination of one store\'s flags', () => {
  const chromeFlags = [...FLAGS.keys()].filter((name) => name.startsWith('chrome-'));
  const firefoxFlags = [...FLAGS.keys()].filter((name) => name.startsWith('firefox-'));
  const edgeFlags = [...FLAGS.keys()].filter((name) => name.startsWith('edge-'));

  it('covers the 19 inputs the rules read', () => {
    assert.deepEqual([chromeFlags.length, firefoxFlags.length, edgeFlags.length], [10, 5, 4]);
  });

  it('Chrome: 2,048 cases, with Firefox and Edge absent and complete', () => {
    let cases = 0;
    let passed = 0;
    for (const others of [[], [...FIREFOX, ...EDGE]]) {
      for (const names of subsets(chromeFlags)) {
        for (const extra of [{}, { [ID_TOKEN]: 'https://token.example' }]) {
          if (assertSafe([...names, ...others], extra, `chrome ${names.join(',')} others ${others.length}`)) passed++;
          cases++;
        }
      }
    }
    assert.deepEqual([cases, passed], [4096, 36]);
  });

  it('Firefox: 32 cases, with Chrome and Edge absent and complete', () => {
    let passed = 0;
    for (const others of [[], [...CHROME_TOKEN, ...EDGE]]) {
      for (const names of subsets(firefoxFlags)) if (assertSafe([...names, ...others], {}, `firefox ${names.join(',')} others ${others.length}`)) passed++;
    }
    assert.equal(passed, 6);
  });

  it('Edge: 16 cases, with Chrome and Firefox absent and complete', () => {
    let passed = 0;
    for (const others of [[], [...CHROME_TOKEN, ...FIREFOX]]) {
      for (const names of subsets(edgeFlags)) if (assertSafe([...names, ...others], {}, `edge ${names.join(',')} others ${others.length}`)) passed++;
    }
    assert.equal(passed, 4);
  });
});

describe('runPreflight', () => {
  it('writes the four outputs and the summary line on success', () => {
    const output = join(dir, 'success');
    writeFileSync(output, '');
    const lines: string[] = [];
    const code = runPreflight(env(EDGE, { GITHUB_OUTPUT: output }), (line: string) => lines.push(line));
    assert.equal(code, 0);
    assert.deepEqual(readFileSync(output, 'utf8').split(/\r?\n/), ['chrome=false', 'chrome-wif=false', 'firefox=false', 'edge=true', '']);
    assert.deepEqual(lines, [
      'Runs: Edge. Skips: Chrome, no chrome-workload-identity-provider, chrome-service-account, chrome-access-token, chrome-client-id, chrome-client-secret or chrome-refresh-token; Firefox, no firefox-api-key or firefox-api-secret.',
    ]);
  });

  it('prints each problem as an error annotation, escaped, and writes no output', () => {
    const output = join(dir, 'failure');
    writeFileSync(output, '');
    const lines: string[] = [];
    const code = runPreflight(env([], { GITHUB_OUTPUT: output, DRY_RUN: '50%\nyes' }), (line: string) => lines.push(line));
    assert.equal(code, 1);
    assert.equal(readFileSync(output, 'utf8'), '');
    assert.deepEqual(lines, [
      '::error::Input dry-run must be true or false, got "50%25\\nyes".',
      "::error::No store has credentials. Pass the chrome-*, firefox-* or edge-* credential inputs from secrets, and check that the secrets exist in this job's environment.",
    ]);
  });

  it('refuses to run outside a step that has GITHUB_OUTPUT', () => {
    const lines: string[] = [];
    assert.equal(runPreflight(env(EDGE), (line: string) => lines.push(line)), 1);
    assert.match(lines.join('\n'), /::error::GITHUB_OUTPUT is not set/);
  });

  it('runs as a script with only the step environment', () => {
    const output = join(dir, 'script');
    writeFileSync(output, '');
    const ok = spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH ?? '', ...env(FIREFOX), GITHUB_OUTPUT: output }, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /^Runs: Firefox\./);
    assert.match(readFileSync(output, 'utf8'), /^firefox=true$/m);

    const refused = spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH ?? '', ...env(['chrome-item-id']), GITHUB_OUTPUT: output }, encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout.split('\n').filter((line) => line.startsWith('::error::')).length, 2);
  });
});
