/**
 * Report an error that has no synchronous caller to receive it (e.g. an effect/subscriber
 * throwing while a promise settles a resource). Uses the platform `reportError` when present
 * (browsers: fires `window.onerror`, doesn't break anything), otherwise rethrows in a
 * microtask so it surfaces as an ordinary uncaught error — never as an unhandled rejection
 * of an internal promise.
 */
export function reportError(e: unknown): void {
  const r = (globalThis as { reportError?: (e: unknown) => void }).reportError;
  if (typeof r === 'function') r(e);
  else
    queueMicrotask(() => {
      throw e;
    });
}

/** Run `fn`; route anything it throws to `reportError`. */
export function guard(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    reportError(e);
  }
}
