import { buildGeneratorWasm } from '../scripts/build-wasm.mjs';
import { createGenerator } from '../src/core/wasm.ts';

export const generate = createGenerator(new WebAssembly.Module(buildGeneratorWasm()));
