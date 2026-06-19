/**
 * The GitCade storage bridge: the only sanctioned persistence path for
 * ecosystem-tier games. Exports the wire protocol (so the platform web host
 * implements the parent side against it), the production {@link BridgeStorage} adapter, and the
 * {@link MemoryStorage}/{@link FileStorage} dev-shims used by `npm run dev` and
 * headless tests.
 */
export * from "./protocol.js";
export * from "./adapters.js";
export * from "./bridge.js";
