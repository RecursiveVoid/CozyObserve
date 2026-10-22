import { describe, it, expect, vi } from 'vitest';
import { store, snapshot, subscribeStore, batch, isStore, deepObserver } from '../../src/index';

function isDeepFrozen(o: any): boolean {
  if (o === null || typeof o !== 'object') return true;
  if (!Object.isFrozen(o)) return false;
  return Object.values(o).every(isDeepFrozen);
}

describe('spec §2: snapshot', () => {
  it('returns a deep-frozen plain object equal to the state', () => {
    const s = store({ a: 1, n: { b: [1, { c: 2 }] } });
    const snap = snapshot(s);
    expect(snap).toEqual({ a: 1, n: { b: [1, { c: 2 }] } });
    expect(isDeepFrozen(snap)).toBe(true);
    expect(isStore(snap)).toBe(false);
    expect(isStore(snap.n)).toBe(false);
  });

  it('is not the raw object (writes to store do not mutate a taken snapshot)', () => {
    const s = store({ a: 1, n: { b: 1 } });
    const snap = snapshot(s);
    s.a = 2;
    s.n.b = 2;
    expect(snap.a).toBe(1);
    expect(snap.n.b).toBe(1);
  });

  it('identical object when there are no changes', () => {
    const s = store({ a: 1, n: { b: 1 } });
    expect(snapshot(s)).toBe(snapshot(s));
  });

  it('identical object after a same-value (no-op) write', () => {
    const s = store({ a: 1 });
    const s1 = snapshot(s);
    s.a = 1;
    expect(snapshot(s)).toBe(s1);
  });

  it('structural sharing: unchanged branches keep reference', () => {
    const s = store({ left: { x: 1, deep: { y: 1 } }, right: { z: 1 } });
    const s1 = snapshot(s);
    s.right.z = 2;
    const s2 = snapshot(s);
    expect(s2).not.toBe(s1);
    expect(s2.left).toBe(s1.left);
    expect(s2.left.deep).toBe(s1.left.deep);
    expect(s2.right).not.toBe(s1.right);
    expect(s2.right.z).toBe(2);
  });

  it('deep change creates new references along the path only', () => {
    const s = store({ a: { b: { c: 1 }, sib: { q: 1 } }, other: { r: 1 } });
    const s1 = snapshot(s);
    s.a.b.c = 2;
    const s2 = snapshot(s);
    expect(s2).not.toBe(s1);
    expect(s2.a).not.toBe(s1.a);
    expect(s2.a.b).not.toBe(s1.a.b);
    expect(s2.a.sib).toBe(s1.a.sib);
    expect(s2.other).toBe(s1.other);
  });

  it('snapshot of a nested proxy works', () => {
    const s = store({ a: { b: 1 } });
    const sub = snapshot(s.a);
    expect(sub).toEqual({ b: 1 });
    expect(Object.isFrozen(sub)).toBe(true);
  });

  it('array element change shares unchanged elements', () => {
    const s = store({ list: [{ v: 1 }, { v: 2 }] });
    const s1 = snapshot(s);
    s.list[1].v = 3;
    const s2 = snapshot(s);
    expect(s2.list).not.toBe(s1.list);
    expect(s2.list[0]).toBe(s1.list[0]);
    expect(s2.list[1]).toEqual({ v: 3 });
  });

  it('shared subtree change is reflected in both places', () => {
    const shared = { v: 1 };
    const s = store({ p: shared, q: shared });
    s.p.v = 2;
    const snap = snapshot(s);
    expect(snap.p.v).toBe(2);
    expect(snap.q.v).toBe(2);
  });

  it('key add/delete produce new snapshots', () => {
    const s = store<Record<string, number>>({ a: 1 });
    const s1 = snapshot(s);
    s.b = 2;
    const s2 = snapshot(s);
    expect(s2).toEqual({ a: 1, b: 2 });
    delete s.a;
    const s3 = snapshot(s);
    expect(s3).toEqual({ b: 2 });
    expect(s1).toEqual({ a: 1 });
  });

  it('non-plain values (Date) are kept by reference in snapshot', () => {
    const d = new Date(0);
    const s = store({ d });
    expect(snapshot(s).d).toBe(d);
  });
});

