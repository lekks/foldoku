// Benchmark adapter. The browser build uses src/core/connectivity.ts.
import { readFileSync } from 'node:fs';
import { FACET_NEIGHBORS, NB } from '../../src/core/geometry.ts';

interface Kernel {
  memory: WebAssembly.Memory;
  neighbor_buffer(): number;
  order_buffer(): number;
  grouped_buffer(): number;
  group_facets(count: number): void;
}

const path = process.env['FOLDOPIA_BENCH_WASM'];
if (!path || NB.length !== 256) throw new Error('Expected a WASM kernel for an 8×8 sheet');
const binary = new WebAssembly.Module(readFileSync(path));
const kernel = new WebAssembly.Instance(binary).exports as unknown as Kernel;
const memory = kernel.memory.buffer;
new Int16Array(memory, kernel.neighbor_buffer(), FACET_NEIGHBORS.length).set(FACET_NEIGHBORS);
const input = new Uint16Array(memory, kernel.order_buffer(), NB.length);
const output = new Int16Array(memory, kernel.grouped_buffer(), NB.length);

// The caller consumes the returned prefix before the next invocation.
export function groupFacets(order: Uint16Array, count: number): Int16Array {
  input.set(order);
  kernel.group_facets(count);
  return output;
}
