import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { type Store, STORES, storePins } from '../scripts/pins.ts';
import { EXCLUDED } from './exclusions.ts';
import { list, map, parseYaml, text, type YamlMap } from './yaml.ts';

const ROOT = resolve(import.meta.dirname, '..');
const TITLES: Record<Store, string> = { chrome: 'Chrome', firefox: 'Firefox', edge: 'Edge' };

const OWNED_INPUTS = ['dry-run', 'chrome-workload-identity-provider', 'chrome-service-account'];
const EXCEPTION_VALUES: Record<Store, Record<string, string>> = {
  chrome: { 'access-token': '${{ inputs.chrome-access-token || steps.chrome-auth.outputs.access_token }}', 'dry-run': '${{ inputs.dry-run }}' },
  firefox: { 'dry-run': '${{ inputs.dry-run }}' },
  edge: { 'dry-run': '${{ inputs.dry-run }}' },
};
const RESERVED_CHROME_INPUTS = ['workload-identity-provider', 'service-account'];
const RESERVED_OUTPUTS = ['outcome'];

const source = readFileSync(join(ROOT, 'action.yml'), 'utf8');
const umbrella = map(parseYaml(source, 'action.yml'), 'action.yml');
const umbrellaInputs = map(umbrella.inputs, 'inputs');
const umbrellaOutputs = map(umbrella.outputs, 'outputs');
const steps = list(map(umbrella.runs, 'runs').steps, 'runs.steps').map((step, index) => map(step, `step ${index + 1}`));
const pins = storePins(source);

