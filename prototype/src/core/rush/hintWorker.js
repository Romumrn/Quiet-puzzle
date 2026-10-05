/**
 * The bulb's search, off the main thread (see `askHint` in live.js): on a
 * low-end phone it can take a couple of seconds, and the board must keep
 * drawing while it does.
 */

import { searchFrom } from './live.js';

// `globalThis` is the worker's `self`, and still a name Node knows when the
// module checks (tools/check.mjs) import it outside a worker.
globalThis.onmessage = ({ data }) => {
  globalThis.postMessage({ job: data.job, result: searchFrom(data.ctx, data.state) });
};
