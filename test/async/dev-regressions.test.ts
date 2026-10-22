import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effect, resource } from '../../src/index';

const tick = () => new Promise((r) => setTimeout(r, 0));
const g = globalThis as { reportError?: (e: unknown) => void };

let unhandled: ReturnType<typeof vi.fn<(reason: unknown) => void>>;
let reported: ReturnType<typeof vi.fn<(e: unknown) => void>>;
let saved: typeof g.reportError;
beforeEach(() => {
  unhandled = vi.fn<(reason: unknown) => void>();
  process.on('unhandledRejection', unhandled);
  saved = g.reportError;
  reported = vi.fn<(e: unknown) => void>();
  g.reportError = reported;
});
afterEach(async () => {
  await tick();
  process.off('unhandledRejection', unhandled);
  g.reportError = saved;
  expect(unhandled).not.toHaveBeenCalled();
});

describe('dev regressions: resource', () => {
  it('effect throwing during async success settle: refresh() settles, error reported', async () => {
    let resolve!: (v: number) => void;
    const r = resource(() => new Promise<number>((res) => (resolve = res)), { lazy: true });
    const p = r.refresh();
    const boom = new Error('effect boom');
    effect(() => {
      if (r.state.value.status === 'success') throw boom;
    });
    resolve(1);
    await expect(p).resolves.toBe(1);
    expect(r.status).toBe('success');
    expect(reported).toHaveBeenCalledWith(boom);
  });

  it('effect throwing during async error settle: refresh() rejects, error reported', async () => {
    let reject!: (e: unknown) => void;
    const r = resource(() => new Promise<number>((_, rej) => (reject = rej)), { lazy: true });
    const p = r.refresh();
    const boom = new Error('effect boom');
    effect(() => {
      if (r.status === 'error') throw boom;
    });
    const err = new Error('fetch');
    reject(err);
    await expect(p).rejects.toBe(err);
    expect(r.error).toBe(err);
    expect(reported).toHaveBeenCalledWith(boom);
  });

  it('sync fetcher: flush error rethrown to the caller, run still settled', async () => {
    const r = resource(() => 1, { lazy: true });
    effect(() => {
      if (r.status === 'success') throw new Error('sync boom');
    });
    expect(() => r.refresh()).toThrow('sync boom');
    expect(r.value).toBe(1);
    expect(reported).not.toHaveBeenCalled();
  });

  it('abort() rejects pending promise() with AbortError (no prior value)', async () => {
    const r = resource(() => new Promise<number>(() => {}));
    const p = r.promise();
    r.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(r.status).toBe('idle');
  });

  it('abort() during reload resolves pending promise() with the kept value', async () => {
    let n = 0;
    const r = resource(() => (n++ === 0 ? Promise.resolve(1) : new Promise<number>(() => {})));
    await r.promise();
    r.refresh();
    const p = r.promise();
    // status is 'loading' → p waits; abort restores 'success'
    r.abort();
    await expect(p).resolves.toBe(1);
  });

  it('dispose() during first load rejects pending promise() and later calls', async () => {
    const r = resource(() => new Promise<number>(() => {}));
    const p = r.promise();
    r.dispose();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(r.status).toBe('idle');
    await expect(r.promise()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('promise() starts a lazy resource; dispose() then rejects it with AbortError', async () => {
    const r = resource(() => new Promise<number>(() => {}), { lazy: true });
    const p = r.promise();
    expect(r.status).toBe('loading');
    r.dispose();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('promise() waiters do not leak state subscriptions', async () => {
    const r = resource(() => new Promise<number>(() => {}));
    const ps = [r.promise(), r.promise()];
    r.abort();
    await Promise.allSettled(ps);
    expect((r as unknown as { _waiters: Set<unknown> })._waiters.size).toBe(0);
    // state is no longer live (no subscribers): its link list is empty
    expect((r.state as unknown as { _targets: unknown })._targets).toBeUndefined();
  });
});