function storeAction(store: Store): YamlMap {
  const dir = join(ROOT, 'stores', store);
  const path = join(dir, 'action.yml');
  assert.ok(existsSync(path), `${path} is missing. Run node scripts/fetch-stores.ts first; it clones each store action at the commit action.yml pins.`);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.equal(head, pins[store].ref, `stores/${store} is at ${head}, but action.yml pins ${pins[store].ref}. Run node scripts/fetch-stores.ts again.`);
  return map(parseYaml(readFileSync(path, 'utf8'), `stores/${store}/action.yml`), `stores/${store}/action.yml`);
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

function inputDescription(store: Store, name: string, input: YamlMap): string {
  const required = input.required === 'true' ? ` Required when ${TITLES[store]} runs.` : '';
  return `${TITLES[store]} action input ${name}. ${text(input.description, `${store} input ${name} description`)}${required}`;
}

function inputYaml(store: Store, name: string, input: YamlMap): string {
  return [
    `  ${store}-${name}:`,
    `    description: ${quote(inputDescription(store, name, input))}`,
    '    required: false',
    ...(input.default === undefined ? [] : [`    default: ${quote(text(input.default, 'default'))}`]),
  ].join('\n');
}

const outputDescription = (store: Store, name: string, output: YamlMap) => `${TITLES[store]} action output ${name}. ${text(output.description, `${store} output ${name} description`)}`;

function outputYaml(store: Store, name: string, output: YamlMap): string {
  return [`  ${store}-${name}:`, `    description: ${quote(outputDescription(store, name, output))}`, `    value: \${{ steps.${store}.outputs.${name} }}`].join('\n');
}

const EXCLUSION_HINT = 'or add it to EXCLUDED in test/exclusions.ts, with the reason in the README table "What it leaves to the store actions"';

describe('parity with the pinned store actions', () => {
  const mappedInputs: string[] = [];
  const mappedOutputs: string[] = [];

  for (const store of STORES) {
    describe(`${TITLES[store]} ${pins[store].version}`, () => {
      const action = storeAction(store);
      const inputs = map(action.inputs, `${store} inputs`);
      const outputs = map(action.outputs, `${store} outputs`);
      const mapped = Object.keys(inputs).filter((name) => name !== 'dry-run' && !EXCLUDED[store].inputs.includes(name));
      mappedInputs.push(...mapped.map((name) => `${store}-${name}`));
      mappedOutputs.push(...Object.keys(outputs).filter((name) => !EXCLUDED[store].outputs.includes(name)).map((name) => `${store}-${name}`), `${store}-outcome`);

      it('maps every input that is not excluded, and no excluded one', () => {
        for (const name of mapped) {
          const input = map(inputs[name], `${store} input ${name}`);
          assert.ok(umbrellaInputs[`${store}-${name}`], `The ${TITLES[store]} action declares input ${name}. Add to action.yml:\n${inputYaml(store, name, input)}\n${EXCLUSION_HINT}.`);
        }
        for (const name of EXCLUDED[store].inputs) assert.equal(umbrellaInputs[`${store}-${name}`], undefined, `${store}-${name} is excluded but declared in action.yml`);
      });

      it('copies each mapped input\'s default and description, with required false', () => {
        for (const name of mapped) {
          const input = map(inputs[name], `${store} input ${name}`);
          const declared = map(umbrellaInputs[`${store}-${name}`], `${store}-${name}`);
          const expected = `Expected in action.yml:\n${inputYaml(store, name, input)}`;
          assert.equal(declared.default, input.default, `${store}-${name} default. ${expected}`);
          assert.equal(declared.required, 'false', `${store}-${name} required. ${expected}`);
          assert.equal(declared.description, inputDescription(store, name, input), `${store}-${name} description. ${expected}`);
        }
        assert.equal(map(umbrellaInputs['dry-run'], 'dry-run').default, map(inputs['dry-run'], `${store} dry-run`).default, `${store} dry-run default`);
      });

      it('passes exactly the mapped inputs, dry-run and the exceptions to the store step', () => {
        const step = steps.find((each) => each.id === store);
        assert.ok(step, `no step with id ${store}`);
        assert.equal(text(step.uses, `${store} uses`).split('@')[0], pins[store].action);
        const given = map(step.with, `${store} with`);
        const expected = Object.keys(inputs).filter((name) => !EXCLUDED[store].inputs.includes(name));
        assert.deepEqual(Object.keys(given).sort(), expected.sort(), `the ${store} step's with: must hold the ${TITLES[store]} action's inputs minus the excluded ones`);
        for (const name of expected) {
          assert.equal(given[name], EXCEPTION_VALUES[store][name] ?? `\${{ inputs.${store}-${name} }}`, `${store} step input ${name}`);
        }
      });

      it('maps every store output that is not excluded, plus the outcome', () => {
        for (const [name, value] of Object.entries(outputs)) {
          const output = map(value, `${store} output ${name}`);
          const declared = umbrellaOutputs[`${store}-${name}`];
          if (EXCLUDED[store].outputs.includes(name)) {
            assert.equal(declared, undefined, `${store}-${name} is excluded but declared in action.yml`);
            continue;
          }
          assert.ok(declared, `The ${TITLES[store]} action declares output ${name}. Add to action.yml:\n${outputYaml(store, name, output)}\n${EXCLUSION_HINT}.`);
          assert.equal(map(declared, name).value, `\${{ steps.${store}.outputs.${name} }}`, `${store}-${name} value`);
          assert.equal(map(declared, name).description, outputDescription(store, name, output), `${store}-${name} description. Expected:\n${outputYaml(store, name, output)}`);
        }
        assert.ok(umbrellaOutputs[`${store}-outcome`], `${store}-outcome is missing`);
      });

      it('keeps every exclusion pointing at a name the store still declares', () => {
        for (const name of EXCLUDED[store].inputs) assert.ok(inputs[name], `EXCLUDED lists ${store} input ${name}, which the ${TITLES[store]} action no longer declares. Remove the row.`);
        for (const name of EXCLUDED[store].outputs) assert.ok(outputs[name], `EXCLUDED lists ${store} output ${name}, which the ${TITLES[store]} action no longer declares. Remove the row.`);
      });

      it('declares no name that collides with an umbrella name', () => {
        for (const name of RESERVED_OUTPUTS) assert.equal(outputs[name], undefined, `the ${TITLES[store]} action declares output ${name}, which collides with ${store}-${name}`);
        if (store === 'chrome') {
          for (const name of RESERVED_CHROME_INPUTS) assert.equal(inputs[name], undefined, `the Chrome action declares input ${name}, which collides with chrome-${name}`);
        }
      });
    });
  }

  it('declares no input or output outside the mapped names and the named exceptions', () => {
    assert.deepEqual(Object.keys(umbrellaInputs).sort(), [...OWNED_INPUTS, ...mappedInputs].sort());
    assert.deepEqual(Object.keys(umbrellaOutputs).sort(), mappedOutputs.sort());
  });

  it('counts 31 inputs and 14 outputs, as the README states', () => {
    assert.deepEqual([Object.keys(umbrellaInputs).length, mappedInputs.length, Object.keys(umbrellaOutputs).length], [31, 28, 14]);
  });
});
