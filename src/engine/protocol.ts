// Messages exchanged between client.ts (main thread) and worker.ts.
import type { ConvertOptions, ConvertResult, EngineProgress, InputPage } from '../types.ts';

export type WorkerRequestBody =
  | { type: 'init' }
  | { type: 'convert'; page: InputPage; options: ConvertOptions; baseName: string };
export type WorkerRequest = WorkerRequestBody & { id: number };

/** Typed arrays inside the result are transferred, not copied. */
export type WireResult = ConvertResult;

export type WorkerResponse =
  | { id: number; type: 'progress'; progress: EngineProgress }
  | { id: number; type: 'done'; result?: WireResult }
  | { id: number; type: 'error'; message: string };
