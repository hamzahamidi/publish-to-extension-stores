import { appendFileSync } from 'node:fs';
import { EOL } from 'node:os';
import { and, escapeData, plainLine } from './text.mjs';

const AMO_PAGE = /^https:\/\/addons\.mozilla\.org\/[^\s()<>|[\]`"'\\]*$/;

export const ENV_NAMES = [
  'CHROME_AUTH_OUTCOME',
  'CHROME_OUTCOME',
  'CHROME_RESULT',
  'CHROME_STATE',
  'CHROME_VERSION',
  'FIREFOX_OUTCOME',
  'FIREFOX_RESULT',
  'FIREFOX_STATE',
  'FIREFOX_VERSION',
  'FIREFOX_EDIT_URL',
  'EDGE_OUTCOME',
  'EDGE_RESULT',
  'EDGE_VERSION',
  'EDGE_ERROR_CODE',
];

const labelled = (label = '', text = '') => (text ? `${label} ${text}` : '');

export function cell(value = '') {
  return value
    .replace(/[\r\n\u0085\u2028\u2029]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|');
}

export function buildReport(env = process.env) {
  const value = (name = '') => env[name] ?? '';
  const authFailure = value('CHROME_AUTH_OUTCOME') === 'failure' ? 'google-github-actions/auth failed, so the Chrome action did not run' : '';
  const editUrl = value('FIREFOX_EDIT_URL');
  const errorCode = value('EDGE_ERROR_CODE');
  const stores = [
    {
      name: 'Chrome Web Store',
      outcome: value('CHROME_OUTCOME') || 'skipped',
      values: [authFailure, labelled('result', value('CHROME_RESULT')), labelled('state', value('CHROME_STATE')), labelled('version', value('CHROME_VERSION'))],
      columns: [value('CHROME_RESULT'), value('CHROME_STATE'), value('CHROME_VERSION')],
      details: cell(authFailure),
    },
    {
      name: 'Firefox Add-ons',
      outcome: value('FIREFOX_OUTCOME') || 'skipped',
      values: [labelled('result', value('FIREFOX_RESULT')), labelled('state', value('FIREFOX_STATE')), labelled('version', value('FIREFOX_VERSION')), labelled('edit page', editUrl)],
      columns: [value('FIREFOX_RESULT'), value('FIREFOX_STATE'), value('FIREFOX_VERSION')],
      details: AMO_PAGE.test(editUrl) ? `[Developer Hub](${editUrl})` : cell(editUrl),
    },
    {
      name: 'Microsoft Edge Add-ons',
      outcome: value('EDGE_OUTCOME') || 'skipped',
      values: [labelled('result', value('EDGE_RESULT')), labelled('version', value('EDGE_VERSION')), labelled('error code', errorCode)],
      columns: [value('EDGE_RESULT'), '', value('EDGE_VERSION')],
      details: errorCode ? `error code ${cell(errorCode)}` : '',
    },
  ];

  const lines = stores.map((store) => {
    if (store.outcome === 'skipped') return plainLine(`${store.name}: skipped, no credential inputs.`);
    const parts = store.values.filter(Boolean);
    return plainLine(`${store.name}: ${store.outcome}.${parts.length > 0 ? ` ${parts.join(', ')}.` : ''}`);
  });
  const summary = [
    '### Publish to Extension Stores',
    '',
    '| Store | Outcome | Result | State | Version | Details |',
    '| --- | --- | --- | --- | --- | --- |',
    ...stores.map((store) => `| ${[store.name, store.outcome, ...store.columns].map(cell).join(' | ')} | ${store.details} |`),
    '',
  ].join(EOL);
  const failed = stores.filter((store) => store.outcome === 'failure').map((store) => store.name);
  return { lines, summary, failed };
}

export function runReport(env = process.env, write = console.log) {
  const { lines, summary, failed } = buildReport(env);
  for (const line of lines) write(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  if (failed.length === 0) return 0;
  write(`::error::${escapeData(`Failed: ${and.format(failed)}. Each failed store's error is on its own step above; a failure does not stop the stores after it.`)}`);
  return 1;
}
