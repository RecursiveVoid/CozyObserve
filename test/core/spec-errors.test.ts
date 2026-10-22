import { describe, it, expect, vi } from 'vitest';
import { observable, computed, effect, batch } from '../../src/index';
import type { ReadonlyObservable } from '../../src/index';

describe('spec §1: cycles', () => {
  it('computed reading itself throws an Error containing "Cycle"', () => {
    let c: ReadonlyObservable<number>;
    c = computed((): number => c.value + 1);
    let err: unknown;
    try {
      c.value;
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toContain('Cycle');
  });

  it('mutual computed cycle (a ↔ b) throws "Cycle"', () => {
    let a: ReadonlyObservable<number>;
    // eslint-disable-next-line prefer-const
    let b: ReadonlyObservable<number>;
    a = computed((): number => b.value + 1);
    b = computed((): number => a.value + 1);
    expect(() => a.value).toThrow(/Cycle/);
  });

  it('effect writing a signal it reads (non-converging) throws "Cycle" instead of looping forever', () => {
    const s = observable(0);
    let enabled = false;
    const runs = vi.fn();
    effect(() => {
      runs();
      const v = s.value;
      if (enabled) s.set(v + 1);
    });
    enabled = true;
    expect(() => s.set(1)).toThrow(/Cycle/);
    // around 100 re-runs, definitely bounded
    expect(runs.mock.calls.length).toBeGreaterThanOrEqual(100);
    expect(runs.mock.calls.length).toBeLessThan(110);
  });

  it('effect that loops on creation throws "Cycle" (from effect() or terminates)', () => {
    const s = observable(0);
    let runs = 0;
    expect(() =>
      effect(() => {
        runs++;
        s.set(s.value + 1);
      }),
    ).toThrow(/Cycle/);
    expect(runs).toBeLessThan(110);
  });

  it('two effects ping-ponging throw "Cycle"', () => {
    const a = observable(0);
    const b = observable(0);
    let enabled = false;
    effect(() => {
      const v = a.value;
      if (enabled) b.set(v + 1);
    });
    effect(() => {
      const v = b.value;
      if (enabled) a.set(v + 1);
    });
    enabled = true;
    expect(() => a.set(1)).toThrow(/Cycle/);
  });

  it('system remains usable after a cycle error', () => {
    const s = observable(0);
    let enabled = false;
    effect(() => {
      const v = s.value;
      if (enabled) s.set(v + 1);
    });
    enabled = true;
    expect(() => s.set(1)).toThrow(/Cycle/);
    enabled = false;
    const t = observable(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(t.value);
    });
    t.set(1);
    expect(seen).toEqual([0, 1]);
    // batching still works (batch depth not left dangling)
    batch(() => t.set(2));
    expect(seen).toEqual([0, 1, 2]);
  });

  it('99 consecutive self-triggered re-runs are allowed (limit is 100)', () => {
    const s = observable(0);
    let enabled = false;
    effect(() => {
      const v = s.value;
      if (enabled && v < 90) s.set(v + 1);
    });
    enabled = true;
    expect(() => s.set(1)).not.toThrow();
    expect(s.value).toBe(90);
  });
});

describe('spec §1: writing inside computed', () => {
  it('writing to an observable inside a computed throws "Cannot write inside computed"', () => {
    const s = observable(0);
    const other = observable(0);
    const c = computed(() => {
      other.set(s.value + 1);
      return s.value;
    });
    expect(() => c.value).toThrow(/Cannot write inside computed/);
    expect(other.value).toBe(0);
  });

  it('value setter / update inside computed also throw', () => {
    const other = observable(0);
    const c1 = computed(() => {
      other.value = 1;
      return 1;
    });
    const c2 = computed(() => {
      other.update((p) => p + 1);
      return 1;
    });
    expect(() => c1.value).toThrow(/Cannot write inside computed/);
    expect(() => c2.value).toThrow(/Cannot write inside computed/);
  });

  it('writing inside an effect that is triggered by a computed is fine', () => {
    const s = observable(1);
    const c = computed(() => s.value * 2);
    const out = observable(0);
    effect(() => {
      out.set(c.value);
    });
    s.set(3);
    expect(out.value).toBe(6);
  });
});

