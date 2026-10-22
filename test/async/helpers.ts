import { afterEach, beforeEach, expect } from 'vitest';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush microtasks + one macrotask turn. */
export const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

export async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await tick();
}

/** Installs an unhandledRejection collector for each test and asserts none occurred. */
export function trackUnhandledRejections() {
  const seen: unknown[] = [];
  const handler = (reason: unknown) => {
    seen.push(reason);
  };
  beforeEach(() => {
    seen.length = 0;
    process.on('unhandledRejection', handler);
  });
  afterEach(async () => {
    await tick(5);
    process.off('unhandledRejection', handler);
    expect(seen, 'unhandled rejections').toEqual([]);
  });
  return seen;
}
