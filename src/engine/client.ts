import type { ConvertOptions, ConvertResult, Engine, EngineProgress, InputPage } from '../types.ts';
import type { WorkerRequest, WorkerRequestBody, WorkerResponse } from './protocol.ts';

interface Pending {
  resolve: (value: WorkerResponse & { type: 'done' }) => void;
  reject: (error: Error) => void;
  onProgress?: (p: EngineProgress) => void;
}

/** Creates an engine backed by one lazily started Web Worker. `init` is idempotent; `convert` calls are serialized. */
export function createEngine(): Engine {
  let worker: Worker | undefined;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  let initPromise: Promise<void> | undefined;
  /** Progress listeners of everyone who called init() while it was running. */
  const initListeners = new Set<(p: EngineProgress) => void>();
  let queue: Promise<unknown> = Promise.resolve();

  function getWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      if (msg.type === 'progress') {
        entry.onProgress?.(msg.progress);
        return;
      }
      pending.delete(msg.id);
      if (msg.type === 'error') entry.reject(new Error(msg.message));
      else entry.resolve(msg);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'The embroidery engine crashed.');
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      worker?.terminate();
      worker = undefined;
      initPromise = undefined;
    };
    return worker;
  }

  function request(
    body: WorkerRequestBody,
    onProgress?: (p: EngineProgress) => void,
  ): Promise<WorkerResponse & { type: 'done' }> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      getWorker().postMessage({ ...body, id } as WorkerRequest);
    });
  }

  function init(onProgress?: (p: EngineProgress) => void): Promise<void> {
    if (onProgress) initListeners.add(onProgress);
    initPromise ??= request({ type: 'init' }, (p) => initListeners.forEach((l) => l(p)))
      .then(() => undefined)
      .catch((e) => {
        initPromise = undefined; // allow retry
        throw e;
      })
      .finally(() => initListeners.clear());
    return initPromise;
  }

  return {
    init,

    convert(page: InputPage, options: ConvertOptions, baseName: string): Promise<ConvertResult> {
      const run = async (): Promise<ConvertResult> => {
        await init();
        const msg = await request({ type: 'convert', page, options, baseName });
        if (!msg.result) throw new Error('The embroidery engine returned no result.');
        return msg.result;
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
