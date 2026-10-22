import { describe, expect, it, vi } from 'vitest';
import {
  batch,
  computed,
  deepObserver,
  effect,
  isStore,
  snapshot,
  store,
  subscribeStore,
  toRaw,
} from '../../src';

describe('store: tracking', () => {
  it('per-property tracking', () => {
    const s = store({ a: { b: 1 }, c: 1 });
    const fn = vi.fn(() => s.a.b);
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    s.c = 2;
    expect(fn).toHaveBeenCalledTimes(1);
    s.a.b = 2;
    expect(fn).toHaveBeenCalledTimes(2);
    s.a = { b: 3 };
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn).toHaveLastReturnedWith(3);
    s.a.b = 3; // same value
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('proxies are cached, toRaw / isStore', () => {
    const raw = { a: { b: 1 } };
    const s = store(raw);
    expect(s.a).toBe(s.a);
    expect(store(raw)).toBe(s);
    expect(store(s)).toBe(s);
    expect(toRaw(s)).toBe(raw);
    expect(toRaw(s.a)).toBe(raw.a);
    expect(isStore(s)).toBe(true);
    expect(isStore(s.a)).toBe(true);
    expect(isStore(raw)).toBe(false);
    expect(isStore(1)).toBe(false);
    expect(toRaw(5)).toBe(5);
  });

  it('assigning a proxy stores the raw target', () => {
    const s = store({
      a: { n: 1 } as { n: number },
      b: undefined as unknown as { n: number },
    });
    s.b = s.a;
    expect(toRaw(s).b).toBe(toRaw(s).a);
    expect(s.b).toBe(s.a);
  });

  it('untracked reads allocate no signals', () => {
    const s = store({ a: { b: 1 } });
    for (let i = 0; i < 10; i++) s.a.b;
    // nothing to observe directly; just ensure writes still work & effect after the fact tracks
    const fn = vi.fn(() => s.a.b);
    effect(fn);
    s.a.b++;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keys / in / for-in tracked', () => {
    const s = store<Record<string, number>>({ a: 1 });
    const keys = vi.fn(() => Object.keys(s).join());
    const has = vi.fn(() => 'b' in s);
    const forin = vi.fn(() => {
      const r: string[] = [];
      for (const k in s) r.push(k);
      return r.join();
    });
    effect(keys);
    effect(has);
    effect(forin);
    s.a = 2;
    expect(keys).toHaveBeenCalledTimes(1);
    expect(has).toHaveBeenCalledTimes(1);
    s.b = 1;
    expect(keys).toHaveLastReturnedWith('a,b');
    expect(has).toHaveLastReturnedWith(true);
    expect(forin).toHaveLastReturnedWith('a,b');
    delete s.a;
    expect(keys).toHaveLastReturnedWith('b');
    expect(forin).toHaveBeenCalledTimes(3);
  });

  it('delete notifies property readers', () => {
    const s = store<{ a?: number }>({ a: 1 });
    const fn = vi.fn(() => s.a);
    effect(fn);
    delete s.a;
    expect(fn).toHaveLastReturnedWith(undefined);
    delete s.a; // no-op
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('computed over store', () => {
    const s = store({ items: [1, 2, 3] });
    const sum = computed(() => s.items.reduce((a, b) => a + b, 0));
    expect(sum.value).toBe(6);
    s.items.push(4);
    expect(sum.value).toBe(10);
    s.items[0] = 10;
    expect(sum.value).toBe(19);
  });

  it('writing inside computed throws', () => {
    const s = store({ a: 1 });
    const c = computed(() => (s.a = 2));
    expect(() => c.value).toThrow('Cannot write inside computed');
    expect(s.a).toBe(1);
  });

  it('non-plain objects are not proxied', () => {
    class K {
      x = 1;
    }
    const d = new Date();
    const m = new Map();
    const s = store({ d, m, k: new K(), f: Object.freeze({ a: 1 }) });
    expect(s.d).toBe(d);
    expect(s.m).toBe(m);
    expect(isStore(s.k)).toBe(false);
    expect(isStore(s.f)).toBe(false);
    expect(() => store(new K())).toThrow(TypeError);
  });

  it('getters see the proxy (tracked)', () => {
    const s = store({
      a: 1,
      b: 2,
      get sum() {
        return this.a + this.b;
      },
    });
    const fn = vi.fn(() => s.sum);
    effect(fn);
    s.b = 5;
    expect(fn).toHaveLastReturnedWith(6);
  });

  it('null-prototype objects', () => {
    const o = Object.create(null) as { a: number };
    o.a = 1;
    const s = store(o);
    const fn = vi.fn(() => s.a);
    effect(fn);
    s.a = 2;
    expect(fn).toHaveBeenCalledTimes(2);
    expect(Object.getPrototypeOf(snapshot(s))).toBe(null);
  });
});

describe('store: arrays', () => {
  it('push is one notification and does not track length inside effects', () => {
    const s = store({ list: [] as number[] });
    const fn = vi.fn(() => s.list.length);
    effect(fn);
    s.list.push(1, 2, 3);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveLastReturnedWith(3);
    // pushing inside an effect must not create a dependency on length (no cycle)
    const other = store({ n: 0 });
    effect(() => {
      other.n;
      s.list.push(other.n);
    });
    other.n = 1;
    expect(toRaw(s.list)).toEqual([1, 2, 3, 0, 1]);
  });

  it('index reads, splice, sort, reverse, pop, shift, unshift', () => {
    const s = store([3, 1, 2]);
    const first = vi.fn(() => s[0]);
    const all = vi.fn(() => s.join());
    effect(first);
    effect(all);
    s.sort();
    expect(all).toHaveBeenCalledTimes(2);
    expect(all).toHaveLastReturnedWith('1,2,3');
    s.reverse();
    expect(all).toHaveLastReturnedWith('3,2,1');
    s.splice(1, 1, 9, 9);
    expect(all).toHaveLastReturnedWith('3,9,9,1');
    expect(s.pop()).toBe(1);
    expect(s.shift()).toBe(3);
    s.unshift(0);
    expect(all).toHaveLastReturnedWith('0,9,9');
    expect(all).toHaveBeenCalledTimes(7);
    expect(first).toHaveLastReturnedWith(0);
  });

  it('length truncation notifies removed indexes', () => {
    const s = store([1, 2, 3]);
    const fn = vi.fn(() => s[2]);
    const len = vi.fn(() => s.length);
    effect(fn);
    effect(len);
    s.length = 1;
    expect(fn).toHaveLastReturnedWith(undefined);
    expect(len).toHaveLastReturnedWith(1);
    s[4] = 5; // implicit length growth
    expect(len).toHaveLastReturnedWith(5);
  });

  it('iteration and object elements', () => {
    const s = store({ todos: [{ done: false }, { done: false }] });
    const fn = vi.fn(() => s.todos.filter((t) => t.done).length);
    effect(fn);
    s.todos[1].done = true;
    expect(fn).toHaveLastReturnedWith(1);
    const fo = vi.fn(() => {
      let n = 0;
      for (const t of s.todos) if (!t.done) n++;
      return n;
    });
    effect(fo);
    s.todos.push({ done: false });
    expect(fo).toHaveLastReturnedWith(2);
  });

  it('includes / indexOf work with both raw and proxy values', () => {
    const item = { id: 1 };
    const s = store([item]);
    expect(s.includes(item)).toBe(true);
    expect(s.includes(s[0])).toBe(true);
    expect(s.indexOf(item)).toBe(0);
    expect(s.indexOf(s[0])).toBe(0);
    expect(s.lastIndexOf({ id: 1 })).toBe(-1);
    expect(Array.isArray(s)).toBe(true);
  });
});

describe('snapshot', () => {
  it('frozen, cached, structurally shared', () => {
    const s = store({ a: { x: 1 }, b: { y: [1, 2] }, n: 0 });
    const s1 = snapshot(s);
    expect(Object.isFrozen(s1)).toBe(true);
    expect(Object.isFrozen(s1.b.y)).toBe(true);
    expect(isStore(s1)).toBe(false);
    expect(snapshot(s)).toBe(s1);
    s.a.x = 2;
    const s2 = snapshot(s);
    expect(s2).not.toBe(s1);
    expect(s2.a).not.toBe(s1.a);
    expect(s2.b).toBe(s1.b);
    expect(s2.b.y).toBe(s1.b.y);
    expect(s2).toEqual({ a: { x: 2 }, b: { y: [1, 2] }, n: 0 });
    expect(snapshot(s.b)).toBe(s2.b);
    s.n = 1;
    const s3 = snapshot(s);
    expect(s3.a).toBe(s2.a);
    expect(s3.n).toBe(1);
  });

  it('shared subtree across parents and stores invalidates all of them', () => {
    const shared = { n: 1 };
    const a = store({ s: shared });
    const b = store({ s: shared, list: [shared] });
    const sa = snapshot(a);
    const sb = snapshot(b);
    expect(sb.s).toBe(sa.s);
    a.s.n = 2;
    const sa2 = snapshot(a);
    const sb2 = snapshot(b);
    expect(sa2).not.toBe(sa);
    expect(sb2).not.toBe(sb);
    expect(sb2.s.n).toBe(2);
    expect(sb2.list[0]).toBe(sb2.s);
  });

  it('removed child no longer bumps old parent', () => {
    const child = { n: 1 };
    const keeper = store({ c: child });
    const p = store<{ c?: { n: number } }>({ c: child });
    const cb = vi.fn();
    subscribeStore(p, cb);
    snapshot(keeper);
    p.c = undefined;
    expect(cb).toHaveBeenCalledTimes(1);
    const sp = snapshot(p);
    keeper.c.n = 2;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(snapshot(p)).toBe(sp);
  });

  it('cyclic graphs', () => {
    const o: { self?: unknown; n: number } = { n: 1 };
    o.self = o;
    const s = store(o);
    const sn = snapshot(s) as { self: unknown; n: number };
    expect(sn.self).toBe(sn);
    s.n = 2;
    const sn2 = snapshot(s) as { self: unknown; n: number };
    expect(sn2.n).toBe(2);
    expect(sn2.self).toBe(sn2);
  });

  it('snapshot() inside an effect tracks deeply', () => {
    const s = store({ a: { b: { c: 1 } } });
    const fn = vi.fn(() => snapshot(s).a.b.c);
    effect(fn);
    s.a.b.c = 2;
    expect(fn).toHaveLastReturnedWith(2);
  });
});

describe('subscribeStore', () => {
  it('once per batch with (next, prev)', () => {
    const s = store({ a: 1, b: { c: 1 } });
    const cb = vi.fn();
    const un = subscribeStore(s, cb);
    s.a = 2;
    expect(cb).toHaveBeenCalledTimes(1);
    const [n1, p1] = cb.mock.calls[0];
    expect(n1).toEqual({ a: 2, b: { c: 1 } });
    expect(p1).toEqual({ a: 1, b: { c: 1 } });
    expect(n1.b).toBe(p1.b);
    batch(() => {
      s.a = 3;
      s.b.c = 2;
    });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][1]).toBe(n1);
    s.a = 3; // no-op
    expect(cb).toHaveBeenCalledTimes(2);
    un();
    s.a = 4;
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('array method = one notification', () => {
    const s = store({ list: [1, 2, 3] });
    const cb = vi.fn();
    subscribeStore(s, cb);
    s.list.splice(0, 2, 7, 8, 9);
    s.list.sort((a, b) => b - a);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0].list).toEqual([9, 8, 7, 3]);
  });

  it('newly added children are observed', () => {
    const s = store<{ x?: { n: number } }>({});
    const cb = vi.fn();
    subscribeStore(s, cb);
    s.x = { n: 1 };
    s.x.n = 2;
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0]).toEqual({ x: { n: 2 } });
  });

  it('subscribing to a subtree', () => {
    const s = store({ a: { n: 1 }, b: 1 });
    const cb = vi.fn();
    subscribeStore(s.a, cb);
    s.b = 2;
    expect(cb).not.toHaveBeenCalled();
    s.a.n = 2;
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('deepObserver (compat)', () => {
  it('cb(next, prev) snapshots; unsubscribe', () => {
    const cb = vi.fn();
    const { observer, unsubscribe } = deepObserver(
      { level1: { level2: { count: 0 } } },
      cb
    );
    observer.level1.level2.count++;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].level1.level2.count).toBe(1);
    expect(cb.mock.calls[0][1].level1.level2.count).toBe(0);
    unsubscribe();
    observer.level1.level2.count++;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(observer.level1.level2.count).toBe(2);
  });
});

describe('PM QA round', () => {
  it('self-referencing store: snapshot preserves the cycle, keeps sharing', () => {
    const s = store<{ self?: unknown; n: number; sub: { x: number } }>({
      n: 1,
      sub: { x: 1 },
    });
    s.self = s;
    expect(toRaw(s).self).toBe(toRaw(s));
    const a = snapshot(s) as { self: unknown; n: number; sub: { x: number } };
    expect(a.self).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(snapshot(s)).toBe(a);
    s.n = 2;
    const b = snapshot(s) as typeof a;
    expect(b).not.toBe(a);
    expect(b.self).toBe(b);
    expect(b.n).toBe(2);
    expect(b.sub).toBe(a.sub);
    const cb = vi.fn();
    subscribeStore(s, cb);
    s.sub.x = 2;
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('store proxy in the initial object is unwrapped to raw', () => {
    const inner = store({ v: 1 });
    const arrInner = store({ w: 1 });
    const outer = store({ inner, list: [arrInner] });
    expect(isStore(toRaw(outer).inner)).toBe(false);
    expect(toRaw(outer).inner).toBe(toRaw(inner));
    expect(outer.inner).toBe(inner);
    // deeper nesting is unwrapped lazily, on first access / snapshot
    expect(outer.list[0]).toBe(arrInner);
    expect(isStore(toRaw(outer).list[0])).toBe(false);
    const deep = store({ a: { b: inner } });
    snapshot(deep);
    expect(isStore(toRaw(deep).a.b)).toBe(false);
    const cb = vi.fn();
    subscribeStore(outer, cb);
    inner.v = 2;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].inner).toEqual({ v: 2 });
    expect(isStore(cb.mock.calls[0][0].inner)).toBe(false);
  });
});

describe('PM review fixes', () => {
  it('parent links are weak: temporary stores sharing a child are collectable', async () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const shared = store({ user: { name: 'a' } });
    // functional check (GC check only when --expose-gc is available)
    let collected = 0;
    const reg = new FinalizationRegistry(() => collected++);
    for (let i = 0; i < 50; i++) {
      const view = store({
        user: shared.user,
        big: { payload: new Array(1000).fill(i) },
      });
      snapshot(view);
      reg.register(view, i);
    }
    shared.user.name = 'b';
    expect(snapshot(shared).user.name).toBe('b');
    if (gc) {
      for (let i = 0; i < 3; i++) {
        gc();
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(collected).toBeGreaterThan(40);
    }
  });

  it('shared child still invalidates live parents (weak links)', () => {
    const shared = { n: 1 };
    const a = store({ s: shared });
    const b = store({ s: shared });
    const sa = snapshot(a);
    const sb = snapshot(b);
    b.s.n = 2;
    expect(snapshot(a)).not.toBe(sa);
    expect(snapshot(b)).not.toBe(sb);
    expect(snapshot(a).s.n).toBe(2);
  });

  it('own "__proto__" key is copied as data, not as prototype', () => {
    const s = store(JSON.parse('{"__proto__":{"isAdmin":true},"a":1}'));
    const sn = snapshot(s) as Record<string, unknown>;
    expect(Object.getPrototypeOf(sn)).toBe(Object.prototype);
    expect(sn.isAdmin).toBeUndefined();
    expect(Object.keys(sn)).toEqual(['__proto__', 'a']);
    expect(Object.getOwnPropertyDescriptor(sn, '__proto__')!.value).toEqual({
      isAdmin: true,
    });
    // writes through the store never change the prototype
    const t = store<Record<string, unknown>>({});
    t['__proto__'] = { evil: true };
    expect(Object.getPrototypeOf(toRaw(t))).toBe(Object.prototype);
    expect(isStore((t as { __proto__: unknown }).__proto__)).toBe(true);
    const plain = store<{ __proto__?: unknown }>({});
    expect(isStore(Object.getPrototypeOf(plain))).toBe(false);
  });

  it('array mutators inside a computed throw', () => {
    const s = store({ arr: [1] });
    const c = computed(() => {
      s.arr.push(2);
      return 0;
    });
    expect(() => c.value).toThrow('Cannot write inside computed');
    expect(toRaw(s.arr)).toEqual([1]);
  });

  it('deleted keys drop idle signals but re-tracking still works', () => {
    const s = store<{ a?: number }>({ a: 1 });
    const c = computed(() => s.a);
    expect(c.value).toBe(1); // unobserved computed: signal has no targets
    delete s.a;
    expect(c.value).toBeUndefined();
    s.a = 3;
    expect(c.value).toBe(3);
    const fn = vi.fn(() => s.a);
    effect(fn);
    delete s.a;
    s.a = 4;
    expect(fn).toHaveLastReturnedWith(4);
    const arr = store([1, 2, 3]);
    const last = computed(() => arr[2]);
    expect(last.value).toBe(3);
    arr.length = 1;
    expect(last.value).toBeUndefined();
    arr.push(5, 6);
    expect(last.value).toBe(6);
  });
});
