import { describe, it, expect, vi } from 'vitest';
import { resource, observable, effect, isObservable } from '../../src/index';
import { deferred, flush, tick, trackUnhandledRejections } from './helpers';

trackUnhandledRejections();

describe('spec §3: resource status transitions', () => {
  it('loading → success', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise);
    expect(r.status).toBe('loading');
    expect(r.loading).toBe(true);
    expect(r.value).toBeUndefined();
    d.resolve(42);
    await flush();
    expect(r.status).toBe('success');
    expect(r.loading).toBe(false);
    expect(r.value).toBe(42);
    expect(r.error).toBeUndefined();
  });

  it('loading → error', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise);
    const err = new Error('nope');
    d.reject(err);
    await flush();
    expect(r.status).toBe('error');
    expect(r.error).toBe(err);
    expect(r.loading).toBe(false);
    expect(r.value).toBeUndefined();
  });

  it('fetcher that throws synchronously → error, no crash', async () => {
    const r = resource((): number => {
      throw new Error('sync boom');
    });
    await flush();
    expect(r.status).toBe('error');
    expect((r.error as Error).message).toBe('sync boom');
  });

  it('value is kept while reloading, and after an error', async () => {
    let d = deferred<number>();
    const r = resource(() => d.promise);
    d.resolve(1);
    await flush();
    expect(r.value).toBe(1);

    d = deferred<number>();
    const p = r.refresh();
    expect(r.status).toBe('loading');
    expect(r.loading).toBe(true);
    expect(r.value).toBe(1);
    d.reject(new Error('x'));
    await p.catch(() => {});
    await flush();
    expect(r.status).toBe('error');
    expect(r.value).toBe(1);
  });

  it('error is cleared after a later success', async () => {
    let d = deferred<number>();
    const r = resource(() => d.promise);
    d.reject(new Error('x'));
    await flush();
    expect(r.status).toBe('error');
    d = deferred<number>();
    r.refresh();
    d.resolve(2);
    await flush();
    expect(r.status).toBe('success');
    expect(r.error).toBeUndefined();
    expect(r.value).toBe(2);
  });

  it('status/value/error/loading are tracked by effects', async () => {
    const d = deferred<string>();
    const r = resource(() => d.promise);
    const seen: string[] = [];
    effect(() => {
      seen.push(`${r.status}:${r.loading}:${r.value}`);
    });
    d.resolve('ok');
    await flush();
    expect(seen[0]).toBe('loading:true:undefined');
    expect(seen[seen.length - 1]).toBe('success:false:ok');
  });

  it('state observable mirrors status/value/error', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise);
    expect(isObservable(r.state)).toBe(true);
    expect(r.state.value.status).toBe('loading');
    const cb = vi.fn();
    r.state.subscribe(cb);
    d.resolve(7);
    await flush();
    expect(r.state.value).toEqual({ status: 'success', value: 7, error: undefined });
    expect(cb).toHaveBeenCalled();
  });

  it('ctx.prev is the last successful value', async () => {
    const prevs: (number | undefined)[] = [];
    let n = 0;
    const r = resource<number>(async ({ prev }) => {
      prevs.push(prev);
      return ++n;
    });
    await flush();
    await r.refresh();
    await flush();
    expect(prevs).toEqual([undefined, 1]);
    expect(r.value).toBe(2);
  });

  it('ctx.signal is an AbortSignal', async () => {
    let sig: AbortSignal | undefined;
    resource(async ({ signal }) => {
      sig = signal;
      return 1;
    });
    expect(sig).toBeInstanceOf(AbortSignal);
    expect(sig!.aborted).toBe(false);
  });
});

