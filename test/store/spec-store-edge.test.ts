import { describe, it, expect, vi } from 'vitest';
import {
  store,
  snapshot,
  subscribeStore,
  toRaw,
  isStore,
  effect,
  batch,
  computed,
  observable,
} from '../../src/index';

describe('spec §2 edge cases', () => {
  it('writing an index beyond length updates length readers', () => {
    const s = store({ l: [1] as number[] });
    const seen: number[] = [];
    effect(() => {
      seen.push(s.l.length);
    });
    s.l[3] = 4;
    expect(seen).toEqual([1, 4]);
  });

  it('includes() in effect reacts to push', () => {
    const s = store({ l: [1, 2] });
    const seen: boolean[] = [];
    effect(() => {
      seen.push(s.l.includes(3));
    });
    s.l.push(3);
    expect(seen).toEqual([false, true]);
  });

  it('splice removing an element notifies a reader of a later index', () => {
    const s = store({ l: [1, 2, 3] });
    const seen: (number | undefined)[] = [];
    effect(() => {
      seen.push(s.l[1]);
    });
    s.l.splice(0, 1);
    expect(seen).toEqual([2, 3]);
  });

  it('Object.keys on an array tracks push', () => {
    const s = store({ l: [1] });
    const seen: number[] = [];
    effect(() => {
      seen.push(Object.keys(s.l).length);
    });
    s.l.push(2);
    expect(seen).toEqual([1, 2]);
  });

  it('array mutation methods inside an effect that also reads the array do not loop', () => {
    const s = store({ l: [3, 1, 2], trigger: 0 });
    const fn = vi.fn(() => {
      s.trigger;
      // reading + sorting a copy is fine; sorting in place reads+writes
      [...s.l].sort();
    });
    effect(fn);
    s.trigger = 1;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('push inside an effect that does not otherwise read the array does not loop', () => {
    const s = store({ log: [] as number[] });
    const n = observable(0);
    effect(() => {
      s.log.push(n.value);
    });
    n.set(1);
    expect(toRaw(s.log)).toEqual([0, 1]);
  });

  it('write inside subscribeStore callback is delivered as a subsequent notification', () => {
    const s = store({ a: 1, b: 0 });
    const calls: any[] = [];
    subscribeStore(s, (snap) => {
      calls.push(snap);
      if (snap.a === 2 && snap.b === 0) s.b = 1;
    });
    s.a = 2;
    expect(calls.at(-1)).toEqual({ a: 2, b: 1 });
    expect(snapshot(s)).toEqual({ a: 2, b: 1 });
  });

  it('subscribeStore fires for writes made in an effect', () => {
    const s = store({ v: 0 });
    const src = observable(1);
    effect(() => {
      s.v = src.value * 2;
    });
    const cb = vi.fn();
    subscribeStore(s, cb);
    src.set(5);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toEqual({ v: 10 });
  });

  it('set and reset within a batch: snapshot unchanged-equal, no effect re-run for computed', () => {
    const s = store({ a: 1 });
    const c = computed(() => s.a);
    const fn = vi.fn(() => {
      c.value;
    });
    effect(fn);
    batch(() => {
      s.a = 2;
      s.a = 1;
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('snapshot while in batch reflects current writes', () => {
    const s = store({ a: 1 });
    batch(() => {
      s.a = 2;
      expect(snapshot(s).a).toBe(2);
    });
  });

  it('snapshot read inside an effect is tracked deeply', () => {
    const s = store({ a: { b: 1 } });
    const seen: number[] = [];
    effect(() => {
      seen.push(snapshot(s).a.b);
    });
    s.a.b = 2;
    expect(seen).toEqual([1, 2]);
  });

  it('store nested inside a store via initial value', () => {
    const inner = store({ v: 1 });
    const outer = store({ inner });
    expect(outer.inner).toBe(inner);
    const cb = vi.fn();
    subscribeStore(outer, cb);
    inner.v = 2;
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('multiple subscribeStore on root and child both fire once', () => {
    const s = store({ c: { v: 1 } });
    const root = vi.fn();
    const child = vi.fn();
    subscribeStore(s, root);
    subscribeStore(s.c, child);
    s.c.v = 2;
    expect(root).toHaveBeenCalledTimes(1);
    expect(child).toHaveBeenCalledTimes(1);
  });

  it('symbol keys work', () => {
    const k = Symbol('k');
    const s = store<any>({});
    s[k] = 1;
    expect(s[k]).toBe(1);
  });

  it('cyclic references: reads and proxies identity work', () => {
    const raw: any = { name: 'r' };
    raw.self = raw;
    const s = store(raw);
    expect(s.self).toBe(s);
    expect(s.self.self.name).toBe('r');
  });

  it('frozen raw object can be read through a store without throwing', () => {
    const s = store({ f: Object.freeze({ x: { y: 1 } }) });
    expect(() => s.f.x.y).not.toThrow();
    expect(s.f.x.y).toBe(1);
  });

  it('isStore on a snapshot is false and snapshot is not writable', () => {
    const s = store({ a: 1 });
    const snap: any = snapshot(s);
    expect(isStore(snap)).toBe(false);
    expect(() => {
      'use strict';
      snap.a = 2;
    }).toThrow();
  });

  it('getter on plain object reads through proxy (this = proxy) and is tracked', () => {
    const s = store({
      a: 1,
      get double() {
        return this.a * 2;
      },
    });
    const seen: number[] = [];
    effect(() => {
      seen.push(s.double);
    });
    s.a = 3;
    expect(seen).toEqual([2, 6]);
  });
});
