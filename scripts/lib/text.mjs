export const and = new Intl.ListFormat('en-GB', { type: 'conjunction' });
export const or = new Intl.ListFormat('en-GB', { type: 'disjunction' });

export const isAre = (count = 0) => (count === 1 ? 'is' : 'are');

export const escapeData = (value = '') => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export function plainLine(message = '') {
  const text = message.replace(/[\r\n\u0085\u2028\u2029]+/g, ' ').replace(/##\[/g, '##[\\');
  return /^[\s\u0085]*::/.test(text) ? `> ${text}` : text;
}
