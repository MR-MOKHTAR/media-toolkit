/**
 * The version this build was made from, or "" when nothing defined one.
 *
 * Vite replaces `__APP_VERSION__` with a string literal at build time. The
 * design-sync previews compile these components without Vite, and reading an
 * undeclared global throws -- asking for its type does not, which is the whole
 * reason for the `typeof`.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
