import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatProblem, pinProblem, readPins, storePins, tagCommit } from '../scripts/pins.ts';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const SOURCE = [
  'runs:',
  '  steps:',
  `    - uses: google-github-actions/auth@${SHA} # v3.0.0`,
  '    - id: chrome',
  `      uses: hamzahamidi/publish-to-chrome-web-store@${SHA} # v1.2.2`,
  `      uses: hamzahamidi/publish-to-firefox-add-ons@${OTHER} # v1.0.0`,
  `      uses: hamzahamidi/publish-to-edge-add-ons@v1`,
  '      uses: ./stores/chrome/sign',
  `      uses: github/codeql-action/init@${SHA} # v4.38.2`,
].join('\n');

describe('pins', () => {
  it('reads every remote uses: line with its repository, ref and version comment', () => {
    assert.deepEqual(readPins(SOURCE), [
      { line: 3, action: 'google-github-actions/auth', repository: 'google-github-actions/auth', ref: SHA, version: 'v3.0.0' },
      { line: 5, action: 'hamzahamidi/publish-to-chrome-web-store', repository: 'hamzahamidi/publish-to-chrome-web-store', ref: SHA, version: 'v1.2.2' },
      { line: 6, action: 'hamzahamidi/publish-to-firefox-add-ons', repository: 'hamzahamidi/publish-to-firefox-add-ons', ref: OTHER, version: 'v1.0.0' },
      { line: 7, action: 'hamzahamidi/publish-to-edge-add-ons', repository: 'hamzahamidi/publish-to-edge-add-ons', ref: 'v1', version: '' },
      { line: 9, action: 'github/codeql-action/init', repository: 'github/codeql-action', ref: SHA, version: 'v4.38.2' },
    ]);
  });

  it('finds each store action exactly once', () => {
    const pins = storePins(SOURCE);
    assert.deepEqual([pins.chrome.ref, pins.firefox.ref, pins.edge.ref], [SHA, OTHER, 'v1']);
    assert.throws(() => storePins(SOURCE.replace(/.*publish-to-edge-add-ons.*/, '')), /must use hamzahamidi\/publish-to-edge-add-ons exactly once, found 0/);
  });

  it('refuses a ref that is not a full SHA, and a missing version comment', () => {
    const [auth, , , edge] = readPins(SOURCE);
    assert.equal(formatProblem(auth!), undefined);
    assert.equal(formatProblem(edge!), 'hamzahamidi/publish-to-edge-add-ons is pinned to v1, not to a full commit SHA.');
    assert.equal(formatProblem({ ...auth!, version: '' }), `google-github-actions/auth@${SHA} has no "# vX.Y.Z" version comment.`);
  });

  it('prefers the peeled commit of an annotated tag', () => {
    const lsRemote = `${OTHER}\trefs/tags/v3.0.0\n${SHA}\trefs/tags/v3.0.0^{}\n`;
    assert.equal(tagCommit(lsRemote, 'v3.0.0'), SHA);
    assert.equal(tagCommit(`${SHA}\trefs/tags/v3.0.0\n`, 'v3.0.0'), SHA);
    assert.equal(tagCommit('', 'v3.0.0'), undefined);
  });

  it('reports a tag that is missing or names another commit', () => {
    const [auth] = readPins(SOURCE);
    assert.equal(pinProblem(auth!, `${SHA}\trefs/tags/v3.0.0\r\n`), undefined);
    assert.equal(pinProblem(auth!, ''), 'google-github-actions/auth has no tag v3.0.0.');
    assert.equal(pinProblem(auth!, `${OTHER}\trefs/tags/v3.0.0\n`), `google-github-actions/auth tag v3.0.0 is commit ${OTHER}, but action.yml pins ${SHA}.`);
  });
});
