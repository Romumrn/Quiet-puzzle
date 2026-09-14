/**
 * Bridge to the native shell.
 *
 * `Capacitor` resolves the same way on the published web site and inside the
 * packaged Android app — on the web build it simply reports `isNativePlatform()
 * === false`, so every module that imports from here can branch safely
 * without knowing which build it is running in.
 */

import { Capacitor } from '../../vendor/capacitor-core.esm.js';

export { Capacitor };

/** True only inside the packaged app — false on the published web site. */
export const isNative = () => Capacitor.isNativePlatform();
