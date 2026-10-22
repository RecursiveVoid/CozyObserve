import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, effect, observable, resource } from '../../src/index';

const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let unhandled: ReturnType<typeof vi.fn<(reason: unknown) => void>>;
beforeEach(() => {
  unhandled = vi.fn<(reason: unknown) => void>();
  process.on('unhandledRejection', unhandled);
});
afterEach(async () => {
  await tick();
  process.off('unhandledRejection', unhandled);
  expect(unhandled).not.toHaveBeenCalled();
});

describe('dev: resource basics', () => {
  it('loading → success', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise);
    expect(r.status).toBe('loading');
    expect(r.loading).toBe(true);
    expect(r.value).toBeUndefined();
    d.resolve(3);
    await tick();
    expect(r.status).toBe('success');
    expect(r.loading).toBe(false);
    expect(r.value).toBe(3);
    expect(r.error).toBeUndefined();
  });

  it('accepts a plain promise', async () => {
    const r = resource(Promise.resolve('hi'));
    await expect(r.promise()).resolves.toBe('hi');
    expect(r.status).toBe('success');
  });

  it('error stored, no unhandled rejection; promise() rejects', async () => {
    const err = new Error('x');
    const r = resource(() => Promise.reject(err));
    const p = r.promise();
    await expect(p).rejects.toBe(err);
    expect(r.status).toBe('error');
    expect(r.error).toBe(err);
    await expect(r.promise()).rejects.toBe(err);
  });

  it('plain rejected promise does not surface as unhandled', async () => {
    const r = resource(Promise.reject(new Error('y')));
    await tick();
    expect(r.status).toBe('error');
  });

  it('sync fetchers: value and throw', () => {
    const r = resource(() => 5);
    expect(r.status).toBe('success');
    expect(r.value).toBe(5);
    const e = new Error('sync');
    const r2 = resource<number>(() => {
      throw e;
    });
    expect(r2.status).toBe('error');
    expect(r2.error).toBe(e);
  });

  it('initial: status loading with value=initial while first fetch runs', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise, { initial: 1 });
    expect(r.status).toBe('loading');
    expect(r.value).toBe(1);
    d.resolve(2);
    await tick();
    expect(r.value).toBe(2);
  });

  it('lazy: idle until value read', async () => {
    const fetcher = vi.fn(async () => 9);
    const r = resource(fetcher, { lazy: true });
    expect(r.status).toBe('idle');
    expect(r.loading).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.value).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('loading');
    void r.value;
    expect(fetcher).toHaveBeenCalledTimes(1);
    await tick();
    expect(r.value).toBe(9);
  });

  it('lazy: refresh() and promise() start it', async () => {
    const r = resource(async () => 1, { lazy: true });
    await expect(r.refresh()).resolves.toBe(1);
    const r2 = resource(async () => 2, { lazy: true });
    await expect(r2.promise()).resolves.toBe(2);
  });

  it('lazy read inside a computed does not throw', async () => {
    const r = resource(async () => 4, { lazy: true });
    const c = computed(() => r.value ?? -1);
    expect(c.value).toBe(-1);
    await tick();
    expect(c.value).toBe(4);
  });

  it('ctx.prev is the last successful value', async () => {
    const prevs: unknown[] = [];
    const r = resource<number>(({ prev }) => {
      prevs.push(prev);
      return (prev ?? 0) + 1;
    });
    await r.refresh();
    await r.refresh();
    expect(prevs).toEqual([undefined, 1, 2]);
    expect(r.value).toBe(3);
  });
});

