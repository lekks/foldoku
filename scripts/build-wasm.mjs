import { execFileSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const generatorSource = fileURLToPath(new URL('../src/core/wasm/generator.cpp', import.meta.url));

function executable(name, extraDir) {
  const dirs = [...(extraDir ? [extraDir] : []), ...(process.env.PATH ?? '').split(delimiter)];
  const paths = /[\\/]/.test(name) ? [name] : dirs.map(dir => join(dir, name));
  const match = paths.find(path => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  return match && resolve(match);
}

export function buildGeneratorWasm() {
  const compiler = executable(process.env.CLANGXX ?? 'clang++');
  const linker = executable(process.env.WASM_LD ?? 'wasm-ld', compiler && dirname(compiler));
  if (!compiler || !linker) {
    throw new Error('Building the WASM generator requires clang++ and wasm-ld on PATH (or CLANGXX and WASM_LD).');
  }
  const work = mkdtempSync(join(tmpdir(), 'foldoku-wasm-'));
  const binary = join(work, 'generator.wasm');
  try {
    execFileSync(compiler, [
      '--target=wasm32', `-fuse-ld=${linker}`,
      '-std=c++17', '-O3', '-mbulk-memory', '-nostdlib', '-ffreestanding', '-fno-exceptions', '-fno-rtti',
      '-Wl,--no-entry,--strip-all,--export=set_neighbor,--export=generate_puzzle,-z,stack-size=262144',
      generatorSource, '-o', binary,
    ], { stdio: 'inherit' });
    return readFileSync(binary);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
