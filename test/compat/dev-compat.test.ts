import { describe, expect, it, vi } from 'vitest';
import {
  AsyncObserver,
  ComputeObserver,
  Observer,
  computed,
  effect,
  isObservable,
  observable,
  watch,
} from '../../src/index';
import { Signal } from '../../src/core/internal';
import type { ObserverCallback } from '../../src/index';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('dev: compat Observer', () => {
  it('is a Signal and works with the v1 API', () => {
    const o = new Observer(1);
    expect(o).toBeInstanceOf(Observer);
    expect(o).toBeInstanceOf(Signal);
    expect(isObservable(o)).toBe(true);
    const d = computed(() => o.value * 2);
    const seen: number[] = [];
    effect(() => {
      seen.push(o.get());
    });
    o.value = 2;
    o.update((x) => x + 1);
    expect(d.value).toBe(6);
    expect(o.peek()).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
    const w = vi.fn();
    watch(o, w);
    o.set(4);
    expect(w).toHaveBeenCalledTimes(1);
  });

  it('set(fn) is an updater (documented semantic change); set(() => fn) stores fn', () => {
    const o = new Observer<number>(1);
    o.set((p) => p + 10);
    expect(o.get()).toBe(11);
    const f = () => 42;
    const of = new Observer<() => number>(() => 0);
    of.set(() => f);
    expect(of.get()).toBe(f);
  });

  it('subscribe returns an unsubscribe fn; ObserverCallback type fits', () => {
    const o = new Observer('a');
    const cb: ObserverCallback<string> = vi.fn();
    const off = o.subscribe(cb);
    expect(typeof off).toBe('function');
    o.set('b');
    off();
    o.set('c');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('b', 'a');
  });

  it('Observer is the core class: observable() instanceof Observer', () => {
    expect(Observer).toBe(Signal);
    expect(observable(1)).toBeInstanceOf(Observer);
    const o: Observer<number> = observable(1) as Observer<number>;
    expect(o.get()).toBe(1);
  });
});

describe('dev: compat ComputeObserver', () => {
  it('update() re-reads non-reactive inputs and notifies when changed', () => {
    let base = 10;
    const c = new ComputeObserver(() => base * 2);
    const cb = vi.fn();
    c.subscribe(cb);
    base++;
    expect(c.get()).toBe(20); // legacy: cached until update()
    c.update();
    expect(c.get()).toBe(22);
    expect(cb).toHaveBeenCalledWith(22, 20);
    c.update();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('update() works without subscribers too', () => {
    let base = 1;
    const c = new ComputeObserver(() => base);
    base = 5;
    expect(c.get()).toBe(1);
    c.update();
    expect(c.get()).toBe(5);
  });

  it('evaluates eagerly on construction', () => {
    let base = 1;
    const fn = vi.fn(() => base);
    const c = new ComputeObserver(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    base = 2;
    expect(c.get()).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('auto-tracks observables', () => {
    const a = new Observer(1);
    const b = observable(2);
    const c = new ComputeObserver(() => a.get() + b.value);
    const cb = vi.fn();
    c.subscribe(cb);
    a.set(10);
    expect(cb).toHaveBeenLastCalledWith(12, 3);
    b.set(5);
    expect(cb).toHaveBeenLastCalledWith(15, 12);
    expect(c.get()).toBe(15);
    const seen: number[] = [];
    effect(() => {
      seen.push(c.value);
    });
    a.set(0);
    expect(seen).toEqual([15, 5]);
  });

  it('errors are cached and rethrown by get()', () => {
    const c = new ComputeObserver<number>(() => {
      throw new Error('boom');
    });
    expect(() => c.get()).toThrow('boom');
  });

  it('is an observable usable as computed source', () => {
    const c = new ComputeObserver(() => 3);
    expect(isObservable(c)).toBe(true);
    expect(computed(() => c.value + 1).value).toBe(4);
  });
});

describe('dev: compat AsyncObserver', () => {
  it('value null until resolved, then set + subscribers notified', async () => {
    const a = new AsyncObserver(Promise.resolve(5));
    expect(a.get()).toBeNull();
    const cb = vi.fn();
    a.subscribe(cb);
    await tick();
    expect(a.get()).toBe(5);
    expect(cb).toHaveBeenCalledWith(5, null);
  });

  it('promise() resolves immediately when already resolved (legacy hung)', async () => {
    const a = new AsyncObserver(Promise.resolve('x'));
    await tick();
    await expect(a.promise()).resolves.toBe('x');
  });

  it('rejection: no unhandled rejection, value stays null, promise() rejects', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const err = new Error('nope');
      const a = new AsyncObserver<number>(Promise.reject(err));
      const p = a.promise(); // before settle
      await expect(p).rejects.toBe(err);
      await tick();
      expect(a.get()).toBeNull();
      expect(a.error).toBe(err);
      await expect(a.promise()).rejects.toBe(err); // after settle
      await tick();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('stores function values verbatim (no updater call)', async () => {
    const fn = () => 1;
    const a = new AsyncObserver(Promise.resolve(fn));
    await expect(a.promise()).resolves.toBe(fn);
    expect(a.get()).toBe(fn);
  });

  it('promise() resolves on a manual set before resolution', async () => {
    let res!: (v: number) => void;
    const a = new AsyncObserver(new Promise<number>((r) => (res = r)));
    const p = a.promise();
    a.set(7);
    await expect(p).resolves.toBe(7);
    res(8);
    await tick();
    expect(a.get()).toBe(8);
  });

  it('is reactive in effects', async () => {
    const a = new AsyncObserver(Promise.resolve(1));
    const seen: (number | null)[] = [];
    effect(() => {
      seen.push(a.value);
    });
    await tick();
    expect(seen).toEqual([null, 1]);
  });
});

describe('dev regressions: AsyncObserver', () => {
  it('subscriber throwing on resolve → reportError, not an unhandled rejection', async () => {
    const g = globalThis as { reportError?: (e: unknown) => void };
    const saved = g.reportError;
    const reported = vi.fn<(e: unknown) => void>();
    g.reportError = reported;
    const unhandled = vi.fn<(reason: unknown) => void>();
    process.on('unhandledRejection', unhandled);
    try {
      const a = new AsyncObserver(Promise.resolve(1));
      const boom = new Error('sub boom');
      a.subscribe(() => {
        throw boom;
      });
      await expect(a.promise()).resolves.toBe(1);
      await tick();
      expect(a.get()).toBe(1);
      expect(reported).toHaveBeenCalledWith(boom);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      g.reportError = saved;
    }
  });
});
