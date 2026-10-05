// The single place that picks the Engine and input implementations.
// To use the real modules, replace with:
//   export { createEngine } from '../engine/client';
//   export { loadFile, resizePage } from '../input/index';
export { createFakeEngine as createEngine } from './fakeEngine';
export { loadFile, resizePage } from './fakeInput';
