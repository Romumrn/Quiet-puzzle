/**
 * The bulb's search, and the editor's check, off the main thread (see
 * `askHint` and `checkGrid` in live.js): on a low-end phone they can take a
 * couple of seconds, and the screen must keep drawing while they do.
 */

import { searchFrom, gridVerdict } from './live.js';

// `globalThis` is the worker's `self`, and still a name Node knows when the
// module checks (tools/check.mjs) import it outside a worker.
globalThis.onmessage = ({ data }) => {
  const task = data.task === 'grid' ? gridVerdict : searchFrom;
  globalThis.postMessage({ job: data.job, result: task(data.ctx, data.state) });
};
