import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { buildReport, cell, runReport } from '../scripts/lib/report.mjs';
import { plainLine } from '../scripts/lib/text.mjs';

const SCRIPT = resolve(import.meta.dirname, '../scripts/report.mjs');
const OUTCOMES = ['success', 'failure', 'skipped'];
const dir = mkdtempSync(join(tmpdir(), 'report-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const submitted = {
  CHROME_AUTH_OUTCOME: 'skipped',
  CHROME_OUTCOME: 'success',
  CHROME_RESULT: 'submitted',
  CHROME_STATE: 'PENDING_REVIEW',
  CHROME_VERSION: '1.2.3',
  FIREFOX_OUTCOME: 'success',
  FIREFOX_RESULT: 'submitted',
  FIREFOX_STATE: 'unreviewed',
  FIREFOX_VERSION: '1.2.3',
  FIREFOX_EDIT_URL: 'https://addons.mozilla.org/en-US/developers/addon/my-extension/versions/42',
  EDGE_OUTCOME: 'success',
  EDGE_RESULT: 'submitted',
  EDGE_VERSION: '1.2.3',
  EDGE_ERROR_CODE: '',
};

const summaryRows = (summary: string) => summary.split(/\r?\n/).filter((line) => line.startsWith('| ') && !line.startsWith('| Store') && !line.startsWith('| ---'));

describe('buildReport', () => {
  it('prints one line per store in run order and a summary table', () => {
    const { lines, summary, failed } = buildReport(submitted);
    assert.deepEqual(lines, [
      'Chrome Web Store: success. result submitted, state PENDING_REVIEW, version 1.2.3.',
      'Firefox Add-ons: success. result submitted, state unreviewed, version 1.2.3, edit page https://addons.mozilla.org/en-US/developers/addon/my-extension/versions/42.',
      'Microsoft Edge Add-ons: success. result submitted, version 1.2.3.',
    ]);
    assert.deepEqual(summaryRows(summary), [
      '| Chrome Web Store | success | submitted | PENDING_REVIEW | 1.2.3 |  |',
      '| Firefox Add-ons | success | submitted | unreviewed | 1.2.3 | [Developer Hub](https://addons.mozilla.org/en-US/developers/addon/my-extension/versions/42) |',
      '| Microsoft Edge Add-ons | success | submitted |  | 1.2.3 |  |',
    ]);
    assert.match(summary, /^### Publish to Extension Stores\r?\n\r?\n\| Store \| Outcome \| Result \| State \| Version \| Details \|/);
    assert.deepEqual(failed, []);
  });

  it('fails exactly when one of the 27 outcome combinations holds a failure', () => {
    let combinations = 0;
    for (const chrome of OUTCOMES) {
      for (const firefox of OUTCOMES) {
        for (const edge of OUTCOMES) {
          const lines: string[] = [];
          const code = runReport({ CHROME_OUTCOME: chrome, FIREFOX_OUTCOME: firefox, EDGE_OUTCOME: edge }, (line: string) => lines.push(line));
          const expected = [chrome, firefox, edge].includes('failure') ? 1 : 0;
          assert.equal(code, expected, `${chrome} ${firefox} ${edge}`);
          assert.equal(lines.filter((line) => line.startsWith('::error::')).length, expected);
          combinations++;
        }
      }
    }
    assert.equal(combinations, 27);
  });

  it('names every failed store in one error', () => {
    const lines: string[] = [];
    const code = runReport({ ...submitted, CHROME_OUTCOME: 'failure', EDGE_OUTCOME: 'failure', EDGE_RESULT: '', EDGE_ERROR_CODE: 'InProgressSubmission' }, (line: string) => lines.push(line));
    assert.equal(code, 1);
    assert.equal(lines.at(-1), "::error::Failed: Chrome Web Store and Microsoft Edge Add-ons. Each failed store's error is on its own step above; a failure does not stop the stores after it.");
    assert.equal(lines[2], 'Microsoft Edge Add-ons: failure. version 1.2.3, error code InProgressSubmission.');
  });

  it('reports a skipped store and a store that failed before writing any output', () => {
    const { lines, summary } = buildReport({ FIREFOX_OUTCOME: 'failure', EDGE_OUTCOME: 'skipped' });
    assert.deepEqual(lines, ['Chrome Web Store: skipped, no credential inputs.', 'Firefox Add-ons: failure.', 'Microsoft Edge Add-ons: skipped, no credential inputs.']);
    assert.deepEqual(summaryRows(summary), [
      '| Chrome Web Store | skipped |  |  |  |  |',
      '| Firefox Add-ons | failure |  |  |  |  |',
      '| Microsoft Edge Add-ons | skipped |  |  |  |  |',
    ]);
  });

  it('says when google-github-actions/auth failed before the Chrome action', () => {
    const { lines, summary, failed } = buildReport({ CHROME_AUTH_OUTCOME: 'failure', CHROME_OUTCOME: 'failure', EDGE_OUTCOME: 'success', EDGE_RESULT: 'submitted' });
    assert.equal(lines[0], 'Chrome Web Store: failure. google-github-actions/auth failed, so the Chrome action did not run.');
    assert.equal(summaryRows(summary)[0], '| Chrome Web Store | failure |  |  |  | google-github-actions/auth failed, so the Chrome action did not run |');
    assert.deepEqual(failed, ['Chrome Web Store']);
  });

  it('keeps store values from turning into workflow commands in the log', () => {
    const { lines } = buildReport({
      CHROME_OUTCOME: 'success',
      CHROME_VERSION: '1.0\n::add-mask::secret',
      FIREFOX_OUTCOME: 'success',
      FIREFOX_VERSION: '2.0 ##[warning]spoof\r\n::error::spoof',
      EDGE_OUTCOME: 'success',
      EDGE_VERSION: '3.0\u2028::stop-commands::token',
    });
    for (const line of lines) {
      assert.ok(!/[\r\n\u2028]/.test(line), line);
      assert.ok(!line.includes('##[w'), line);
    }
    assert.equal(lines[0], 'Chrome Web Store: success. version 1.0 ::add-mask::secret.');
    assert.equal(lines[1], 'Firefox Add-ons: success. version 2.0 ##[\\warning]spoof ::error::spoof.');
  });

  it('escapes table syntax and HTML in the summary', () => {
    const { summary } = buildReport({ CHROME_OUTCOME: 'success', CHROME_VERSION: '1.0 | <b>x</b> & y\n\\|z', CHROME_STATE: '<img src=x>' });
    assert.equal(summaryRows(summary)[0], '| Chrome Web Store | success |  | &lt;img src=x&gt; | 1.0 \\| &lt;b&gt;x&lt;/b&gt; &amp; y \\\\\\|z |  |');
  });

  it('links the Firefox edit page only on addons.mozilla.org', () => {
    const details = (url: string) => summaryRows(buildReport({ FIREFOX_OUTCOME: 'success', FIREFOX_EDIT_URL: url }).summary)[1]!.split(' | ').at(-1);
    assert.equal(details('https://addons.mozilla.org/en-US/developers/addon/x/versions/1'), '[Developer Hub](https://addons.mozilla.org/en-US/developers/addon/x/versions/1) |');
    assert.equal(details('http://127.0.0.1:8080/en-US/developers/addon/x/versions/1'), 'http://127.0.0.1:8080/en-US/developers/addon/x/versions/1 |');
    assert.equal(details('https://addons.mozilla.org.evil.example/x'), 'https://addons.mozilla.org.evil.example/x |');
    assert.equal(details('https://addons.mozilla.org/x)[y](https://evil.example'), 'https://addons.mozilla.org/x)[y](https://evil.example |');
  });

  it('shares the store actions\' line neutralization', () => {
    assert.equal(plainLine('first\n::add-mask::x\r\nsecond'), 'first ::add-mask::x second');
    for (const text of ['::warning::spoof', '  ::stop-commands::token', '\u0085::stop-commands::token', '\u2028::error::spoof']) assert.match(plainLine(text), /^> /, JSON.stringify(text));
    assert.equal(cell('a|b'), 'a\\|b');
  });
});

describe('runReport', () => {
  it('appends the table to the step summary when there is one', () => {
    const summary = join(dir, 'summary.md');
    writeFileSync(summary, 'earlier step\n');
    assert.equal(runReport({ ...submitted, GITHUB_STEP_SUMMARY: summary }, () => {}), 0);
    const written = readFileSync(summary, 'utf8');
    assert.ok(written.startsWith('earlier step\n### Publish to Extension Stores'));
    assert.equal(summaryRows(written).length, 3);
  });

  it('runs as a script and fails when a store failed', () => {
    const summary = join(dir, 'script.md');
    writeFileSync(summary, '');
    const result = spawnSync(process.execPath, [SCRIPT], { env: { ...submitted, FIREFOX_OUTCOME: 'failure', GITHUB_STEP_SUMMARY: summary }, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^Chrome Web Store: success\./);
    assert.match(result.stdout, /^::error::Failed: Firefox Add-ons\./m);
    assert.equal(summaryRows(readFileSync(summary, 'utf8')).length, 3);

    const ok = spawnSync(process.execPath, [SCRIPT], { env: submitted, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
  });
});
