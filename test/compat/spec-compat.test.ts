import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  Observer,
  ComputeObserver,
  AsyncObserver,
  deepObserver,
  observable,
  computed,
  effect,
  isObservable,
  isStore,
  batch,
} from '../../src/index';
import type { ObserverCallback, ObserverSubscription } from '../../src/index';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

describe('compat: Observer (legacy semantics)', () => {
  it('initializes with value', () => {
    expect(new Observer<number>(10).get()).toBe(10);
  });

  it('notifies (new, old) on change', () => {
    const o = new Observer<number>(10);
    const cb = vi.fn();
    o.subscribe(cb);
    o.set(20);
    expect(cb).toHaveBeenCalledWith(20, 10);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('no notification when value unchanged', () => {
    const o = new Observer(10);
    const cb = vi.fn();
    o.subscribe(cb);
    o.set(10);
    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe', () => {
    const o = new Observer(10);
    const cb = vi.fn();
    const un = o.subscribe(cb);
    o.set(20);
    un();
    o.set(30);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('strings, arrays, objects (reference inequality notifies)', () => {
    const s = new Observer('hello');
    const cs = vi.fn();
    s.subscribe(cs);
    s.set('world');
    expect(cs).toHaveBeenCalledWith('world', 'hello');

    const a = new Observer<number[]>([1, 2, 3]);
    const ca = vi.fn();
    a.subscribe(ca);
    a.set([1, 2, 3, 4]);
    expect(ca).toHaveBeenCalledWith([1, 2, 3, 4], [1, 2, 3]);

    const ob = new Observer({ name: 'Alice' });
    const co = vi.fn();
    ob.subscribe(co);
    ob.set({ name: 'Bob' });
    expect(co).toHaveBeenCalledWith({ name: 'Bob' }, { name: 'Alice' });
  });

  it('same object reference does not notify', () => {
    const obj = { a: 1 };
    const o = new Observer(obj);
    const cb = vi.fn();
    o.subscribe(cb);
    o.set(obj);
    expect(cb).not.toHaveBeenCalled();
  });

  it('instanceof Observer', () => {
    expect(new Observer(1)).toBeInstanceOf(Observer);
  });

  it('has the v1 Observable members', () => {
    const o = new Observer(1);
    expect(isObservable(o)).toBe(true);
    expect(o.value).toBe(1);
    expect(o.peek()).toBe(1);
    o.value = 2;
    expect(o.get()).toBe(2);
    o.update((p) => p + 1);
    expect(o.get()).toBe(3);
  });

  it('v1 semantic change: set(fn) is an updater', () => {
    const o = new Observer(1);
    o.set((p: number) => p + 10);
    expect(o.get()).toBe(11);
  });

  it('is auto-tracked by effect and computed', () => {
    const o = new Observer(1);
    const c = computed(() => o.get() * 2);
    const seen: number[] = [];
    effect(() => {
      seen.push(o.value);
    });
    o.set(5);
    expect(c.value).toBe(10);
    expect(seen).toEqual([1, 5]);
  });

  it('same function subscribed twice: independent subscriptions (v1)', () => {
    const o = new Observer(1);
    const cb = vi.fn();
    const u1 = o.subscribe(cb);
    o.subscribe(cb);
    o.set(2);
    expect(cb).toHaveBeenCalledTimes(2);
    u1();
    o.set(3);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('ideally observable() is an Observer', () => {
    // DESIGN: "ideally observable() returns the same underlying class" — soft check
    expect(observable(1) instanceof Observer).toBe(true);
  });
});

describe('compat: ComputeObserver (legacy semantics)', () => {
  it('initializes with computed value', () => {
    const fn = vi.fn(() => 10);
    const c = new ComputeObserver(fn);
    expect(c.get()).toBe(10);
  });

  it('update() recomputes and notifies (new, old) when changed (non-reactive closure)', () => {
    const fn = vi.fn(() => 10);
    const c = new ComputeObserver(fn);
    c.get();
    const cb = vi.fn();
    c.subscribe(cb);
    fn.mockReturnValueOnce(20);
    c.update();
    expect(cb).toHaveBeenCalledWith(20, 10);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('update() with a non-reactive closure variable', () => {
    let x = 1;
    const c = new ComputeObserver(() => x * 2);
    const cb = vi.fn();
    c.subscribe(cb);
    expect(c.get()).toBe(2);
    x = 5;
    c.update();
    expect(c.get()).toBe(10);
    expect(cb).toHaveBeenCalledWith(10, 2);
    x = 6;
    c.update();
    expect(c.get()).toBe(12);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('update() without subscribers still refreshes get()', () => {
    let x = 1;
    const c = new ComputeObserver(() => x);
    expect(c.get()).toBe(1);
    x = 2;
    c.update();
    expect(c.get()).toBe(2);
  });

  it('update() with unchanged value does not notify', () => {
    const c = new ComputeObserver(() => 10);
    const cb = vi.fn();
    c.subscribe(cb);
    c.update();
    expect(cb).not.toHaveBeenCalled();
  });

  it('strings and arrays', () => {
    const fs = vi.fn(() => 'hello');
    const cs = new ComputeObserver(fs);
    const cbs = vi.fn();
    cs.subscribe(cbs);
    fs.mockReturnValueOnce('world');
    cs.update();
    expect(cbs).toHaveBeenCalledWith('world', 'hello');

    const fa = vi.fn(() => [1, 2, 3]);
    const ca = new ComputeObserver(fa);
    ca.get();
    const cba = vi.fn();
    ca.subscribe(cba);
    fa.mockReturnValueOnce([4, 5, 6]);
    ca.update();
    expect(cba).toHaveBeenCalledWith([4, 5, 6], [1, 2, 3]);
  });

  it('unsubscribe', () => {
    let x = 1;
    const c = new ComputeObserver(() => x);
    const cb = vi.fn();
    const un = c.subscribe(cb);
    un();
    x = 2;
    c.update();
    expect(cb).not.toHaveBeenCalled();
  });

  it('v1: auto-tracks observables read by fn', () => {
    const a = new Observer(1);
    const b = observable(2);
    const c = new ComputeObserver(() => a.get() + b.value);
    const cb = vi.fn();
    c.subscribe(cb);
    expect(c.get()).toBe(3);
    a.set(10);
    expect(c.get()).toBe(12);
    expect(cb).toHaveBeenCalledWith(12, 3);
    b.set(20);
    expect(cb).toHaveBeenLastCalledWith(30, 12);
  });

  it('v1: auto-tracks without subscribers (get() is fresh)', () => {
    const a = observable(1);
    const c = new ComputeObserver(() => a.value * 3);
    expect(c.get()).toBe(3);
    a.set(2);
    expect(c.get()).toBe(6);
  });

  it('v1: mixing reactive + non-reactive deps', () => {
    const a = observable(1);
    let k = 1;
    const c = new ComputeObserver(() => a.value * k);
    const cb = vi.fn();
    c.subscribe(cb);
    k = 10;
    c.update();
    expect(c.get()).toBe(10);
    a.set(2);
    expect(c.get()).toBe(20);
    expect(cb.mock.calls).toEqual([
      [10, 1],
      [20, 10],
    ]);
  });

  it('v1: is usable as a ReadonlyObservable in effects', () => {
    let x = 1;
    const c = new ComputeObserver(() => x);
    const seen: number[] = [];
    effect(() => {
      seen.push(c.get());
    });
    x = 2;
    c.update();
    expect(seen).toEqual([1, 2]);
  });
});

describe('compat: AsyncObserver', () => {
  const unhandled: unknown[] = [];
  const h = (r: unknown) => unhandled.push(r);
  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', h);
  });
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 5));
    process.off('unhandledRejection', h);
    expect(unhandled).toEqual([]);
  });

  it('value is null until resolved', async () => {
    let resolve!: (v: number) => void;
    const ao = new AsyncObserver(new Promise<number>((r) => (resolve = r)));
    expect(ao.get()).toBeNull();
    resolve(5);
    await flush();
    expect(ao.get()).toBe(5);
  });

  it('extends Observer', () => {
    const ao = new AsyncObserver(Promise.resolve(1));
    expect(ao).toBeInstanceOf(Observer);
    expect(ao).toBeInstanceOf(AsyncObserver);
  });

  it('promise() resolves with value (number/string/array)', async () => {
    expect(await new AsyncObserver(Promise.resolve(10)).promise()).toBe(10);
    expect(await new AsyncObserver(Promise.resolve('hello')).promise()).toBe('hello');
    expect(await new AsyncObserver(Promise.resolve([1, 2, 3])).promise()).toEqual([1, 2, 3]);
  });

  it('subscribers are notified with (value, null)', async () => {
    const ao = new AsyncObserver(Promise.resolve(7));
    const cb = vi.fn();
    ao.subscribe(cb);
    await flush();
    expect(cb).toHaveBeenCalledWith(7, null);
  });

  it('v1 fix: promise() after resolution resolves immediately', async () => {
    const ao = new AsyncObserver(Promise.resolve('x'));
    await flush();
    expect(ao.get()).toBe('x');
    const res = await Promise.race([
      ao.promise(),
      new Promise((r) => setTimeout(() => r('timeout'), 50)),
    ]);
    expect(res).toBe('x');
  });

  it('v1 fix: rejection does not crash (no unhandled rejection), value stays null', async () => {
    const ao = new AsyncObserver<number>(Promise.reject(new Error('nope')));
    await flush();
    expect(ao.get()).toBeNull();
  });

  it('promise() on a rejected AsyncObserver settles (rejects) rather than hanging', async () => {
    const ao = new AsyncObserver<number>(Promise.reject(new Error('nope')));
    const res = await Promise.race([
      ao.promise().then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise((r) => setTimeout(() => r('timeout'), 50)),
    ]);
    expect(res).toBe('rejected');
  });

  it('is tracked by effects', async () => {
    const ao = new AsyncObserver(Promise.resolve(3));
    const seen: (number | null)[] = [];
    effect(() => {
      seen.push(ao.value);
    });
    await flush();
    expect(seen).toEqual([null, 3]);
  });
});

describe('compat: deepObserver', () => {
  it('legacy: tracks property change, cb(new, old)', () => {
    const cb = vi.fn();
    const { observer } = deepObserver({ name: 'John', age: 30 }, cb);
    observer.name = 'Doe';
    expect(cb).toHaveBeenCalledWith({ name: 'Doe', age: 30 }, { name: 'John', age: 30 });
  });

  it('legacy: unsubscribe', () => {
    const cb = vi.fn();
    const { observer, unsubscribe } = deepObserver({ name: 'John', age: 30 }, cb);
    unsubscribe();
    observer.age = 31;
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it('legacy: array elements', () => {
    const cb = vi.fn();
    const { observer } = deepObserver([1, 2, 3], cb);
    observer[0] = 4;
    expect(cb).toHaveBeenCalledWith([4, 2, 3], [1, 2, 3]);
  });

  it('nested property change notifies once with root snapshots (v1: cb(newSnapshot, prevSnapshot))', () => {
    const cb = vi.fn();
    const { observer } = deepObserver({ level1: { level2: { count: 0 } } }, cb);
    observer.level1.level2.count = 1;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toEqual({ level1: { level2: { count: 1 } } });
    expect(cb.mock.calls[0][1]).toEqual({ level1: { level2: { count: 0 } } });
  });

  it('prev snapshot is not mutated by later changes', () => {
    const cb = vi.fn();
    const { observer } = deepObserver({ a: { b: 1 } }, cb);
    observer.a.b = 2;
    observer.a.b = 3;
    expect(cb.mock.calls[0][1]).toEqual({ a: { b: 1 } });
    expect(cb.mock.calls[0][0]).toEqual({ a: { b: 2 } });
    expect(cb.mock.calls[1][1]).toEqual({ a: { b: 2 } });
  });

  it('assigning a new object then mutating it notifies', () => {
    const cb = vi.fn();
    const { observer } = deepObserver<{ a: { b: number } }>({ a: { b: 1 } }, cb);
    observer.a = { b: 2 };
    observer.a.b = 3;
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0]).toEqual({ a: { b: 3 } });
  });

  it('observer is a store; reads are cached proxies', () => {
    const { observer } = deepObserver({ a: { b: 1 } }, () => {});
    expect(isStore(observer)).toBe(true);
    expect(observer.a).toBe(observer.a);
  });

  it('types ObserverCallback / ObserverSubscription are usable', () => {
    const cb: ObserverCallback<number> = (n, o) => void (n + o);
    const sub: ObserverSubscription<{ x: number }> = deepObserver({ x: 1 }, () => {});
    expect(typeof cb).toBe('function');
    expect(sub.observer.x).toBe(1);
  });
});

describe('compat: extra edges', () => {
  it('AsyncObserver: manual set() before resolution, then resolution overrides', async () => {
    let resolve!: (v: number) => void;
    const ao = new AsyncObserver(new Promise<number>((r) => (resolve = r)));
    ao.set(1);
    expect(ao.get()).toBe(1);
    resolve(2);
    await flush();
    expect(ao.get()).toBe(2);
  });

  it('AsyncObserver resolving to a function stores the function (not treated as updater)', async () => {
    const fn = () => 42;
    const ao = new AsyncObserver(Promise.resolve(fn));
    await flush();
    expect(ao.get()).toBe(fn);
  });

  it('Observer: unsubscribing inside a callback is safe', () => {
    const o = new Observer(0);
    const calls: string[] = [];
    let un1: () => void = () => {};
    un1 = o.subscribe(() => {
      calls.push('a');
      un1();
    });
    o.subscribe(() => calls.push('b'));
    o.set(1);
    o.set(2);
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('ComputeObserver: subscribers notified once per batch of tracked changes', () => {
    const a = observable(1);
    const b = observable(1);
    const c = new ComputeObserver(() => a.value + b.value);
    const cb = vi.fn();
    c.subscribe(cb);
    batch(() => {
      a.set(2);
      b.set(2);
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(4, 2);
  });
});