describe('spec §2: subscribeStore', () => {
  it('calls cb(snap, prev) after a change', () => {
    const s = store({ a: 1 });
    const cb = vi.fn();
    const prev = snapshot(s);
    subscribeStore(s, cb);
    s.a = 2;
    expect(cb).toHaveBeenCalledTimes(1);
    const [snap, p] = cb.mock.calls[0];
    expect(snap).toEqual({ a: 2 });
    expect(p).toEqual({ a: 1 });
    expect(p).toBe(prev);
    expect(snap).toBe(snapshot(s));
  });

  it('is not called initially', () => {
    const s = store({ a: 1 });
    const cb = vi.fn();
    subscribeStore(s, cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('deep changes notify', () => {
    const s = store({ a: { b: { c: 1 } } });
    const cb = vi.fn();
    subscribeStore(s, cb);
    s.a.b.c = 2;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].a.b.c).toBe(2);
  });

  it('once per batch', () => {
    const s = store({ a: 1, b: { c: 1 } });
    const cb = vi.fn();
    subscribeStore(s, cb);
    batch(() => {
      s.a = 2;
      s.a = 3;
      s.b.c = 5;
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toEqual({ a: 3, b: { c: 5 } });
    expect(cb.mock.calls[0][1]).toEqual({ a: 1, b: { c: 1 } });
  });

  it('consecutive notifications chain prev correctly', () => {
    const s = store({ a: 1 });
    const calls: [any, any][] = [];
    subscribeStore(s, (snap, prev) => calls.push([snap, prev]));
    s.a = 2;
    s.a = 3;
    expect(calls.length).toBe(2);
    expect(calls[1][1]).toBe(calls[0][0]);
  });

  it('same-value write does not notify', () => {
    const s = store({ a: 1 });
    const cb = vi.fn();
    subscribeStore(s, cb);
    s.a = 1;
    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe stops notifications', () => {
    const s = store({ a: 1 });
    const cb = vi.fn();
    const un = subscribeStore(s, cb);
    s.a = 2;
    un();
    s.a = 3;
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('subscribing to a nested proxy only fires for that subtree', () => {
    const s = store({ x: { v: 1 }, y: { v: 1 } });
    const cb = vi.fn();
    subscribeStore(s.x, cb);
    s.y.v = 2;
    expect(cb).not.toHaveBeenCalled();
    s.x.v = 2;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toEqual({ v: 2 });
  });

  it('key add / delete / array push notify', () => {
    const s = store<{ m: Record<string, number>; l: number[] }>({ m: {}, l: [] });
    const cb = vi.fn();
    subscribeStore(s, cb);
    s.m.k = 1;
    delete s.m.k;
    s.l.push(1);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('replaced subtree: old subtree mutations do not notify, new ones do', () => {
    const s = store({ a: { v: 1 } });
    const old = s.a;
    const cb = vi.fn();
    subscribeStore(s, cb);
    s.a = { v: 2 };
    expect(cb).toHaveBeenCalledTimes(1);
    old.v = 99;
    expect(cb).toHaveBeenCalledTimes(1);
    s.a.v = 3;
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('error in one subscriber does not block another', () => {
    const s = store({ a: 1 });
    const good = vi.fn();
    subscribeStore(s, () => {
      throw new Error('boom');
    });
    subscribeStore(s, good);
    expect(() => {
      s.a = 2;
    }).toThrow('boom');
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('spec §4 (via store): deepObserver legacy-like usage', () => {
  it('returns { observer, unsubscribe }; cb(newSnap, prevSnap) on property change', () => {
    const cb = vi.fn();
    const { observer, unsubscribe } = deepObserver({ name: 'John', age: 30 }, cb);
    observer.name = 'Doe';
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ name: 'Doe', age: 30 }, { name: 'John', age: 30 });
    expect(typeof unsubscribe).toBe('function');
  });

  it('unsubscribe stops callbacks', () => {
    const cb = vi.fn();
    const { observer, unsubscribe } = deepObserver({ name: 'John', age: 30 }, cb);
    unsubscribe();
    observer.age = 31;
    expect(cb).not.toHaveBeenCalled();
    expect(observer.age).toBe(31);
  });

  it('arrays', () => {
    const cb = vi.fn();
    const { observer } = deepObserver([1, 2, 3], cb);
    observer[0] = 4;
    expect(cb).toHaveBeenCalledWith([4, 2, 3], [1, 2, 3]);
  });

  it('nested change: cb gets root snapshots (v1 semantics)', () => {
    const cb = vi.fn();
    const { observer } = deepObserver({ level1: { level2: { count: 0 } } }, cb);
    observer.level1.level2.count = 1;
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(
      { level1: { level2: { count: 1 } } },
      { level1: { level2: { count: 0 } } },
    );
  });

  it('same value does not call back', () => {
    const cb = vi.fn();
    const { observer } = deepObserver({ a: 1 }, cb);
    observer.a = 1;
    expect(cb).not.toHaveBeenCalled();
  });

  it('observer is a store', () => {
    const { observer } = deepObserver({ a: { b: 1 } }, () => {});
    expect(isStore(observer)).toBe(true);
    expect(observer.a).toBe(observer.a);
  });
});
