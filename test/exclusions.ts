import type { Store } from '../scripts/pins.ts';

export const EXCLUDED: Record<Store, { inputs: string[]; outputs: string[] }> = {
  chrome: { inputs: ['rollout-only'], outputs: [] },
  firefox: { inputs: ['wait', 'wait-timeout', 'signed-xpi'], outputs: ['signed-xpi'] },
  edge: { inputs: [], outputs: [] },
};
