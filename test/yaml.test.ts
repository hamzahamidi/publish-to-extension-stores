import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { list, map, parseYaml, text } from './yaml.ts';

describe('the YAML subset parser', () => {
  it('reads mappings, sequences of mappings and scalars', () => {
    const parsed = parseYaml(
      [
        '# comment',
        'name: Plain value # trailing comment',
        "quoted: 'It''s #1'",
        'double: "a\\nb"',
        'empty:',
        'steps:',
        '- id: one',
        '  with:',
        '    key: value',
        '- plain item',
        'nested:',
        '  list:',
        '    - a',
        '    -   id: two',
        '        run: echo',
      ].join('\r\n'),
    );
    assert.deepEqual(parsed, {
      name: 'Plain value',
      quoted: "It's #1",
      double: 'a\nb',
      empty: '',
      steps: [{ id: 'one', with: { key: 'value' } }, 'plain item'],
      nested: { list: ['a', { id: 'two', run: 'echo' }] },
    });
    assert.equal(text(map(parsed, 'root').name, 'name'), 'Plain value');
    assert.equal(list(map(parsed, 'root').steps, 'steps').length, 2);
  });

  for (const [source, message] of [
    ['a: 1\na: 2', /a is defined twice/],
    ['a: |\n  text', /block scalars/],
    ['a: &anchor x', /anchors, aliases and tags/],
    ['a: [1, 2]', /flow collections/],
    ["a: 'open", /unterminated single-quoted/],
    ['a: "open', /unterminated double-quoted/],
    ['a:\n  b: 1\n    c: 2', /unexpected indentation/],
    ['a: 1\n  b: 2', /unexpected indentation/],
    ['just text', /expected "key: value"/],
    ['\ta: 1', /tabs/],
    ['- a\n  - b', /unexpected indentation/],
    ['a:\n  - b\nc', /expected "key: value"/],
  ] as const) {
    it(`refuses ${JSON.stringify(source)}`, () => {
      assert.throws(() => parseYaml(source, 'test.yml'), message);
    });
  }

  it('reports the wrong node type', () => {
    assert.throws(() => map('x', 'thing'), /thing is not a mapping/);
    assert.throws(() => text([], 'thing'), /thing is not a scalar/);
    assert.throws(() => list('x', 'thing'), /thing is not a sequence/);
  });
});
