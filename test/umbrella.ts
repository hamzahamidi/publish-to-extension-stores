import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Store = 'chrome' | 'firefox' | 'edge';
type Outcome = 'success' | 'failure' | 'skipped';

interface Scenario {
  umbrella: 'success' | 'failure';
  outcomes: Record<Store, Outcome>;
  results: Record<Store, string>;
  errorCode?: string;
  mocks: boolean;
  silent: Store[];
  check?: () => Promise<void>;
}

const ROOT = resolve(import.meta.dirname, '..');
const STORES: Store[] = ['chrome', 'firefox', 'edge'];
const storeFile = (store: Store, name: string) => join(ROOT, 'stores', store, name);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

async function firefoxCalls(): Promise<Array<{ method: string; call: string }>> {
  const { control } = readJson<{ control: number }>(storeFile('firefox', 'self-test-ports.json'));
  const response = await fetch(`http://127.0.0.1:${control}/`);
  return ((await response.json()) as { requests: Array<{ method: string; call: string }> }).requests;
}

const chromeCalls = (): string[] | undefined => {
  const path = storeFile('chrome', 'self-test-requests.json');
  return existsSync(path) ? readJson<Array<{ key: string }>>(path).map((request) => request.key) : undefined;
};

async function assertSilent(store: Store): Promise<void> {
  if (store === 'chrome') {
    assert.ok(existsSync(storeFile('chrome', 'self-test-port')), 'the Chrome mock is not running');
    assert.deepEqual(chromeCalls(), undefined, 'the Chrome mock recorded requests');
  } else if (store === 'firefox') {
    assert.deepEqual(await firefoxCalls(), [], 'the Firefox mock recorded requests');
  } else {
    assert.ok(existsSync(storeFile('edge', 'self-test-port')), 'the Edge mock is not running');
    assert.deepEqual(readJson(storeFile('edge', 'self-test-requests.json')), [], 'the Edge mock recorded requests');
  }
}

const every = (outcome: Outcome): Record<Store, Outcome> => ({ chrome: outcome, firefox: outcome, edge: outcome });
const none = { chrome: '', firefox: '', edge: '' };
const submitted = { chrome: 'submitted', firefox: 'submitted', edge: 'submitted' };

const SCENARIOS: Record<string, Scenario> = {
  all: { umbrella: 'success', outcomes: every('success'), results: submitted, mocks: true, silent: [] },
  'chrome-fails': {
    umbrella: 'failure',
    outcomes: { chrome: 'failure', firefox: 'success', edge: 'success' },
    results: { ...submitted, chrome: '' },
    mocks: true,
    silent: ['chrome'],
  },
  'edge-in-review': {
    umbrella: 'failure',
    outcomes: { chrome: 'success', firefox: 'success', edge: 'failure' },
    results: { ...submitted, edge: '' },
    errorCode: 'InProgressSubmission',
    mocks: true,
    silent: [],
  },
  'dry-run': {
    umbrella: 'success',
    outcomes: every('success'),
    results: { chrome: 'dry-run', firefox: 'dry-run', edge: 'dry-run' },
    mocks: true,
    silent: ['edge'],
    async check() {
      const chrome = chromeCalls() ?? [];
      assert.ok(chrome.length > 0, 'the Chrome dry run read nothing');
      for (const key of chrome) assert.match(key, /^GET \/v2\/publishers\/[^/]+\/items\/[^/]+:fetchStatus$/, 'the Chrome dry run sent more than status reads');
      const firefox = await firefoxCalls();
      assert.ok(firefox.length > 0, 'the Firefox dry run read nothing');
      for (const request of firefox) assert.equal(request.method, 'GET', `the Firefox dry run sent ${request.call}`);
    },
  },
  'refresh-token': {
    umbrella: 'success',
    outcomes: { chrome: 'success', firefox: 'skipped', edge: 'skipped' },
    results: { ...none, chrome: 'submitted' },
    mocks: true,
    silent: ['firefox', 'edge'],
    async check() {
      const requests = readJson<Array<{ key: string; form: Record<string, string> }>>(join(ROOT, 'self-test-token-requests.json'));
      assert.deepEqual(requests, [
        {
          key: 'POST /token',
          form: { client_id: 'self-test-client-id', client_secret: 'self-test-client-secret', refresh_token: 'self-test-refresh-token', grant_type: 'refresh_token' },
        },
      ]);
    },
  },
  'chrome-crx': {
    umbrella: 'success',
    outcomes: { chrome: 'success', firefox: 'skipped', edge: 'skipped' },
    results: { ...none, chrome: 'submitted' },
    mocks: true,
    silent: ['firefox', 'edge'],
  },
  refusal: { umbrella: 'failure', outcomes: every('skipped'), results: none, mocks: true, silent: STORES },
  'edge-dry-run': {
    umbrella: 'success',
    outcomes: { chrome: 'skipped', firefox: 'skipped', edge: 'success' },
    results: { ...none, edge: 'dry-run' },
    mocks: false,
    silent: [],
  },
  'no-credentials': { umbrella: 'failure', outcomes: every('skipped'), results: none, mocks: false, silent: [] },
};

const name = process.argv[2] ?? '';
const scenario = SCENARIOS[name];
if (!scenario) {
  console.error(`Usage: node test/umbrella.ts ${Object.keys(SCENARIOS).join('|')}`);
  process.exit(2);
}
const env = (variable: string) => process.env[variable] ?? '';

assert.deepEqual(
  {
    umbrella: env('UMBRELLA_OUTCOME'),
    outcomes: { chrome: env('CHROME_OUTCOME'), firefox: env('FIREFOX_OUTCOME'), edge: env('EDGE_OUTCOME') },
    results: { chrome: env('CHROME_RESULT'), firefox: env('FIREFOX_RESULT'), edge: env('EDGE_RESULT') },
    errorCode: env('EDGE_ERROR_CODE'),
  },
  { umbrella: scenario.umbrella, outcomes: scenario.outcomes, results: scenario.results, errorCode: scenario.errorCode ?? '' },
);
for (const store of scenario.silent) await assertSilent(store);
await scenario.check?.();
console.log(`The ${name} scenario ended ${scenario.umbrella} with the expected outcomes and results${scenario.mocks ? ', and each mock saw only what it should' : ''}.`);
