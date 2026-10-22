import { describe, it, expect, vi } from 'vitest';
import { observable, computed, effect, isObservable } from '../../src/index';

describe('spec §1: observable basics', () => {
  it('value / get() / peek() return the initial value', () => {
    const s = observable(42);
    expect(s.value).toBe(42);
    expect(s.get()).toBe(42);
    expect(s.peek()).toBe(42);
  });

  it('set(v) changes the value', () => {
    const s = observable(1);
    s.set(2);
    expect(s.value).toBe(2);
    expect(s.get()).toBe(2);
    expect(s.peek()).toBe(2);
  });

  it('value setter is equivalent to set()', () => {
    const s = observable(1);
    const cb = vi.fn();
    s.subscribe(cb);
    s.value = 5;
    expect(s.value).toBe(5);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(5, 1);
  });

  it('set(fn) is an updater receiving prev', () => {
    const s = observable(10);
    const updater = vi.fn((prev: number) => prev + 1);
    s.set(updater);
    expect(updater).toHaveBeenCalledWith(10);
    expect(s.value).toBe(11);
  });

  it('set(() => fn) stores a function value', () => {
    const fn = () => 'hello';
    const s = observable<() => string>(() => 'initial');
    s.set(() => fn);
    expect(s.value).toBe(fn);
    expect(s.value()).toBe('hello');
  });

  it('update(fn) is an explicit updater', () => {
    const s = observable(3);
    s.update((p) => p * 2);
    expect(s.value).toBe(6);
  });

  it('get() is a tracked read like .value', () => {
    const s = observable(1);
    const runs = vi.fn();
    effect(() => {
      runs(s.get());
    });
    s.set(2);
    expect(runs).toHaveBeenCalledTimes(2);
    expect(runs).toHaveBeenLastCalledWith(2);
  });
});

describe('spec §1: observable equality', () => {
  it('set with equal value (Object.is) is a no-op: no subscriber call, no effect run', () => {
    const s = observable(1);
    const cb = vi.fn();
    const eff = vi.fn();
    s.subscribe(cb);
    effect(() => {
      eff(s.value);
    });
    s.set(1);
    s.value = 1;
    s.update((p) => p);
    expect(cb).not.toHaveBeenCalled();
    expect(eff).toHaveBeenCalledTimes(1);
  });

  it('default equality is Object.is: NaN→NaN is a no-op', () => {
    const s = observable(NaN);
    const cb = vi.fn();
    s.subscribe(cb);
    s.set(NaN);
    expect(cb).not.toHaveBeenCalled();
  });

  it('default equality is Object.is: +0 → -0 notifies', () => {
    const s = observable(0);
    const cb = vi.fn();
    s.subscribe(cb);
    s.set(-0);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(Object.is(s.value, -0)).toBe(true);
  });

  it('default equality is reference equality for objects', () => {
    const o = { a: 1 };
    const s = observable(o);
    const cb = vi.fn();
    s.subscribe(cb);
    s.set(o);
    expect(cb).not.toHaveBeenCalled();
    s.set({ a: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('custom equals suppresses notifications when it returns true', () => {
    const s = observable({ id: 1, name: 'a' }, { equals: (a, b) => a.id === b.id });
    const cb = vi.fn();
    const eff = vi.fn();
    s.subscribe(cb);
    effect(() => {
      eff(s.value);
    });
    s.set({ id: 1, name: 'b' });
    expect(cb).not.toHaveBeenCalled();
    expect(eff).toHaveBeenCalledTimes(1);
    s.set({ id: 2, name: 'c' });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(eff).toHaveBeenCalledTimes(2);
    expect(s.value).toEqual({ id: 2, name: 'c' });
  });

  it('custom equals is called with (old, new)', () => {
    const equals = vi.fn((a: number, b: number) => a === b);
    const s = observable(1, { equals });
    s.set(2);
    expect(equals).toHaveBeenCalledWith(1, 2);
  });

  it('equals:false always notifies, even for identical value', () => {
    const o = { a: 1 };
    const s = observable(o, { equals: false });
    const cb = vi.fn();
    const eff = vi.fn();
    s.subscribe(cb);
    effect(() => {
      eff(s.value);
    });
    s.set(o);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(eff).toHaveBeenCalledTimes(2);
    s.set(o);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(eff).toHaveBeenCalledTimes(3);
  });

  it('equals:false propagates through a computed that reads it (computed reruns)', () => {
    const s = observable(1, { equals: false });
    const fn = vi.fn(() => s.value);
    const c = computed(fn);
    const eff = vi.fn();
    effect(() => {
      eff(c.value);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    s.set(1);
    expect(fn).toHaveBeenCalledTimes(2);
    // computed result equal (1 === 1) → default cutoff applies at computed level
    expect(eff).toHaveBeenCalledTimes(1);
  });
});

describe('spec §1: isObservable', () => {
  it('true for observables and computeds', () => {
    expect(isObservable(observable(1))).toBe(true);
    expect(isObservable(computed(() => 1))).toBe(true);
  });

  it('false for non-observables', () => {
    expect(isObservable(null)).toBe(false);
    expect(isObservable(undefined)).toBe(false);
    expect(isObservable(1)).toBe(false);
    expect(isObservable('x')).toBe(false);
    expect(isObservable({})).toBe(false);
    expect(isObservable({ value: 1, get() {}, peek() {}, subscribe() {} })).toBe(false);
    expect(isObservable(() => 1)).toBe(false);
    expect(isObservable([])).toBe(false);
  });

  it('does not track or trigger computeds when checking', () => {
    const fn = vi.fn(() => 1);
    const c = computed(fn);
    isObservable(c);
    expect(fn).not.toHaveBeenCalled();
  });
});
