import { describe, it, expect, vi } from 'vitest';
import { observable, computed, effect, batch } from '../../src/index';

describe('spec §1: batch', () => {
  it('returns the fn value', () => {
    expect(batch(() => 123)).toBe(123);
    const o = {};
    expect(batch(() => o)).toBe(o);
  });

  it('nested batch returns inner value', () => {
    expect(batch(() => batch(() => 'x') + 'y')).toBe('xy');
  });

  it('effects run after the outermost batch ends, not after inner batches', () => {
    const s = observable(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(s.value);
    });
    batch(() => {
      s.set(1);
      batch(() => {
        s.set(2);
      });
      expect(seen).toEqual([0]);
      batch(() => {
        batch(() => s.set(3));
      });
      expect(seen).toEqual([0]);
    });
    expect(seen).toEqual([0, 3]);
  });

  it('subscribers notified once after batch with (final, original)', () => {
    const s = observable(0);
    const cb = vi.fn();
    s.subscribe(cb);
    batch(() => {
      s.set(1);
      s.set(2);
      s.set(3);
      expect(cb).not.toHaveBeenCalled();
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(3, 0);
  });

  it('set inside batch is immediately visible via .value / get() / peek()', () => {
    const s = observable(1);
    batch(() => {
      s.set(2);
      expect(s.value).toBe(2);
      expect(s.get()).toBe(2);
      expect(s.peek()).toBe(2);
      s.update((p) => p + 1);
      expect(s.value).toBe(3);
    });
  });

  it('updater form inside batch sees the latest batched value', () => {
    const s = observable(0);
    batch(() => {
      s.set((p) => p + 1);
      s.set((p) => p + 1);
      s.update((p) => p + 1);
    });
    expect(s.value).toBe(3);
  });

  it('computed read inside batch is up to date, and effect on it runs once after', () => {
    const a = observable(1);
    const b = observable(1);
    const sum = computed(() => a.value + b.value);
    const eff = vi.fn();
    effect(() => {
      eff(sum.value);
    });
    batch(() => {
      a.set(10);
      expect(sum.value).toBe(11);
      b.set(10);
      expect(sum.value).toBe(20);
    });
    expect(eff).toHaveBeenCalledTimes(2);
    expect(eff).toHaveBeenLastCalledWith(20);
  });

  it('effects never observe half-updated state across a batch', () => {
    const first = observable('John');
    const last = observable('Doe');
    const seen: string[] = [];
    effect(() => {
      seen.push(`${first.value} ${last.value}`);
    });
    batch(() => {
      first.set('Jane');
      last.set('Smith');
    });
    expect(seen).toEqual(['John Doe', 'Jane Smith']);
  });

  it('batch that throws still ends the batch (later sets flush normally)', () => {
    const s = observable(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(s.value);
    });
    expect(() =>
      batch(() => {
        s.set(1);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    s.set(2);
    expect(seen[seen.length - 1]).toBe(2);
    expect(s.value).toBe(2);
  });

  it('batch that throws: changes made before the throw are kept and flushed', () => {
    const s = observable(0);
    const cb = vi.fn();
    s.subscribe(cb);
    try {
      batch(() => {
        s.set(1);
        throw new Error('boom');
      });
    } catch {
      /* expected */
    }
    expect(s.value).toBe(1);
    expect(cb).toHaveBeenCalledWith(1, 0);
  });

  it('set and reset to original value within batch: final value correct, effect sees original', () => {
    const s = observable(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(s.value);
    });
    batch(() => {
      s.set(1);
      s.set(0);
    });
    expect(s.value).toBe(0);
    // effect may or may not re-run (spec ambiguous), but must never observe 1
    expect(seen).not.toContain(1);
  });

  it('effect writes inside the flush are batched/flushed too (chain of effects settles)', () => {
    const a = observable(0);
    const b = observable(0);
    const c = observable(0);
    effect(() => b.set(a.value + 1));
    effect(() => c.set(b.value + 1));
    batch(() => a.set(10));
    expect(b.value).toBe(11);
    expect(c.value).toBe(12);
  });

  it('effect created inside a batch runs synchronously on creation', () => {
    const fn = vi.fn();
    batch(() => {
      effect(fn);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
