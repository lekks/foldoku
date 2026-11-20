import { FACET_NEIGHBORS, NB } from './geometry.ts';

/** Groups selected facet IDs in traversal order. The first facet of each component is encoded as ~id. */
export function groupFacets(order: Uint16Array, count: number): Int16Array {
  const remaining = new Uint8Array(NB.length);
  const todo = new Uint16Array(count);
  const grouped = new Int16Array(count);
  for (let i = 0; i < count; i++) remaining[order[i]!] = 1;
  let write = 0;
  for (let i = 0; i < count; i++) {
    const root = order[i]!;
    if (!remaining[root]) continue;
    remaining[root] = 0;
    grouped[write++] = ~root;
    todo[0] = root;
    let pending = 1;
    while (pending > 0) {
      const facet = todo[--pending]!;
      const end = facet * 3 + 3;
      for (let i = end - 3; i < end; i++) {
        const neighbor = FACET_NEIGHBORS[i]!;
        if (neighbor < 0 || !remaining[neighbor]) continue;
        remaining[neighbor] = 0;
        grouped[write++] = neighbor;
        todo[pending++] = neighbor;
      }
    }
  }
  return grouped;
}
