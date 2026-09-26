import { appendFileSync } from 'node:fs';
import { EOL } from 'node:os';
import { and, escapeData, isAre, or } from './text.mjs';

export const FLAGS = new Map([
  ['chrome-workload-identity-provider', 'CHROME_WIF_PROVIDER_SET'],
  ['chrome-service-account', 'CHROME_SERVICE_ACCOUNT_SET'],
  ['chrome-access-token', 'CHROME_ACCESS_TOKEN_SET'],
  ['chrome-client-id', 'CHROME_CLIENT_ID_SET'],
  ['chrome-client-secret', 'CHROME_CLIENT_SECRET_SET'],
  ['chrome-refresh-token', 'CHROME_REFRESH_TOKEN_SET'],
  ['chrome-publisher-id', 'CHROME_PUBLISHER_ID_SET'],
  ['chrome-item-id', 'CHROME_ITEM_ID_SET'],
  ['chrome-zip', 'CHROME_ZIP_SET'],
  ['chrome-crx', 'CHROME_CRX_SET'],
  ['firefox-api-key', 'FIREFOX_API_KEY_SET'],
  ['firefox-api-secret', 'FIREFOX_API_SECRET_SET'],
  ['firefox-addon-id', 'FIREFOX_ADDON_ID_SET'],
  ['firefox-zip', 'FIREFOX_ZIP_SET'],
  ['firefox-channel', 'FIREFOX_CHANNEL_SET'],
  ['edge-api-key', 'EDGE_API_KEY_SET'],
  ['edge-client-id', 'EDGE_CLIENT_ID_SET'],
  ['edge-product-id', 'EDGE_PRODUCT_ID_SET'],
  ['edge-zip', 'EDGE_ZIP_SET'],
]);

export const DRY_RUN_VALUES = ['true', 'True', 'TRUE', 'false', 'False', 'FALSE'];

const CHROME_WIF = ['chrome-workload-identity-provider', 'chrome-service-account'];
const CHROME_TRIO = ['chrome-client-id', 'chrome-client-secret', 'chrome-refresh-token'];

export const STORES = [
  {
    key: 'chrome',
    name: 'Chrome',
    credentials: [...CHROME_WIF, 'chrome-access-token', ...CHROME_TRIO],
    identifier: 'chrome-item-id',
    required: ['chrome-publisher-id', 'chrome-item-id'],
  },
  {
    key: 'firefox',
    name: 'Firefox',
    credentials: ['firefox-api-key', 'firefox-api-secret'],
    identifier: 'firefox-addon-id',
    required: ['firefox-api-key', 'firefox-api-secret', 'firefox-addon-id', 'firefox-zip', 'firefox-channel'],
  },
  {
    key: 'edge',
    name: 'Edge',
    credentials: ['edge-api-key', 'edge-client-id'],
    identifier: 'edge-product-id',
    required: ['edge-api-key', 'edge-client-id', 'edge-product-id', 'edge-zip'],
  },
];

const SECRETS_HINT = "If you pass them from secrets, check the secret names and that the secrets exist in this job's environment.";

export function checkInputs(env = process.env) {
  const set = (name = '') => env[FLAGS.get(name) ?? ''] === 'true';
  const problems = [];

  const dryRun = (env.DRY_RUN ?? '').trim();
  if (dryRun && !DRY_RUN_VALUES.includes(dryRun)) problems.push(`Input dry-run must be true or false, got ${JSON.stringify(dryRun)}.`);

  const active = new Set(STORES.filter((store) => store.credentials.some(set)).map((store) => store.key));
  if (active.size === 0) {
    problems.push("No store has credentials. Pass the chrome-*, firefox-* or edge-* credential inputs from secrets, and check that the secrets exist in this job's environment.");
  }
  for (const store of STORES) {
    if (set(store.identifier) && !active.has(store.key)) {
      problems.push(`${store.identifier} is set, but ${and.format(store.credentials)} are empty. ${SECRETS_HINT}`);
    }
  }

  const wifGiven = CHROME_WIF.filter(set);
  const trioGiven = CHROME_TRIO.filter(set);
  const token = set('chrome-access-token');
  if (wifGiven.length === 1) {
    problems.push(`Pass chrome-workload-identity-provider and chrome-service-account together; ${CHROME_WIF.find((name) => !set(name))} is empty.`);
  }
  if (wifGiven.length > 0) {
    const others = [...(token ? ['chrome-access-token'] : []), ...trioGiven];
    if (others.length > 0) {
      problems.push(`chrome-workload-identity-provider makes this action get the Chrome token itself. Leave out ${and.format(others)}.`);
    }
    if (!env.ACTIONS_ID_TOKEN_REQUEST_URL) {
      problems.push('chrome-workload-identity-provider needs permissions: id-token: write on the job. A composite action cannot request it.');
    }
  } else if (token && trioGiven.length > 0) {
    problems.push(`Pass either chrome-access-token or chrome-client-id, chrome-client-secret and chrome-refresh-token, not both (got ${and.format(['chrome-access-token', ...trioGiven])}).`);
  } else if (trioGiven.length > 0 && trioGiven.length < CHROME_TRIO.length) {
    const missing = CHROME_TRIO.filter((name) => !set(name));
    problems.push(`Missing ${and.format(missing)}. The refresh token route needs chrome-client-id, chrome-client-secret and chrome-refresh-token.`);
  }

  for (const store of STORES) {
    if (!active.has(store.key)) continue;
    const given = store.credentials.filter(set);
    const missing = store.required.filter((name) => !set(name));
    if (missing.length > 0) {
      problems.push(`${store.name} runs because ${and.format(given)} ${isAre(given.length)} set, but ${and.format(missing)} ${isAre(missing.length)} empty.`);
    }
    if (store.key === 'chrome') {
      const zip = set('chrome-zip');
      const crx = set('chrome-crx');
      if (!zip && !crx) problems.push('Chrome runs, but chrome-zip and chrome-crx are both empty. Pass one of them.');
      if (zip && crx) problems.push('Pass either chrome-zip or chrome-crx, not both.');
    }
  }

  const runs = {
    chrome: active.has('chrome'),
    'chrome-wif': active.has('chrome') && wifGiven.length > 0,
    firefox: active.has('firefox'),
    edge: active.has('edge'),
  };
  const chromeMode = runs['chrome-wif'] ? 'Workload Identity Federation' : token ? 'access token' : 'refresh token';
  const running = STORES.filter((store) => active.has(store.key)).map((store) => (store.key === 'chrome' ? `Chrome (${chromeMode})` : store.name));
  const skipped = STORES.filter((store) => !active.has(store.key)).map((store) => `${store.name}, no ${or.format(store.credentials)}`);
  const lines = [`Runs: ${and.format(running)}.${skipped.length > 0 ? ` Skips: ${skipped.join('; ')}.` : ''}`];
  if (['true', 'True', 'TRUE'].includes(dryRun)) lines.push('Dry run: each store action checks its inputs and reports what a real run would do, without uploading.');
  return { problems, runs, lines };
}

export function runPreflight(env = process.env, write = console.log) {
  const { problems, runs, lines } = checkInputs(env);
  if (!env.GITHUB_OUTPUT) problems.push('GITHUB_OUTPUT is not set. This script runs as a step of the publish-to-extension-stores composite action.');
  if (problems.length > 0) {
    for (const problem of problems) write(`::error::${escapeData(problem)}`);
    return 1;
  }
  appendFileSync(env.GITHUB_OUTPUT ?? '', Object.entries(runs).map(([name, value]) => `${name}=${value}${EOL}`).join(''));
  for (const line of lines) write(line);
  return 0;
}