describe('spec §3: auto-tracked fetcher', () => {
  it('re-fetches when an observable read synchronously changes', async () => {
    const id = observable(1);
    const fetcher = vi.fn(async ({}: { signal: AbortSignal }) => `user${id.value}`);
    const r = resource(fetcher);
    await flush();
    expect(r.value).toBe('user1');
    id.set(2);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r.value).toBe('user2');
  });

  it('does not re-fetch on unrelated observable changes', async () => {
    const id = observable(1);
    const other = observable(0);
    const fetcher = vi.fn(async () => id.value);
    resource(fetcher);
    await flush();
    other.set(1);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('observables read after the first await are not tracked', async () => {
    const before = observable(1);
    const after = observable(1);
    const fetcher = vi.fn(async () => {
      const b = before.value;
      await Promise.resolve();
      return b + after.value;
    });
    resource(fetcher);
    await flush();
    after.set(2);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    before.set(2);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('re-fetch aborts the previous run signal', async () => {
    const id = observable(1);
    const signals: AbortSignal[] = [];
    resource(({ signal }) => {
      id.value;
      signals.push(signal);
      return new Promise<number>(() => {});
    });
    id.set(2);
    await flush();
    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('refresh() aborts the previous run signal', async () => {
    const signals: AbortSignal[] = [];
    const r = resource(({ signal }) => {
      signals.push(signal);
      return new Promise<number>(() => {});
    });
    r.refresh();
    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(true);
  });
});

describe('spec §3: race protection', () => {
  it('slow first + fast second → final value from second even if first resolves later', async () => {
    const id = observable(1);
    const ds = new Map<number, ReturnType<typeof deferred<string>>>();
    const r = resource(() => {
      const d = deferred<string>();
      ds.set(id.value, d);
      return d.promise;
    });
    id.set(2);
    await flush();
    ds.get(2)!.resolve('second');
    await flush();
    expect(r.value).toBe('second');
    expect(r.status).toBe('success');
    ds.get(1)!.resolve('first');
    await flush();
    expect(r.value).toBe('second');
    expect(r.status).toBe('success');
  });

  it('stale rejection does not surface', async () => {
    const calls: ReturnType<typeof deferred<string>>[] = [];
    const r = resource(() => {
      const d = deferred<string>();
      calls.push(d);
      return d.promise;
    });
    r.refresh();
    calls[1].resolve('fresh');
    await flush();
    calls[0].reject(new Error('stale'));
    await flush();
    expect(r.status).toBe('success');
    expect(r.error).toBeUndefined();
    expect(r.value).toBe('fresh');
  });

  it('stale result while second still pending: stays loading, no value change', async () => {
    const calls: ReturnType<typeof deferred<string>>[] = [];
    const r = resource(() => {
      const d = deferred<string>();
      calls.push(d);
      return d.promise;
    });
    r.refresh();
    calls[0].resolve('stale');
    await flush();
    expect(r.value).toBeUndefined();
    expect(r.status).toBe('loading');
    calls[1].resolve('fresh');
    await flush();
    expect(r.value).toBe('fresh');
  });

  it('AbortError rejection from the aborted run is swallowed', async () => {
    const calls: number[] = [];
    const r = resource(({ signal }) => {
      calls.push(calls.length);
      return new Promise<number>((resolve, reject) => {
        const n = calls.length;
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        if (n === 2) setTimeout(() => resolve(2), 1);
      });
    });
    r.refresh();
    await tick(10);
    await flush();
    expect(r.status).toBe('success');
    expect(r.value).toBe(2);
  });
});

describe('spec §3: options', () => {
  it('lazy: idle, fetcher not called until refresh()', async () => {
    const fetcher = vi.fn(async () => 1);
    const r = resource(fetcher, { lazy: true });
    expect(r.status).toBe('idle');
    expect(r.loading).toBe(false);
    await flush();
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.status).toBe('idle');
    const v = await r.refresh();
    expect(v).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('success');
  });

  it('lazy: first read of .value triggers the fetch', async () => {
    const fetcher = vi.fn(async () => 'v');
    const r = resource(fetcher, { lazy: true });
    r.status; // reading status does not trigger
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.value).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await flush();
    expect(r.value).toBe('v');
    r.value;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('initial: value available immediately', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise, { initial: 10 });
    expect(r.value).toBe(10);
    d.resolve(11);
    await flush();
    expect(r.value).toBe(11);
  });

  it('initial with lazy: value available, status idle', () => {
    const r = resource(async () => 1, { initial: 5, lazy: true });
    expect(r.status).toBe('idle');
    // reading value triggers fetch but returns initial meanwhile
    expect(r.value).toBe(5);
  });
});

describe('spec §3: refresh / mutate / promise / abort / dispose', () => {
  it('refresh() re-runs the fetcher and resolves with the new value', async () => {
    let n = 0;
    const r = resource(async () => ++n);
    await flush();
    expect(r.value).toBe(1);
    await expect(r.refresh()).resolves.toBe(2);
    expect(r.value).toBe(2);
  });

  it('refresh() whose fetch errors does not produce an unhandled rejection', async () => {
    let fail = false;
    const r = resource(async () => {
      if (fail) throw new Error('fail');
      return 1;
    });
    await flush();
    fail = true;
    r.refresh(); // not awaited, not caught
    await flush();
    expect(r.status).toBe('error');
  });

  it('mutate(value) → status success with that value', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise);
    d.resolve(1);
    await flush();
    r.mutate(99);
    expect(r.value).toBe(99);
    expect(r.status).toBe('success');
  });

  it('mutate(fn) is an updater receiving prev', async () => {
    const r = resource(async () => 3);
    await flush();
    r.mutate((prev) => (prev ?? 0) * 2);
    expect(r.value).toBe(6);
  });

  it('mutate from error state → success, error cleared', async () => {
    const r = resource(async (): Promise<number> => {
      throw new Error('e');
    });
    await flush();
    expect(r.status).toBe('error');
    r.mutate(1);
    expect(r.status).toBe('success');
    expect(r.value).toBe(1);
  });

  it('mutate notifies effects', async () => {
    const r = resource(async () => 1);
    await flush();
    const seen: (number | undefined)[] = [];
    effect(() => {
      seen.push(r.value);
    });
    r.mutate(2);
    expect(seen).toEqual([1, 2]);
  });

  it('promise() resolves on next success', async () => {
    const d = deferred<string>();
    const r = resource(() => d.promise);
    const p = r.promise();
    d.resolve('done');
    await expect(p).resolves.toBe('done');
  });

  it('promise() resolves immediately if already success', async () => {
    const r = resource(async () => 'x');
    await flush();
    await expect(
      Promise.race([r.promise(), tick(20).then(() => 'timeout')]),
    ).resolves.toBe('x');
  });

  it('promise() rejects on error', async () => {
    const d = deferred<string>();
    const r = resource(() => d.promise);
    const p = r.promise();
    const err = new Error('bad');
    d.reject(err);
    await expect(p).rejects.toBe(err);
  });

  it('promise() during a reload after success resolves (with current or next value)', async () => {
    let d = deferred<number>();
    const r = resource(() => d.promise);
    d.resolve(1);
    await flush();
    d = deferred<number>();
    r.refresh();
    const p = r.promise();
    d.resolve(2);
    const v = await p;
    expect([1, 2]).toContain(v);
  });

  it('abort() aborts the in-flight signal', async () => {
    let sig!: AbortSignal;
    const r = resource(({ signal }) => {
      sig = signal;
      return new Promise<number>(() => {});
    });
    r.abort();
    expect(sig.aborted).toBe(true);
  });

  it('abort(): late resolution of the aborted run is ignored', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise);
    r.abort();
    d.resolve(1);
    await flush();
    expect(r.value).toBeUndefined();
    expect(r.status).not.toBe('success');
  });

  it('dispose() aborts in-flight and ignores its result', async () => {
    let sig!: AbortSignal;
    const d = deferred<number>();
    const r = resource(({ signal }) => {
      sig = signal;
      return d.promise;
    });
    r.dispose();
    expect(sig.aborted).toBe(true);
    d.resolve(5);
    await flush();
    expect(r.value).toBeUndefined();
  });

  it('dispose() stops tracking', async () => {
    const id = observable(1);
    const fetcher = vi.fn(async () => id.value);
    const r = resource(fetcher);
    await flush();
    r.dispose();
    id.set(2);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('dispose() on a pending resource with a later rejection: no unhandled rejection', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise);
    r.dispose();
    d.reject(new Error('after dispose'));
    await flush();
  });
});

