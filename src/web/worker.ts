// Worker entry: generates puzzles off the main thread. Bundled into a string and started from a Blob URL.

import { generate } from '../core/index.ts';
import type { Puzzle } from '../core/index.ts';

export type GenerateArgs = Parameters<typeof generate>;
export interface WorkerRequest { id: number; args: GenerateArgs }
export interface WorkerReply { id: number; puzzle: Puzzle | null }

// The project compiles against the DOM library, so describe the worker scope by hand.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(reply: WorkerReply): void;
};

scope.onmessage = e => {
  scope.postMessage({ id: e.data.id, puzzle: generate(...e.data.args) });
};