describe('dev: resource tracking + races', () => {
  it('re-fetches when a dep read before the first await changes; aborts previous', async () => {
    const id = observable(1);
    const signals: AbortSignal[] = [];
    const ds: ReturnType<typeof deferred<string>>[] = [];
    const after = observable(0);
    const r = resource(async ({ signal }) => {
      const v = id.value;
      signals.push(signal);
      const d = deferred<string>();
      ds.push(d);
      const res = await d.promise;
      after.value; // read after await: NOT tracked
      return `${v}:${res}`;
    });
    expect(ds.length).toBe(1);
    id.set(2);
    expect(ds.length).toBe(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    // stale resolves later — ignored
    ds[1].resolve('b');
    await tick();
    expect(r.value).toBe('2:b');
    ds[0].resolve('a');
    await tick();
    expect(r.value).toBe('2:b');
    after.set(1);
    expect(ds.length).toBe(2);
  });

  it('stale rejection is ignored and not unhandled', async () => {
    const id = observable(1);
    const ds: ReturnType<typeof deferred<number>>[] = [];
    const r = resource(() => {
      id.value;
      const d = deferred<number>();
      ds.push(d);
      return d.promise;
    });
    id.set(2);
    ds[0].reject(new Error('stale'));
    await tick();
    expect(r.status).toBe('loading');
    ds[1].resolve(2);
    await tick();
    expect(r.status).toBe('success');
    expect(r.error).toBeUndefined();
  });

  it('superseded refresh() promise follows the latest run', async () => {
    const ds: ReturnType<typeof deferred<number>>[] = [];
    const r = resource(() => {
      const d = deferred<number>();
      ds.push(d);
      return d.promise;
    });
    const p1 = r.refresh();
    const p2 = r.refresh();
    ds[1].resolve(1);
    ds[2].resolve(2);
    await expect(p1).resolves.toBe(2);
    await expect(p2).resolves.toBe(2);
    expect(r.value).toBe(2);
  });

  it('refresh() rejects on error but ignoring it is safe', async () => {
    let fail = false;
    const r = resource(async () => {
      if (fail) throw new Error('f');
      return 1;
    });
    await tick();
    fail = true;
    r.refresh(); // ignored
    await expect(r.refresh()).rejects.toThrow('f');
    expect(r.value).toBe(1); // last good value kept
    expect(r.status).toBe('error');
  });

  it('effects see status transitions; one notification per sync settle', async () => {
    const r = resource(() => 1, { lazy: true });
    const seen: string[] = [];
    effect(() => {
      seen.push(r.status);
    });
    r.refresh();
    expect(seen).toEqual(['idle', 'success']);
  });

  it('state: stable identity, updates on change', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise);
    const s1 = r.state.value;
    expect(r.state.value).toBe(s1);
    expect(s1).toEqual({ status: 'loading', value: undefined, error: undefined });
    const cb = vi.fn();
    r.state.subscribe(cb);
    d.resolve(1);
    await tick();
    expect(cb).toHaveBeenCalledTimes(1);
    const s2 = r.state.value;
    expect(s2).toEqual({ status: 'success', value: 1, error: undefined });
    expect(r.state.value).toBe(s2);
  });
});

describe('dev: resource mutate / abort / dispose', () => {
  it('mutate sets success and aborts in-flight', async () => {
    const d = deferred<number>();
    let sig!: AbortSignal;
    const r = resource(({ signal }) => {
      sig = signal;
      return d.promise;
    });
    r.mutate(5);
    const typed: number | undefined = r.value; // T inferred from fetcher result
    expect(typed).toBe(5);
    expect(sig.aborted).toBe(true);
    expect(r.status).toBe('success');
    expect(r.value).toBe(5);
    d.resolve(1);
    await tick();
    expect(r.value).toBe(5);
    r.mutate((p) => (p ?? 0) + 1);
    expect(r.value).toBe(6);
  });

  it('abort restores previous status and ignores the result', async () => {
    const ds: ReturnType<typeof deferred<number>>[] = [];
    const r = resource(() => {
      const d = deferred<number>();
      ds.push(d);
      return d.promise;
    });
    r.abort();
    expect(r.status).toBe('idle');
    ds[0].resolve(1);
    await tick();
    expect(r.value).toBeUndefined();
    const p = r.refresh();
    ds[1].resolve(2);
    await p;
    r.refresh();
    expect(r.status).toBe('loading');
    r.abort();
    expect(r.status).toBe('success');
    expect(r.value).toBe(2);
  });

  it('dispose aborts in-flight and stops tracking', async () => {
    const id = observable(1);
    const fetcher = vi.fn(({ signal }: { signal: AbortSignal }) => {
      id.value;
      return new Promise<number>((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
    });
    const r = resource(fetcher);
    const sig = fetcher.mock.calls[0][0].signal;
    r.dispose();
    expect(sig.aborted).toBe(true);
    id.set(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await tick();
    expect(r.status).toBe('idle');
    await expect(r.refresh()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('promise() resolves now when success, waits while loading', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise);
    const p = r.promise();
    d.resolve(8);
    await expect(p).resolves.toBe(8);
    await expect(r.promise()).resolves.toBe(8);
  });

  it('created inside an effect is not owned by it', async () => {
    const trigger = observable(0);
    const dep = observable(1);
    let r!: ReturnType<typeof resource<number>>;
    const fetcher = vi.fn(() => dep.value);
    const stop = effect(() => {
      if (trigger.peek() === 0) r = resource(fetcher);
      trigger.value;
    });
    trigger.set(1);
    stop();
    dep.set(2);
    expect(r.value).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
