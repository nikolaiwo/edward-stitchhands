// The single place that picks the Engine and input implementations.
// Swap in './fakeEngine' (createFakeEngine) to develop the UI without Pyodide.
export { createEngine } from '../engine/client';
export { loadFile, resizePage } from '../input/index';
