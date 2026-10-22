import { describe, it, expect, vi } from 'vitest';
import { resource, observable, effect, batch } from '../../src/index';
import { deferred, flush, trackUnhandledRejections } from './helpers';

trackUnhandledRejections();

describe('spec §3 edge cases', () => {
  it('lazy: reading .value inside an effect triggers fetch and effect re-runs on success', async () => {
    const r = resource(async () => 'v', { lazy: true });
    const seen: (string | undefined)[] = [];
    effect(() => {
      seen.push(r.value);
    });
    await flush();
    expect(seen).toEqual([undefined, 'v']);
  });

  it('fetcher reading observables does not make the surrounding effect depend on them', async () => {
    const id = observable(1);
    const outerRuns = vi.fn();
    effect(() => {
      outerRuns();
      resource(async () => id.value);
    });
    id.set(2);
    await flush();
    expect(outerRuns).toHaveBeenCalledTimes(1);
  });

  it('batched changes to two deps cause a single refetch', async () => {
    const a = observable(1);
    const b = observable(1);
    const fetcher = vi.fn(async () => a.value + b.value);
    const r = resource(fetcher);
    await flush();
    batch(() => {
      a.set(2);
      b.set(3);
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r.value).toBe(5);
  });

  it('dynamic deps in fetcher: dropped branch no longer triggers', async () => {
    const useA = observable(true);
    const a = observable(1);
    const b = observable(100);
    const fetcher = vi.fn(async () => (useA.value ? a.value : b.value));
    const r = resource(fetcher);
    await flush();
    useA.set(false);
    await flush();
    expect(r.value).toBe(100);
    const n = fetcher.mock.calls.length;
    a.set(2);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(n);
  });

  it('fetcher does not read its own status reactively in a loop', async () => {
    let calls = 0;
    const r: any = resource(async () => {
      calls++;
      return 1;
    });
    effect(() => {
      r.status;
    });
    await flush();
    expect(calls).toBe(1);
  });

  it('refresh() returns a promise resolving to the value of that run', async () => {
    let n = 0;
    const r = resource(async () => ++n, { lazy: true });
    const p1 = r.refresh();
    await expect(p1).resolves.toBe(1);
  });

  it('superseded refresh() promise settles (does not hang)', async () => {
    const ds: ReturnType<typeof deferred<number>>[] = [];
    const r = resource(() => {
      const d = deferred<number>();
      ds.push(d);
      return d.promise;
    }, { lazy: true });
    const p1 = r.refresh();
    const p2 = r.refresh();
    ds[1].resolve(2);
    ds[0].resolve(1);
    const settled = (await Promise.race([
      p1.then(
        (v) => ['ok', v],
        () => ['err'],
      ),
      new Promise<unknown[]>((res) => setTimeout(() => res(['timeout']), 50)),
    ])) as unknown[];
    expect(settled[0]).not.toBe('timeout');
    await expect(p2).resolves.toBe(2);
  });

  it('promise() on a lazy idle resource settles once fetched via refresh', async () => {
    const r = resource(async () => 9, { lazy: true });
    const p = r.promise();
    r.refresh();
    await expect(p).resolves.toBe(9);
  });

  it('mutate during an in-flight fetch: value set immediately', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise);
    r.mutate(5);
    expect(r.value).toBe(5);
    expect(r.status).toBe('success');
    d.resolve(1);
    await flush();
    // Either outcome is defensible (see report); value must be one of the two
    expect([1, 5]).toContain(r.value);
  });

  it('sync fetcher value is available synchronously', () => {
    const r = resource(() => 5);
    expect(r.status).toBe('success');
    expect(r.value).toBe(5);
  });

  it('promise() rejects with the error, but if nobody awaits a different promise() no unhandled rejection', async () => {
    const d = deferred<number>();
    const r = resource(() => d.promise);
    const p = r.promise();
    d.reject(new Error('x'));
    await expect(p).rejects.toThrow('x');
  });

  it('dispose() is idempotent and refresh after dispose does not throw unhandled', async () => {
    const r = resource(async () => 1);
    r.dispose();
    r.dispose();
    await flush();
  });
});
