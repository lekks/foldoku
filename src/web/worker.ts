// Worker entry: generates puzzles off the main thread. Bundled into a string and started from a Blob URL.

import { createGenerator } from '../core/wasm.ts';
import type { Puzzle } from '../core/index.ts';

declare const FOLDOPIA_WASM_BASE64: string;

export type GenerateArgs = Parameters<ReturnType<typeof createGenerator>>;
export interface WorkerRequest { id: number; args: GenerateArgs }
export type WorkerReply = { id: number; puzzle: Puzzle | null } | { id: number; error: string };

// The project compiles against the DOM library, so describe the worker scope by hand.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(reply: WorkerReply): void;
};

let generate: ReturnType<typeof createGenerator> | undefined;
scope.onmessage = ({ data: { id, args } }) => {
  if (!generate) {
    try {
      const bytes = Uint8Array.from(atob(FOLDOPIA_WASM_BASE64), char => char.charCodeAt(0));
      generate = createGenerator(new WebAssembly.Module(bytes));
    } catch {
      scope.postMessage({ id, error: 'Не удалось запустить WebAssembly. Откройте Foldopia в актуальной версии браузера.' });
      return;
    }
  }
  try {
    scope.postMessage({ id, puzzle: generate(...args) });
  } catch {
    scope.postMessage({ id, error: `Сбой генерации задания № ${args[0]}.` });
  }
};
