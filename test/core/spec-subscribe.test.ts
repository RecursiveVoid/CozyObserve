import { describe, it, expect, vi } from 'vitest';
import { observable, computed, effect, batch } from '../../src/index';

describe('spec §1: subscribe', () => {
  it('not called initially', () => {
    const s = observable(1);
    const cb = vi.fn();
    s.subscribe(cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('called with (value, prev) after each change', () => {
    const s = observable(1);
    const cb = vi.fn();
    s.subscribe(cb);
    s.set(2);
    s.set(3);
    expect(cb.mock.calls).toEqual([
      [2, 1],
      [3, 2],
    ]);
  });

  it('immediate: true → called synchronously with (value, value)', () => {
    const s = observable(7);
    const cb = vi.fn();
    s.subscribe(cb, { immediate: true });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(7, 7);
    s.set(8);
    expect(cb).toHaveBeenLastCalledWith(8, 7);
  });

  it('unsubscribe stops notifications and is idempotent', () => {
    const s = observable(1);
    const cb = vi.fn();
    const unsub = s.subscribe(cb);
    unsub();
    unsub();
    s.set(2);
    expect(cb).not.toHaveBeenCalled();
  });

  it('callback does not become a tracked dependency of a surrounding effect', () => {
    const s = observable(1);
    const other = observable(1);
    const effRuns = vi.fn();
    effect(() => {
      effRuns();
    });
    s.subscribe(() => {
      other.value;
    });
    s.set(2);
    other.set(2);
    expect(effRuns).toHaveBeenCalledTimes(1);
  });

  it('reads inside the subscriber callback are not tracked (do not re-trigger it)', () => {
    const s = observable(1);
    const other = observable(1);
    const cb = vi.fn(() => {
      other.value;
    });
    s.subscribe(cb);
    s.set(2);
    other.set(2);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing itself inside callback is safe; following subscribers still called', () => {
    const s = observable(0);
    const calls: string[] = [];
    let unsubA: () => void = () => {};
    unsubA = s.subscribe(() => {
      calls.push('A');
      unsubA();
    });
    s.subscribe(() => calls.push('B'));
    s.subscribe(() => calls.push('C'));
    s.set(1);
    expect(calls.sort()).toEqual(['A', 'B', 'C']);
    calls.length = 0;
    s.set(2);
    expect(calls.sort()).toEqual(['B', 'C']);
  });

  it('unsubscribing another subscriber inside a callback is safe', () => {
    const s = observable(0);
    const calls: string[] = [];
    let unsubB: () => void = () => {};
    s.subscribe(() => {
      calls.push('A');
      unsubB();
    });
    unsubB = s.subscribe(() => calls.push('B'));
    s.subscribe(() => calls.push('C'));
    expect(() => s.set(1)).not.toThrow();
    expect(calls).toContain('A');
    expect(calls).toContain('C');
    calls.length = 0;
    s.set(2);
    expect(calls.sort()).toEqual(['A', 'C']);
  });

  it('unsubscribing an earlier subscriber from a later one is safe', () => {
    const s = observable(0);
    const calls: string[] = [];
    const unsubA = s.subscribe(() => calls.push('A'));
    s.subscribe(() => {
      calls.push('B');
      unsubA();
    });
    s.subscribe(() => calls.push('C'));
    s.set(1);
    expect(calls).toEqual(['A', 'B', 'C']);
    calls.length = 0;
    s.set(2);
    expect(calls).toEqual(['B', 'C']);
  });

  it('unsubscribing all subscribers from inside the first callback is safe', () => {
    const s = observable(0);
    const unsubs: Array<() => void> = [];
    const cb = vi.fn();
    unsubs.push(
      s.subscribe(() => {
        unsubs.forEach((u) => u());
      }),
    );
    for (let i = 0; i < 5; i++) unsubs.push(s.subscribe(cb));
    expect(() => s.set(1)).not.toThrow();
    cb.mockClear();
    s.set(2);
    expect(cb).not.toHaveBeenCalled();
  });

  it('subscribing a new callback during notification does not break the flush', () => {
    const s = observable(0);
    const late = vi.fn();
    let added = false;
    s.subscribe(() => {
      if (!added) {
        added = true;
        s.subscribe(late);
      }
    });
    expect(() => s.set(1)).not.toThrow();
    late.mockClear();
    s.set(2);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith(2, 1);
  });

  it('same function subscribed twice is called twice; subscriptions are independent', () => {
    const s = observable(0);
    const cb = vi.fn();
    const u1 = s.subscribe(cb);
    s.subscribe(cb);
    s.set(1);
    expect(cb).toHaveBeenCalledTimes(2);
    u1();
    s.set(2);
    expect(cb).toHaveBeenCalledTimes(3);
    u1(); // calling the same unsubscribe again must not remove the other
    s.set(3);
    expect(cb).toHaveBeenCalledTimes(4);
  });

  it('subscriber that sets the same observable gets consistent notifications', () => {
    const s = observable(0);
    const seen: Array<[number, number]> = [];
    s.subscribe((v, p) => {
      seen.push([v, p]);
      if (v < 3) s.set(v + 1);
    });
    s.set(1);
    expect(s.value).toBe(3);
    expect(seen[seen.length - 1][0]).toBe(3);
    for (const [v, p] of seen) expect(v).not.toBe(p);
  });
});

describe('spec §1: subscribe on computed', () => {
  it('cb(value, prev) fires when computed value changes, not initially', () => {
    const a = observable(1);
    const c = computed(() => a.value * 2);
    const cb = vi.fn();
    c.subscribe(cb);
    expect(cb).not.toHaveBeenCalled();
    a.set(2);
    expect(cb).toHaveBeenCalledWith(4, 2);
  });

  it('immediate on computed gives (value, value)', () => {
    const a = observable(3);
    const c = computed(() => a.value + 1);
    const cb = vi.fn();
    c.subscribe(cb, { immediate: true });
    expect(cb).toHaveBeenCalledWith(4, 4);
  });

  it('subscribe makes computed live (eagerly recomputed without reads)', () => {
    const a = observable(1);
    const fn = vi.fn(() => a.value * 2);
    const c = computed(fn);
    c.subscribe(() => {});
    const base = fn.mock.calls.length;
    a.set(2);
    expect(fn.mock.calls.length).toBe(base + 1);
    a.set(3);
    expect(fn.mock.calls.length).toBe(base + 2);
  });

  it('after the last subscriber leaves the computed is lazy again but still correct', () => {
    const a = observable(1);
    const fn = vi.fn(() => a.value * 2);
    const c = computed(fn);
    const u1 = c.subscribe(() => {});
    const u2 = c.subscribe(() => {});
    a.set(2);
    u1();
    const n1 = fn.mock.calls.length;
    a.set(3); // still live via u2
    expect(fn.mock.calls.length).toBe(n1 + 1);
    u2();
    const n2 = fn.mock.calls.length;
    a.set(4);
    a.set(5);
    expect(fn.mock.calls.length).toBe(n2);
    expect(c.value).toBe(10);
    expect(fn.mock.calls.length).toBe(n2 + 1);
  });

  it('computed with subscriber and effect: removing subscriber keeps it live for effect', () => {
    const a = observable(1);
    const fn = vi.fn(() => a.value + 1);
    const c = computed(fn);
    const seen: number[] = [];
    effect(() => {
      seen.push(c.value);
    });
    const u = c.subscribe(() => {});
    u();
    a.set(5);
    expect(seen).toEqual([2, 6]);
  });

  it('equality cutoff applies to computed subscribers', () => {
    const a = observable(1);
    const c = computed(() => a.value > 0);
    const cb = vi.fn();
    c.subscribe(cb);
    a.set(2);
    a.set(3);
    expect(cb).not.toHaveBeenCalled();
    a.set(-1);
    expect(cb).toHaveBeenCalledWith(false, true);
  });

  it('subscribers to a computed fire once per batch with (final, original)', () => {
    const a = observable(1);
    const b = observable(1);
    const c = computed(() => a.value + b.value);
    const cb = vi.fn();
    c.subscribe(cb);
    batch(() => {
      a.set(2);
      b.set(3);
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(5, 2);
  });

  it('diamond: subscriber on d is called once per set', () => {
    const a = observable(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => a.value + 2);
    const d = computed(() => b.value * c.value);
    const cb = vi.fn();
    d.subscribe(cb);
    a.set(2);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(12, 6);
  });
});