describe('spec §3: input kinds', () => {
  it('plain Promise input', async () => {
    const d = deferred<number>();
    const r = resource(d.promise);
    expect(r.status).toBe('loading');
    d.resolve(3);
    await flush();
    expect(r.status).toBe('success');
    expect(r.value).toBe(3);
  });

  it('plain rejected Promise input → error, no unhandled rejection', async () => {
    const r = resource(Promise.reject(new Error('rej')));
    await flush();
    expect(r.status).toBe('error');
    expect((r.error as Error).message).toBe('rej');
  });

  it('sync fetcher returning a plain value → success', async () => {
    const r = resource(() => 5);
    await flush();
    expect(r.status).toBe('success');
    expect(r.value).toBe(5);
  });

  it('sync fetcher is auto-tracked', async () => {
    const a = observable(1);
    const r = resource(() => a.value * 10);
    await flush();
    expect(r.value).toBe(10);
    a.set(2);
    await flush();
    expect(r.value).toBe(20);
  });
});

describe('spec §3: no unhandled rejections', () => {
  it('rejected fetch with nobody listening', async () => {
    const r = resource(async (): Promise<number> => {
      throw new Error('silent');
    });
    await flush();
    expect(r.status).toBe('error');
  });

  it('rejections across multiple refreshes', async () => {
    const r = resource(async (): Promise<number> => {
      throw new Error('again');
    });
    r.refresh();
    r.refresh();
    await flush();
    expect(r.status).toBe('error');
  });

  it('resource created inside an effect is not disposed when the effect re-runs (§Resolved 1)', async () => {
    const trigger = observable(0);
    const fetcher = vi.fn(async () => 1);
    let r: ReturnType<typeof resource<number>> | undefined;
    effect(() => {
      trigger.value;
      if (!r) r = resource(fetcher);
    });
    await flush();
    trigger.set(1);
    await flush();
    expect(r!.value).toBe(1);
    await r!.refresh();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
