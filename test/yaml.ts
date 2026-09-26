export type Yaml = string | Yaml[] | YamlMap;
export interface YamlMap {
  [key: string]: Yaml;
}

interface Line {
  number: number;
  indent: number;
  text: string;
}

const KEY = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/;

export function parseYaml(source: string, path = 'YAML'): Yaml {
  const lines: Line[] = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    const text = raw.trim();
    if (text === '' || text.startsWith('#')) return;
    if (/^\s*\t/.test(raw)) throw new Error(`${path}:${index + 1}: tabs are outside the supported subset`);
    lines.push({ number: index + 1, indent: raw.length - raw.trimStart().length, text });
  });
  let position = 0;

  const fail = (line: Line, message: string): never => {
    throw new Error(`${path}:${line.number}: ${message}`);
  };

  const isItem = (line: Line) => line.text === '-' || line.text.startsWith('- ');

  function block(indent: number): Yaml {
    const first = lines[position];
    if (!first || first.indent < indent) return '';
    return isItem(first) ? sequence(first.indent) : mapping(first.indent);
  }

  function mapping(indent: number): YamlMap {
    const map: YamlMap = {};
    while (position < lines.length) {
      const line = lines[position]!;
      if (line.indent < indent || (line.indent === indent && isItem(line))) break;
      if (line.indent > indent) fail(line, 'unexpected indentation');
      const [, key = '', rest = ''] = KEY.exec(line.text) ?? fail(line, `expected "key: value", got ${JSON.stringify(line.text)}`);
      if (Object.hasOwn(map, key)) fail(line, `${key} is defined twice`);
      position++;
      const next = lines[position];
      if (rest !== '') map[key] = scalar(rest, line);
      else if (next && next.indent > indent) map[key] = block(next.indent);
      else if (next && next.indent === indent && isItem(next)) map[key] = sequence(indent);
      else map[key] = '';
    }
    return map;
  }

  function sequence(indent: number): Yaml[] {
    const items: Yaml[] = [];
    while (position < lines.length) {
      const line = lines[position]!;
      if (line.indent < indent || !isItem(line)) break;
      if (line.indent > indent) fail(line, 'unexpected indentation');
      const content = line.text.slice(1).trimStart();
      const itemIndent = indent + line.text.length - content.length;
      if (KEY.test(content)) {
        lines[position] = { ...line, indent: itemIndent, text: content };
        items.push(mapping(itemIndent));
      } else {
        position++;
        items.push(scalar(content, line));
      }
    }
    return items;
  }

  function scalar(text: string, line: Line): string {
    if (text.startsWith("'")) {
      const [, body = ''] = /^'((?:[^']|'')*)'(?:\s+#.*)?$/.exec(text) ?? fail(line, 'unterminated single-quoted scalar');
      return body.replace(/''/g, "'");
    }
    if (text.startsWith('"')) {
      const [, body = ''] = /^"((?:[^"\\]|\\.)*)"(?:\s+#.*)?$/.exec(text) ?? fail(line, 'unterminated double-quoted scalar');
      return JSON.parse(`"${body}"`) as string;
    }
    if (/^[|>]/.test(text)) fail(line, 'block scalars are outside the supported subset');
    if (/^[&*!]/.test(text)) fail(line, 'anchors, aliases and tags are outside the supported subset');
    if (/^[[{]/.test(text)) fail(line, 'flow collections are outside the supported subset');
    return text.replace(/\s+#.*$/, '');
  }

  const root = block(0);
  if (position < lines.length) fail(lines[position]!, 'unexpected content');
  return root;
}

export function map(value: Yaml | undefined, what: string): YamlMap {
  if (value === undefined || typeof value === 'string' || Array.isArray(value)) throw new Error(`${what} is not a mapping`);
  return value;
}

export function text(value: Yaml | undefined, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} is not a scalar`);
  return value;
}

export function list(value: Yaml | undefined, what: string): Yaml[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not a sequence`);
  return value;
}
