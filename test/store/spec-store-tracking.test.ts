import { describe, it, expect, vi } from 'vitest';
import { store, toRaw, isStore, effect, batch, computed } from '../../src/index';

describe('spec §2: store per-property tracking', () => {
  it('reads return initial values', () => {
    const s = store({ a: 1, b: { c: 'x' } });
    expect(s.a).toBe(1);
    expect(s.b.c).toBe('x');
  });

  it('effect re-runs when the read property changes', () => {
    const s = store({ a: 1, c: 1 });
    const seen: number[] = [];
    effect(() => {
      seen.push(s.a);
    });
    s.a = 2;
    expect(seen).toEqual([1, 2]);
  });

  it('effect does NOT re-run when an unrelated property changes', () => {
    const s = store({ a: 1, c: 1 });
    const fn = vi.fn(() => {
      s.a;
    });
    effect(fn);
    s.c = 2;
    s.c = 3;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('nested read s.a.b re-runs on s.a.b change, not on s.c or s.a.x change', () => {
    const s = store({ a: { b: 1, x: 1 }, c: 1 });
    const fn = vi.fn(() => {
      s.a.b;
    });
    effect(fn);
    s.c = 2;
    expect(fn).toHaveBeenCalledTimes(1);
    s.a.x = 2;
    expect(fn).toHaveBeenCalledTimes(1);
    s.a.b = 2;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('nested read re-runs when the parent object is replaced', () => {
    const s = store({ a: { b: 1 } });
    const seen: number[] = [];
    effect(() => {
      seen.push(s.a.b);
    });
    s.a = { b: 5 };
    expect(seen).toEqual([1, 5]);
    // new subtree is reactive too
    s.a.b = 6;
    expect(seen).toEqual([1, 5, 6]);
  });

  it('old subtree detached after replacement still mutable but effect follows new one', () => {
    const s = store({ a: { b: 1 } });
    const old = s.a;
    const seen: number[] = [];
    effect(() => {
      seen.push(s.a.b);
    });
    s.a = { b: 2 };
    old.b = 100; // no longer reachable via s.a
    expect(seen).toEqual([1, 2]);
    expect(s.a.b).toBe(2);
  });

  it('same-value assignment is a no-op', () => {
    const s = store({ a: 1, o: { x: 1 } });
    const fn = vi.fn(() => {
      s.a;
      s.o;
    });
    effect(fn);
    s.a = 1;
    const raw = toRaw(s.o);
    s.o = raw;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('assigning the proxy of the same nested object is a no-op', () => {
    const s = store({ o: { x: 1 } });
    const fn = vi.fn(() => {
      s.o;
    });
    effect(fn);
    s.o = s.o;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('NaN assignment over NaN is a no-op (Object.is)', () => {
    const s = store({ n: NaN });
    const fn = vi.fn(() => {
      s.n;
    });
    effect(fn);
    s.n = NaN;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('writes are visible to the raw object (no cloning)', () => {
    const raw = { a: 1, n: { b: 1 } };
    const s = store(raw);
    s.a = 2;
    s.n.b = 3;
    expect(raw.a).toBe(2);
    expect(raw.n.b).toBe(3);
  });

  it('batch: multiple writes re-run effect once', () => {
    const s = store({ a: 1, b: 1 });
    const fn = vi.fn(() => {
      s.a;
      s.b;
    });
    effect(fn);
    batch(() => {
      s.a = 2;
      s.b = 2;
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('works with computed', () => {
    const s = store({ a: 2, b: 3 });
    const sum = computed(() => s.a + s.b);
    expect(sum.value).toBe(5);
    s.a = 10;
    expect(sum.value).toBe(13);
  });
});

describe('spec §2: proxy identity & raw', () => {
  it('nested proxies are cached: s.a === s.a', () => {
    const s = store({ a: { b: { c: 1 } } });
    expect(s.a).toBe(s.a);
    expect(s.a.b).toBe(s.a.b);
  });

  it('store(raw) twice returns the same proxy', () => {
    const raw = { a: 1 };
    expect(store(raw)).toBe(store(raw));
  });

  it('store(proxy) returns the proxy itself', () => {
    const s = store({ a: 1 });
    expect(store(s)).toBe(s);
  });

  it('toRaw returns the original object, nested too', () => {
    const inner = { b: 1 };
    const raw = { a: inner };
    const s = store(raw);
    expect(toRaw(s)).toBe(raw);
    expect(toRaw(s.a)).toBe(inner);
    expect(s).not.toBe(raw);
  });

  it('toRaw on non-store values returns them unchanged', () => {
    const o = { x: 1 };
    expect(toRaw(o)).toBe(o);
    expect(toRaw(5 as any)).toBe(5);
  });

  it('isStore', () => {
    const s = store({ a: { b: 1 } });
    expect(isStore(s)).toBe(true);
    expect(isStore(s.a)).toBe(true);
    expect(isStore({})).toBe(false);
    expect(isStore(null)).toBe(false);
    expect(isStore(1)).toBe(false);
    expect(isStore(toRaw(s))).toBe(false);
  });

  it('assigning a store proxy into another store stores the raw target', () => {
    const a = store({ x: 1 });
    const rawB = { child: null as null | { x: number } };
    const b = store(rawB);
    b.child = a;
    expect(rawB.child).toBe(toRaw(a));
    expect(isStore(rawB.child)).toBe(false);
    // reading through b gives the (cached) proxy of the same raw target
    expect(b.child).toBe(a);
  });

  it('assigning a store proxy: mutation via one store notifies effects reading via the other', () => {
    const a = store({ x: 1 });
    const b = store({ child: { x: 0 } });
    b.child = a;
    const seen: number[] = [];
    effect(() => {
      seen.push(b.child.x);
    });
    a.x = 2;
    expect(seen).toEqual([1, 2]);
  });

  it('shared subtree in two places: writes through either path notify readers of both', () => {
    const shared = { v: 1 };
    const s = store({ p: shared, q: shared });
    expect(s.p).toBe(s.q);
    const seenP: number[] = [];
    const seenQ: number[] = [];
    effect(() => {
      seenP.push(s.p.v);
    });
    effect(() => {
      seenQ.push(s.q.v);
    });
    s.p.v = 2;
    expect(seenP).toEqual([1, 2]);
    expect(seenQ).toEqual([1, 2]);
    s.q.v = 3;
    expect(seenP).toEqual([1, 2, 3]);
    expect(seenQ).toEqual([1, 2, 3]);
  });
});

describe('spec §2: key tracking (in / Object.keys / for-in / ownKeys)', () => {
  it('Object.keys re-runs when a key is added', () => {
    const s = store<Record<string, number>>({ a: 1 });
    const seen: string[][] = [];
    effect(() => {
      seen.push(Object.keys(s));
    });
    s.b = 2;
    expect(seen).toEqual([['a'], ['a', 'b']]);
  });

  it('Object.keys re-runs when a key is deleted', () => {
    const s = store<Record<string, number>>({ a: 1, b: 2 });
    const seen: string[][] = [];
    effect(() => {
      seen.push(Object.keys(s));
    });
    delete s.b;
    expect(seen).toEqual([['a', 'b'], ['a']]);
  });

  it('Object.keys does NOT re-run when an existing value changes', () => {
    const s = store<Record<string, number>>({ a: 1 });
    const fn = vi.fn(() => {
      Object.keys(s);
    });
    effect(fn);
    s.a = 2;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('`in` is tracked for add and delete', () => {
    const s = store<Record<string, number>>({});
    const seen: boolean[] = [];
    effect(() => {
      seen.push('x' in s);
    });
    s.x = 1;
    delete s.x;
    expect(seen).toEqual([false, true, false]);
  });

  it('for...in re-runs on key add', () => {
    const s = store<Record<string, number>>({ a: 1 });
    const seen: string[][] = [];
    effect(() => {
      const ks: string[] = [];
      for (const k in s) ks.push(k);
      seen.push(ks);
    });
    s.z = 9;
    expect(seen).toEqual([['a'], ['a', 'z']]);
  });

  it('reading a missing key then adding it re-runs', () => {
    const s = store<Record<string, number | undefined>>({});
    const seen: (number | undefined)[] = [];
    effect(() => {
      seen.push(s.k);
    });
    s.k = 4;
    expect(seen).toEqual([undefined, 4]);
  });

  it('deleting a read key re-runs with undefined', () => {
    const s = store<Record<string, number>>({ k: 1 });
    const seen: (number | undefined)[] = [];
    effect(() => {
      seen.push(s.k);
    });
    delete s.k;
    expect(seen).toEqual([1, undefined]);
  });

  it('deleting a missing key is a no-op', () => {
    const s = store<Record<string, number>>({ a: 1 });
    const fn = vi.fn(() => {
      Object.keys(s);
    });
    effect(fn);
    delete s.nope;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Object.entries / JSON.stringify read through the proxy', () => {
    const s = store({ a: 1, n: { b: 2 } });
    expect(Object.entries(s)).toEqual([
      ['a', 1],
      ['n', { b: 2 }],
    ]);
    expect(JSON.stringify(s)).toBe('{"a":1,"n":{"b":2}}');
  });

  it('JSON.stringify in an effect tracks deep changes', () => {
    const s = store({ n: { b: 2 } });
    const seen: string[] = [];
    effect(() => {
      seen.push(JSON.stringify(s));
    });
    s.n.b = 3;
    expect(seen).toEqual(['{"n":{"b":2}}', '{"n":{"b":3}}']);
  });
});

describe('spec §2: non-plain objects are not proxied', () => {
  it('Date is not proxied and its methods work', () => {
    const d = new Date(0);
    const s = store({ d });
    expect(s.d).toBe(d);
    expect(isStore(s.d)).toBe(false);
    expect(s.d.getTime()).toBe(0);
  });

  it('class instances are not proxied', () => {
    class Foo {
      x = 1;
      inc() {
        this.x++;
      }
    }
    const f = new Foo();
    const s = store({ f });
    expect(s.f).toBe(f);
    expect(isStore(s.f)).toBe(false);
    s.f.inc();
    expect(f.x).toBe(2);
  });

  it('Map/Set are not proxied and remain functional', () => {
    const m = new Map([['a', 1]]);
    const st = new Set([1]);
    const s = store({ m, st });
    expect(s.m).toBe(m);
    expect(s.st).toBe(st);
    expect(s.m.get('a')).toBe(1);
    expect(s.st.has(1)).toBe(true);
  });

  it('Promise is not proxied', () => {
    const p = Promise.resolve(1);
    const s = store({ p });
    expect(s.p).toBe(p);
  });

  it('replacing a Date property triggers effect', () => {
    const s = store({ d: new Date(0) });
    const seen: number[] = [];
    effect(() => {
      seen.push(s.d.getTime());
    });
    s.d = new Date(5);
    expect(seen).toEqual([0, 5]);
  });

  it('Object.create(null) objects are treated as plain (proxied)', () => {
    const o = Object.create(null);
    o.v = 1;
    const s = store({ o });
    expect(isStore(s.o)).toBe(true);
  });
});
