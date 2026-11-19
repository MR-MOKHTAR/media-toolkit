/// <reference types="vite/client" />

/** The app's version, from package.json at build time -- see vite.config.ts.
 *  Possibly undefined because not every bundle defines it: the design-sync
 *  build compiles these components without Vite. Read it through
 *  `lib/appVersion`, which checks. */
declare const __APP_VERSION__: string | undefined;
