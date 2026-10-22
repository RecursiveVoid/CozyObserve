import { describe, it, expect, vi } from 'vitest';
import { store, toRaw, effect, subscribeStore, snapshot } from '../../src/index';

describe('spec §2: arrays in store', () => {
  it('index reads are tracked', () => {
    const s = store({ list: [1, 2, 3] });
    const seen: number[] = [];
    effect(() => {
      seen.push(s.list[1]);
    });
    s.list[1] = 20;
    expect(seen).toEqual([2, 20]);
  });

  it('writing an unrelated index does not re-run an index reader', () => {
    const s = store({ list: [1, 2, 3] });
    const fn = vi.fn(() => {
      s.list[0];
    });
    effect(fn);
    s.list[2] = 30;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('length is tracked', () => {
    const s = store({ list: [1, 2] });
    const seen: number[] = [];
    effect(() => {
      seen.push(s.list.length);
    });
    s.list.push(3);
    expect(seen).toEqual([2, 3]);
    s.list.length = 0;
    expect(seen).toEqual([2, 3, 0]);
  });

  it('setting length truncates and notifies index readers of removed items', () => {
    const s = store({ list: [1, 2, 3] });
    const seen: (number | undefined)[] = [];
    effect(() => {
      seen.push(s.list[2]);
    });
    s.list.length = 1;
    expect(seen).toEqual([3, undefined]);
  });

  it('top-level array store works', () => {
    const s = store([1, 2, 3]);
    const seen: number[] = [];
    effect(() => {
      seen.push(s.reduce((a, b) => a + b, 0));
    });
    s.push(4);
    expect(seen).toEqual([6, 10]);
    expect(Array.isArray(s)).toBe(true);
  });

  it.each([
    ['push', (l: number[]) => l.push(4, 5)],
    ['pop', (l: number[]) => l.pop()],
    ['shift', (l: number[]) => l.shift()],
    ['unshift', (l: number[]) => l.unshift(0, -1)],
    ['splice', (l: number[]) => l.splice(1, 1, 9, 8, 7)],
    ['sort', (l: number[]) => l.sort((a, b) => b - a)],
    ['reverse', (l: number[]) => l.reverse()],
    ['fill', (l: number[]) => l.fill(0)],
    ['copyWithin', (l: number[]) => l.copyWithin(0, 1)],
  ] as const)('%s triggers exactly one effect re-run', (_name, op) => {
    const s = store({ list: [3, 1, 2] });
    const fn = vi.fn(() => {
      // read everything: each index + length
      s.list.map((x) => x);
      s.list.length;
    });
    effect(fn);
    op(s.list);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['push', (l: number[]) => l.push(4)],
    ['splice', (l: number[]) => l.splice(0, 1)],
    ['sort', (l: number[]) => l.sort()],
    ['reverse', (l: number[]) => l.reverse()],
  ] as const)('%s triggers exactly one subscribeStore notification', (_name, op) => {
    const s = store({ list: [3, 1, 2] });
    const cb = vi.fn();
    subscribeStore(s, cb);
    op(s.list);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('mutating methods produce correct results', () => {
    const s = store({ list: [3, 1, 2] });
    s.list.push(4);
    expect([...s.list]).toEqual([3, 1, 2, 4]);
    s.list.sort();
    expect([...s.list]).toEqual([1, 2, 3, 4]);
    s.list.reverse();
    expect([...s.list]).toEqual([4, 3, 2, 1]);
    expect(s.list.splice(1, 2)).toEqual([3, 2]);
    expect([...s.list]).toEqual([4, 1]);
    expect(s.list.pop()).toBe(1);
    expect(s.list.shift()).toBe(4);
    expect(s.list.length).toBe(0);
  });

  it('effect using map re-runs on item mutation inside objects', () => {
    const s = store({ todos: [{ t: 'a', done: false }, { t: 'b', done: false }] });
    const seen: string[] = [];
    effect(() => {
      seen.push(s.todos.map((x) => (x.done ? 'x' : '-')).join(''));
    });
    s.todos[1].done = true;
    expect(seen).toEqual(['--', '-x']);
    s.todos.push({ t: 'c', done: true });
    expect(seen).toEqual(['--', '-x', '-xx']);
  });

  it('effect using forEach re-runs on push', () => {
    const s = store({ list: [1] });
    const seen: number[] = [];
    effect(() => {
      let sum = 0;
      s.list.forEach((x) => (sum += x));
      seen.push(sum);
    });
    s.list.push(2);
    expect(seen).toEqual([1, 3]);
  });

  it('for...of iteration is tracked', () => {
    const s = store({ list: [1, 2] });
    const seen: number[][] = [];
    effect(() => {
      const out: number[] = [];
      for (const x of s.list) out.push(x);
      seen.push(out);
    });
    s.list[0] = 5;
    expect(seen).toEqual([
      [1, 2],
      [5, 2],
    ]);
  });

  it('items yielded by iteration/map are proxies (cached)', () => {
    const s = store({ list: [{ v: 1 }] });
    const viaMap = s.list.map((x) => x)[0];
    expect(viaMap).toBe(s.list[0]);
    const [viaIter] = [...s.list];
    expect(viaIter).toBe(s.list[0]);
  });

  it('includes / indexOf work with both proxies and raw items', () => {
    const item = { v: 1 };
    const s = store({ list: [item] });
    expect(s.list.includes(s.list[0])).toBe(true);
    expect(s.list.indexOf(s.list[0])).toBe(0);
    expect(s.list.includes(item)).toBe(true);
    expect(s.list.indexOf(item)).toBe(0);
  });

  it('push of a store proxy stores raw target', () => {
    const child = store({ v: 1 });
    const s = store({ list: [] as { v: number }[] });
    s.list.push(child);
    expect(toRaw(s.list)[0]).toBe(toRaw(child));
    expect(s.list[0]).toBe(child);
  });

  it('snapshot of array is a frozen array', () => {
    const s = store({ list: [1, 2] });
    const snap = snapshot(s);
    expect(Array.isArray(snap.list)).toBe(true);
    expect(Object.isFrozen(snap.list)).toBe(true);
    expect(snap.list).toEqual([1, 2]);
  });
});
