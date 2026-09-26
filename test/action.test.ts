import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { FLAGS } from '../scripts/lib/preflight.mjs';
import { ENV_NAMES } from '../scripts/lib/report.mjs';
import { readPins } from '../scripts/pins.ts';
import { EXCLUDED } from './exclusions.ts';
import { list, map, parseYaml, text, type YamlMap } from './yaml.ts';

const ROOT = resolve(import.meta.dirname, '..');
const source = readFileSync(join(ROOT, 'action.yml'), 'utf8');
const action = map(parseYaml(source, 'action.yml'), 'action.yml');
const outputs = map(action.outputs, 'outputs');
const runs = map(action.runs, 'runs');
const steps = list(runs.steps, 'runs.steps').map((step, index) => map(step, `step ${index + 1}`));
const step = (id: string): YamlMap => steps.find((each) => each.id === id) ?? assert.fail(`no step with id ${id}`);
const STEP_KEYS = ['id', 'name', 'if', 'uses', 'with', 'run', 'shell', 'env'];

describe('action.yml', () => {
  it('stays inside the YAML subset the tests parse, with each key once', () => {
    assert.deepEqual(Object.keys(action), ['name', 'description', 'author', 'branding', 'inputs', 'outputs', 'runs']);
    assert.equal(runs.using, 'composite');
    for (const each of steps) for (const key of Object.keys(each)) assert.ok(STEP_KEYS.includes(key), `step ${each.id} has key ${key}`);
  });

  it('keeps the Marketplace name and a description the store repositories\' rule accepts', () => {
    assert.equal(action.name, 'Publish to Extension Stores');
    const description = text(action.description, 'description');
    assert.ok(description.length <= 125, `description has ${description.length} characters`);
    assert.ok(!description.includes(': '), 'description contains a colon followed by a space');
  });

  it('runs the six steps in order', () => {
    assert.deepEqual(steps.map((each) => each.id), ['preflight', 'chrome-auth', 'chrome', 'firefox', 'edge', 'report']);
  });

  it('pins every uses: to a full commit SHA with a version comment', () => {
    const lines = source.split(/\r?\n/).filter((line) => /^\s*(-\s+)?uses:/.test(line));
    assert.equal(lines.length, 4);
    for (const line of lines) assert.match(line, /^\s+uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    assert.equal(readPins(source).length, 4);
  });

  it('never puts an expression inside a run: script', () => {
    for (const each of steps.filter((candidate) => candidate.run !== undefined)) {
      assert.ok(!text(each.run, 'run').includes('${{'), `step ${each.id} interpolates into run:`);
      assert.equal(each.shell, 'bash');
    }
    assert.equal(step('preflight').run, 'node "$GITHUB_ACTION_PATH/scripts/preflight.mjs"');
    assert.equal(step('report').run, 'node "$GITHUB_ACTION_PATH/scripts/report.mjs"');
    assert.ok(existsSync(join(ROOT, 'scripts/preflight.mjs')) && existsSync(join(ROOT, 'scripts/report.mjs')));
  });

  it('lets no step continue on error', () => {
    assert.ok(!/continue-on-error/.test(source));
  });

  it('starts every condition after preflight with !cancelled() and the preflight outcome', () => {
    for (const each of steps.slice(1)) {
      assert.ok(text(each.if, `${each.id} if`).startsWith("${{ !cancelled() && steps.preflight.outcome == 'success'"), `step ${each.id}`);
    }
    assert.equal(step('preflight').if, undefined);
    assert.ok(text(step('chrome').if, 'chrome if').includes("steps.chrome-auth.outcome != 'failure'"));
    assert.ok(text(step('chrome-auth').if, 'chrome-auth if').includes("steps.preflight.outputs.chrome-wif == 'true'"));
    for (const store of ['chrome', 'firefox', 'edge']) assert.ok(text(step(store).if, `${store} if`).includes(`steps.preflight.outputs.${store} == 'true'`));
  });

  it('gets the Chrome token with the Chrome README\'s settings', () => {
    assert.deepEqual(step('chrome-auth').with, {
      workload_identity_provider: '${{ inputs.chrome-workload-identity-provider }}',
      service_account: '${{ inputs.chrome-service-account }}',
      token_format: 'access_token',
      access_token_scopes: 'https://www.googleapis.com/auth/chromewebstore',
      access_token_lifetime: '1800s',
      create_credentials_file: 'false',
      export_environment_variables: 'false',
    });
  });

  it('gives preflight one presence flag per checked input and never a value', () => {
    const env = map(step('preflight').env, 'preflight env');
    const expected = Object.fromEntries([['DRY_RUN', '${{ inputs.dry-run }}'], ...[...FLAGS].map(([name, flag]) => [flag, `\${{ inputs.${name} != '' }}`])]);
    assert.deepEqual(env, expected);
    assert.equal(FLAGS.size, 19);
  });

  it('gives report the step outcomes and store outputs, the same expressions as the outputs', () => {
    const env = map(step('report').env, 'report env');
    assert.deepEqual(Object.keys(env), ENV_NAMES);
    assert.equal(env.CHROME_AUTH_OUTCOME, '${{ steps.chrome-auth.outcome }}');
    for (const name of ENV_NAMES.filter((each) => each !== 'CHROME_AUTH_OUTCOME')) {
      const output = name.toLowerCase().replace(/_/g, '-');
      assert.equal(env[name], map(outputs[output], output).value, `${name} and output ${output}`);
    }
  });

  it('computes chrome-outcome from the auth step and the Chrome step', () => {
    assert.equal(map(outputs['chrome-outcome'], 'chrome-outcome').value, "${{ steps.chrome-auth.outcome == 'failure' && 'failure' || steps.chrome.outcome }}");
    assert.equal(map(outputs['firefox-outcome'], 'firefox-outcome').value, '${{ steps.firefox.outcome }}');
    assert.equal(map(outputs['edge-outcome'], 'edge-outcome').value, '${{ steps.edge.outcome }}');
  });

  it('never exposes the Google token as an output', () => {
    for (const [name, output] of Object.entries(outputs)) assert.ok(!text(map(output, name).value, name).includes('access_token'), name);
  });
});

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
const inputs = map(action.inputs, 'inputs');

function section(heading: string): string {
  const lines = readme.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `README has no "## ${heading}" section`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

function tableRows(markdown: string): string[][] {
  const rows: string[][] = [];
  const lines = markdown.split('\n');
  lines.forEach((line, index) => {
    if (!line.startsWith('| ') || line.startsWith('| ---') || lines[index + 1]?.startsWith('| ---')) return;
    rows.push(line.slice(2, -2).split(' | '));
  });
  return rows;
}

const codeNames = (markdown: string) => tableRows(markdown).map((row) => /^`([\w-]+)`$/.exec(row[0] ?? '')?.[1]).filter((name): name is string => Boolean(name));

describe('README', () => {
  it('lists every input once in the inputs tables', () => {
    const names = codeNames(section('Inputs'));
    assert.deepEqual([...names].sort(), Object.keys(inputs).sort());
  });

  it('lists every output once in the outputs table', () => {
    const names = codeNames(section('Outputs'));
    assert.deepEqual([...names].sort(), Object.keys(outputs).sort());
  });

  it('lists every store input and output left out, once', () => {
    const rows = tableRows(section('What it leaves to the store actions')).map((row) => row[0] ?? '');
    const expected = Object.entries(EXCLUDED).flatMap(([store, { inputs: excludedInputs, outputs: excludedOutputs }]) => {
      const title = store[0]!.toUpperCase() + store.slice(1);
      return [...excludedInputs.map((name) => `${title} input \`${name}\``), ...excludedOutputs.map((name) => `${title} output \`${name}\``)];
    });
    assert.deepEqual([...rows].sort(), expected.sort());
  });

  it('names the pinned version and commit of every inner action', () => {
    const pins = readPins(source);
    const rows = tableRows(section('Versions')).filter((row) => row[0]?.startsWith('['));
    assert.deepEqual(
      rows.map((row) => row.join(' | ')),
      pins.map((pin) => `[${pin.repository}](https://github.com/${pin.repository}) | ${pin.version} | \`${pin.ref}\``),
    );
    const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
    const newest = /^## .*\n\n(.*)$/m.exec(changelog)?.[1] ?? '';
    for (const pin of pins) assert.ok(newest.includes(pin.version.slice(1)), `the newest CHANGELOG entry does not name ${pin.repository} ${pin.version}`);
  });

  it('uses only declared inputs and outputs in its examples', () => {
    const blocks = [...readme.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1]!);
    for (const block of blocks.filter((each) => !/uses: hamzahamidi\/publish-to-(chrome|firefox|edge)/.test(each) || each.includes('publish-to-extension-stores'))) {
      for (const [, name] of block.matchAll(/^\s+((?:chrome|firefox|edge)-[\w-]+|dry-run):/gm)) assert.ok(inputs[name!], `README example uses undeclared input ${name}`);
    }
    for (const [, name] of readme.matchAll(/steps\.stores\.outputs\.([\w-]+)/g)) assert.ok(outputs[name!], `README uses undeclared output ${name}`);
  });
});

describe('writing rules', () => {
  const files = ['README.md', 'CHANGELOG.md', 'SECURITY.md', 'llms.txt', 'action.yml'];
  const banned = /\b(ensur\w*|leverag\w*|comprehensive\w*|robust\w*|seamless\w*|optimi[sz]\w*|overall|ultimately|additionally|furthermore|moreover|untested|best effort|not verified)\b/i;

  for (const file of files) {
    it(`${file} uses no dash punctuation and none of the excluded words`, () => {
      let fenced = false;
      readFileSync(join(ROOT, file), 'utf8')
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (line.startsWith('```')) fenced = !fenced;
          const where = `${file}:${index + 1}`;
          assert.ok(!/[\u2013\u2014]/.test(line), `${where} has an en or em dash`);
          assert.ok(!banned.test(line), `${where} uses an excluded word: ${banned.exec(line)?.[0]}`);
          if (!fenced && file !== 'action.yml') assert.ok(!/\S\s-\s/.test(line.replace(/^\s*- /, '')), `${where} uses a hyphen as a dash`);
        });
    });
  }
});
