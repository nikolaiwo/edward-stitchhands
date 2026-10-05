// The single place that picks the Engine and input implementations.
// To use the real engine, replace the first export with:
//   export { createEngine } from '../engine/client';
export { createFakeEngine as createEngine } from './fakeEngine';
export { loadFile, resizePage } from '../input/index';
