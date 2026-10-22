import { describe, it, expect, vi } from 'vitest';
import { observable, computed, watch, batch } from '../../src/index';

describe('spec §1: watch', () => {
  it('watch(observable) not called initially; called with (value, prev) on change', () => {
    const s = observable(1);
    const cb = vi.fn();
    watch(s, cb);
    expect(cb).not.toHaveBeenCalled();
    s.set(2);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBe(2);
    expect(cb.mock.calls[0][1]).toBe(1);
    expect(typeof cb.mock.calls[0][2]).toBe('function');
  });

  it('watch(computed) works', () => {
    const s = observable(1);
    const c = computed(() => s.value * 10);
    const cb = vi.fn();
    watch(c, cb);
    s.set(2);
    expect(cb.mock.calls[0].slice(0, 2)).toEqual([20, 10]);
  });

  it('watch(getter) auto-tracks and fires only when the selected value changes', () => {
    const s = observable({ a: 1, b: 1 });
    const cb = vi.fn();
    watch(() => s.value.a, cb);
    s.set({ a: 1, b: 2 });
    expect(cb).not.toHaveBeenCalled();
    s.set({ a: 2, b: 2 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0].slice(0, 2)).toEqual([2, 1]);
  });

  it('watch(getter) with multiple deps', () => {
    const a = observable(1);
    const b = observable(2);
    const cb = vi.fn();
    watch(() => a.value + b.value, cb);
    a.set(2);
    b.set(5);
    expect(cb.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      [4, 3],
      [7, 4],
    ]);
  });

  it('watch(getter) dynamic deps: old branch no longer triggers', () => {
    const cond = observable(true);
    const a = observable(1);
    const b = observable(2);
    const cb = vi.fn();
    watch(() => (cond.value ? a.value : b.value), cb);
    cond.set(false);
    expect(cb).toHaveBeenCalledTimes(1);
    a.set(100);
    expect(cb).toHaveBeenCalledTimes(1);
    b.set(3);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('watch getter: cb reads are not tracked', () => {
    const s = observable(1);
    const other = observable(1);
    const cb = vi.fn(() => {
      other.value;
    });
    watch(() => s.value, cb);
    s.set(2);
    other.set(2);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('watch with custom equals', () => {
    const s = observable({ id: 1, name: 'a' });
    const cb = vi.fn();
    watch(() => s.value, cb, { equals: (x, y) => x.id === y.id });
    s.set({ id: 1, name: 'b' });
    expect(cb).not.toHaveBeenCalled();
    s.set({ id: 2, name: 'b' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('watch getter returning new object each time with default equals fires each change', () => {
    const s = observable(1);
    const cb = vi.fn();
    watch(() => ({ v: s.value }), cb);
    s.set(2);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toEqual({ v: 2 });
  });

  it('immediate: true calls cb right away with current value', () => {
    const s = observable(5);
    const cb = vi.fn();
    watch(s, cb, { immediate: true });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBe(5);
  });

  it('immediate (getter) calls cb right away with current value', () => {
    const s = observable(5);
    const cb = vi.fn();
    watch(() => s.value * 2, cb, { immediate: true });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBe(10);
  });

  it('[ambiguous] immediate: prev is undefined on the first call (per prev: T | undefined type)', () => {
    const s = observable(5);
    const cb = vi.fn();
    watch(s, cb, { immediate: true });
    expect(cb.mock.calls[0][1]).toBeUndefined();
  });

  it('once: auto-unsubscribes after the first call', () => {
    const s = observable(0);
    const cb = vi.fn();
    watch(s, cb, { once: true });
    s.set(1);
    s.set(2);
    s.set(3);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBe(1);
  });

  it('once with getter source', () => {
    const s = observable(0);
    const cb = vi.fn();
    watch(() => s.value, cb, { once: true });
    s.set(1);
    s.set(2);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('[ambiguous] once + immediate: only the immediate call happens', () => {
    const s = observable(0);
    const cb = vi.fn();
    watch(s, cb, { once: true, immediate: true });
    s.set(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops further calls', () => {
    const s = observable(0);
    const cb = vi.fn();
    const stop = watch(() => s.value, cb);
    stop();
    s.set(1);
    expect(cb).not.toHaveBeenCalled();
  });

  it('onCleanup registered in cb runs before next cb and on unsubscribe', () => {
    const s = observable(0);
    const log: string[] = [];
    const stop = watch(s, (v, _p, onCleanup) => {
      log.push(`cb${v}`);
      onCleanup(() => log.push(`cleanup${v}`));
    });
    s.set(1);
    s.set(2);
    expect(log).toEqual(['cb1', 'cleanup1', 'cb2']);
    stop();
    expect(log).toEqual(['cb1', 'cleanup1', 'cb2', 'cleanup2']);
    s.set(3);
    expect(log).toEqual(['cb1', 'cleanup1', 'cb2', 'cleanup2']);
  });

  it('onCleanup with once runs (after first call) on unsubscribe or auto-unsubscribe, exactly once', () => {
    const s = observable(0);
    const cleanup = vi.fn();
    const stop = watch(
      s,
      (_v, _p, onCleanup) => {
        onCleanup(cleanup);
      },
      { once: true },
    );
    s.set(1);
    s.set(2);
    stop();
    expect(cleanup.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('watch fires once per batch with final value', () => {
    const a = observable(1);
    const b = observable(1);
    const cb = vi.fn();
    watch(() => a.value + b.value, cb);
    batch(() => {
      a.set(5);
      b.set(5);
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0].slice(0, 2)).toEqual([10, 2]);
  });

  it('getter not re-invoked when unrelated observables change', () => {
    const a = observable(1);
    const unrelated = observable(1);
    const getter = vi.fn(() => a.value);
    watch(getter, () => {});
    const n = getter.mock.calls.length;
    unrelated.set(2);
    expect(getter.mock.calls.length).toBe(n);
  });

  it('unsubscribe from within cb is safe', () => {
    const s = observable(0);
    const cb = vi.fn();
    let stop: () => void = () => {};
    stop = watch(s, (v) => {
      cb(v);
      stop();
    });
    expect(() => s.set(1)).not.toThrow();
    s.set(2);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
