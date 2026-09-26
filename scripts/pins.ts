export interface Pin {
  line: number;
  action: string;
  repository: string;
  ref: string;
  version: string;
}

export const STORE_REPOSITORIES = {
  chrome: 'hamzahamidi/publish-to-chrome-web-store',
  firefox: 'hamzahamidi/publish-to-firefox-add-ons',
  edge: 'hamzahamidi/publish-to-edge-add-ons',
} as const;

export type Store = keyof typeof STORE_REPOSITORIES;
export const STORES = Object.keys(STORE_REPOSITORIES) as Store[];

const USES = /^\s*(?:-\s+)?uses:\s*([^\s@]+)@(\S+)(?:\s+#\s*(\S+))?\s*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const RELEASE = /^v\d+\.\d+\.\d+$/;

export function readPins(source: string): Pin[] {
  return source.split(/\r?\n/).flatMap((content, index) => {
    const match = USES.exec(content);
    if (!match || match[1]!.startsWith('.')) return [];
    const [, action = '', ref = '', version = ''] = match;
    return [{ line: index + 1, action, repository: action.split('/').slice(0, 2).join('/'), ref, version }];
  });
}

export function storePins(source: string): Record<Store, Pin> {
  const pins = readPins(source);
  return Object.fromEntries(
    STORES.map((store) => {
      const matches = pins.filter((pin) => pin.repository === STORE_REPOSITORIES[store]);
      if (matches.length !== 1) throw new Error(`action.yml must use ${STORE_REPOSITORIES[store]} exactly once, found ${matches.length}.`);
      return [store, matches[0]!];
    }),
  ) as Record<Store, Pin>;
}

export function formatProblem(pin: Pin): string | undefined {
  if (!COMMIT.test(pin.ref)) return `${pin.action} is pinned to ${pin.ref}, not to a full commit SHA.`;
  if (!RELEASE.test(pin.version)) return `${pin.action}@${pin.ref} has no "# vX.Y.Z" version comment.`;
  return undefined;
}

export function tagCommit(lsRemote: string, tag: string): string | undefined {
  const refs = new Map(
    lsRemote
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [sha = '', ref = ''] = line.trim().split(/\s+/);
        return [ref, sha] as const;
      }),
  );
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`);
}

export function pinProblem(pin: Pin, lsRemote: string): string | undefined {
  const commit = tagCommit(lsRemote, pin.version);
  if (!commit) return `${pin.repository} has no tag ${pin.version}.`;
  if (commit !== pin.ref) return `${pin.repository} tag ${pin.version} is commit ${commit}, but action.yml pins ${pin.ref}.`;
  return undefined;
}