describe('spec §1: computed errors', () => {
  it('error is cached and re-thrown on read until a dependency changes', () => {
    const s = observable(0);
    const fn = vi.fn(() => {
      if (s.value === 0) throw new Error('zero');
      return s.value;
    });
    const c = computed(fn);
    expect(() => c.value).toThrow('zero');
    expect(() => c.value).toThrow('zero');
    expect(() => c.get()).toThrow('zero');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('the cached error is the same error object', () => {
    const s = observable(0);
    const c = computed(() => {
      if (s.value === 0) throw new Error('zero');
      return s.value;
    });
    let e1: unknown, e2: unknown;
    try {
      c.value;
    } catch (e) {
      e1 = e;
    }
    try {
      c.value;
    } catch (e) {
      e2 = e;
    }
    expect(e1).toBe(e2);
  });

  it('recovers after a dependency changes', () => {
    const s = observable(0);
    const c = computed(() => {
      if (s.value === 0) throw new Error('zero');
      return s.value * 10;
    });
    expect(() => c.value).toThrow('zero');
    s.set(2);
    expect(c.value).toBe(20);
    s.set(0);
    expect(() => c.value).toThrow('zero');
    s.set(3);
    expect(c.value).toBe(30);
  });

  it('error propagates through downstream computeds and recovers', () => {
    const s = observable(0);
    const c = computed(() => {
      if (s.value === 0) throw new Error('zero');
      return s.value;
    });
    const d = computed(() => c.value + 1);
    expect(() => d.value).toThrow('zero');
    s.set(1);
    expect(d.value).toBe(2);
  });

  it('deps read before the throw are tracked (live computed recovers via subscriber)', () => {
    const s = observable(0);
    const c = computed(() => {
      const v = s.value;
      if (v === 0) throw new Error('zero');
      return v;
    });
    const cb = vi.fn();
    try {
      c.subscribe(cb);
    } catch {
      /* subscribing to an erroring computed may throw; not specified */
    }
    s.set(5);
    expect(c.value).toBe(5);
  });

  it('effect reading an erroring computed: error surfaces, and effect recovers when dep changes', () => {
    const s = observable(1);
    const c = computed(() => {
      if (s.value === 0) throw new Error('zero');
      return s.value;
    });
    const seen: number[] = [];
    effect(() => {
      seen.push(c.value);
    });
    expect(() => s.set(0)).toThrow('zero');
    s.set(2);
    expect(seen).toEqual([1, 2]);
  });
});

describe('spec §1: error isolation in flush', () => {
  it('error in one effect does not prevent other effects; first error re-thrown after flush', () => {
    const s = observable(0);
    const e1 = new Error('first');
    const e2 = new Error('second');
    const ran: string[] = [];
    effect(() => {
      if (s.value === 1) {
        ran.push('A');
        throw e1;
      }
    });
    effect(() => {
      if (s.value === 1) ran.push('B');
    });
    effect(() => {
      if (s.value === 1) {
        ran.push('C');
        throw e2;
      }
    });
    effect(() => {
      if (s.value === 1) ran.push('D');
    });
    let caught: unknown;
    try {
      s.set(1);
    } catch (e) {
      caught = e;
    }
    expect(ran.sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(caught).toBe(e1);
  });

  it('error in one subscriber does not prevent other subscribers; first error re-thrown', () => {
    const s = observable(0);
    const e1 = new Error('first');
    const e2 = new Error('second');
    const ran: string[] = [];
    s.subscribe(() => {
      ran.push('A');
      throw e1;
    });
    s.subscribe(() => ran.push('B'));
    s.subscribe(() => {
      ran.push('C');
      throw e2;
    });
    s.subscribe(() => ran.push('D'));
    let caught: unknown;
    try {
      s.set(1);
    } catch (e) {
      caught = e;
    }
    expect(ran).toEqual(['A', 'B', 'C', 'D']);
    expect(caught).toBe(e1);
  });

  it('error in a subscriber does not prevent effects in the same flush', () => {
    const s = observable(0);
    const effRuns = vi.fn();
    s.subscribe(() => {
      throw new Error('sub');
    });
    effect(() => {
      effRuns(s.value);
    });
    expect(() => s.set(1)).toThrow('sub');
    expect(effRuns).toHaveBeenLastCalledWith(1);
  });

  it('error in an effect does not prevent subscribers of other observables in the same batch', () => {
    const a = observable(0);
    const b = observable(0);
    const cb = vi.fn();
    effect(() => {
      if (a.value === 1) throw new Error('eff');
    });
    b.subscribe(cb);
    expect(() =>
      batch(() => {
        a.set(1);
        b.set(1);
      }),
    ).toThrow('eff');
    expect(cb).toHaveBeenCalledWith(1, 0);
  });

  it('after a flush with errors, the next flush works normally', () => {
    const s = observable(0);
    const seen: number[] = [];
    effect(() => {
      if (s.value === 1) throw new Error('x');
    });
    s.subscribe((v) => seen.push(v));
    expect(() => s.set(1)).toThrow('x');
    expect(() => s.set(2)).not.toThrow();
    expect(seen).toEqual([1, 2]);
  });

  it('[ambiguous] an effect that threw keeps tracking and re-runs on next change', () => {
    const s = observable(0);
    const runs = vi.fn();
    effect(() => {
      runs(s.value);
      if (s.value === 1) throw new Error('x');
    });
    expect(() => s.set(1)).toThrow('x');
    s.set(2);
    expect(runs).toHaveBeenLastCalledWith(2);
  });
});
