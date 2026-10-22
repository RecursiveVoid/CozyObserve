import { describe, it, expect, vi } from 'vitest';
import { observable, computed, effect, batch, untracked } from '../../src/index';
import type { ReadonlyObservable } from '../../src/index';

describe('spec §1: lazy computeds', () => {
  it('fn does not run until first read', () => {
    const s = observable(1);
    const fn = vi.fn(() => s.value * 2);
    const c = computed(fn);
    expect(fn).not.toHaveBeenCalled();
    s.set(2);
    expect(fn).not.toHaveBeenCalled();
    expect(c.value).toBe(4);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reading twice with no source changes runs fn once', () => {
    const s = observable(1);
    const fn = vi.fn(() => s.value * 2);
    const c = computed(fn);
    expect(c.value).toBe(2);
    expect(c.get()).toBe(2);
    expect(c.peek()).toBe(2);
    expect(c.value).toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('computed with no deps runs once forever', () => {
    const fn = vi.fn(() => 7);
    const c = computed(fn);
    expect(c.value).toBe(7);
    const other = observable(0);
    other.set(1);
    expect(c.value).toBe(7);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('unobserved computed does not recompute on source change until read, then is correct', () => {
    const s = observable(1);
    const fn = vi.fn(() => s.value + 100);
    const c = computed(fn);
    expect(c.value).toBe(101);
    s.set(2);
    s.set(3);
    s.set(4);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.value).toBe(104);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('unobserved computed: unrelated signal change does not cause recompute on read', () => {
    const s = observable(1);
    const unrelated = observable(0);
    const fn = vi.fn(() => s.value);
    const c = computed(fn);
    c.value;
    unrelated.set(1);
    unrelated.set(2);
    expect(c.value).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('many abandoned computeds are not invoked when source changes (no retained subscriptions)', () => {
    const s = observable(0);
    const fn = vi.fn(() => s.value);
    for (let i = 0; i < 1000; i++) {
      const c = computed(fn);
      c.value;
    }
    expect(fn).toHaveBeenCalledTimes(1000);
    s.set(1);
    expect(fn).toHaveBeenCalledTimes(1000);
  });

  it('source set back to the same value it had: computed still correct', () => {
    const s = observable(1);
    const fn = vi.fn(() => s.value * 10);
    const c = computed(fn);
    expect(c.value).toBe(10);
    s.set(2);
    s.set(1);
    expect(c.value).toBe(10);
  });

  it('fn receives previous value (undefined on first run)', () => {
    const s = observable(1);
    const prevs: Array<number | undefined> = [];
    const c = computed<number>((prev) => {
      prevs.push(prev);
      return s.value * 2;
    });
    c.value;
    s.set(5);
    c.value;
    expect(prevs).toEqual([undefined, 2]);
  });

  it('computed of computed chains correctly', () => {
    const a = observable(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => b.value * 2);
    expect(c.value).toBe(4);
    a.set(10);
    expect(c.value).toBe(22);
  });
});

describe('spec §1: GC-friendliness (FinalizationRegistry, only with --expose-gc)', () => {
  const gc = (globalThis as { gc?: () => void }).gc;
  it.skipIf(!gc)('unobserved computed is collectable while its source lives', async () => {
    const s = observable(1);
    let collected = false;
    const reg = new FinalizationRegistry(() => {
      collected = true;
    });
    (() => {
      const c = computed(() => s.value + 1);
      c.value;
      reg.register(c, 'c');
    })();
    for (let i = 0; i < 20 && !collected; i++) {
      gc!();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(collected).toBe(true);
    s.set(2);
  });
});

describe('spec §1: diamond / glitch-free', () => {
  it('a → b, a → c, (b,c) → d: d runs exactly once per set, consistent', () => {
    const a = observable(1);
    const b = computed(() => a.value * 2);
    const c = computed(() => a.value * 3);
    const dFn = vi.fn(() => `${b.value}+${c.value}`);
    const d = computed(dFn);
    const seen: string[] = [];
    effect(() => {
      seen.push(d.value);
    });
    expect(dFn).toHaveBeenCalledTimes(1);
    a.set(2);
    expect(dFn).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['2+3', '4+6']);
    a.set(3);
    expect(dFn).toHaveBeenCalledTimes(3);
    expect(seen).toEqual(['2+3', '4+6', '6+9']);
  });

  it('diamond, lazy (no effect): d recomputes once per read after change', () => {
    const a = observable(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => a.value + 2);
    const dFn = vi.fn(() => b.value + c.value);
    const d = computed(dFn);
    expect(d.value).toBe(5);
    a.set(2);
    expect(d.value).toBe(7);
    expect(dFn).toHaveBeenCalledTimes(2);
  });

  it('effect reading a and a derived computed directly never sees inconsistent state', () => {
    const a = observable(1);
    const double = computed(() => a.value * 2);
    const pairs: Array<[number, number]> = [];
    effect(() => {
      pairs.push([a.value, double.value]);
    });
    a.set(2);
    a.set(3);
    for (const [x, y] of pairs) expect(y).toBe(x * 2);
    expect(pairs.length).toBe(3);
  });

  it('wide diamond: d depends on 50 computeds of a; runs once per set', () => {
    const a = observable(0);
    const mids = Array.from({ length: 50 }, (_, i) => computed(() => a.value + i));
    const dFn = vi.fn(() => mids.reduce((s, m) => s + m.value, 0));
    const d = computed(dFn);
    const eff = vi.fn();
    effect(() => {
      eff(d.value);
    });
    a.set(1);
    expect(dFn).toHaveBeenCalledTimes(2);
    expect(eff).toHaveBeenCalledTimes(2);
    expect(eff).toHaveBeenLastCalledWith(50 + (49 * 50) / 2);
  });

  it('uneven diamond (a → b → c → d, a → d): d runs once', () => {
    const a = observable(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => b.value + 1);
    const dFn = vi.fn(() => a.value + c.value);
    const d = computed(dFn);
    const seen: number[] = [];
    effect(() => {
      seen.push(d.value);
    });
    a.set(10);
    expect(dFn).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([4, 22]);
  });
});

describe('spec §1: deep chains', () => {
  it('1000-long computed chain does not overflow on read', () => {
    const root = observable(0);
    let last: ReadonlyObservable<number> = root;
    for (let i = 0; i < 1000; i++) {
      const prev = last;
      last = computed(() => prev.value + 1);
    }
    expect(last.value).toBe(1000);
    root.set(5);
    expect(last.value).toBe(1005);
  });

  it('1000-long chain with an effect at the end propagates', () => {
    const root = observable(0);
    let last: ReadonlyObservable<number> = root;
    for (let i = 0; i < 1000; i++) {
      const prev = last;
      last = computed(() => prev.value + 1);
    }
    const seen: number[] = [];
    effect(() => {
      seen.push(last.value);
    });
    root.set(1);
    expect(seen).toEqual([1000, 1001]);
  });

  it('1000-long chain read first time from the root side only at the end (cold)', () => {
    const root = observable(1);
    const nodes: ReadonlyObservable<number>[] = [];
    let last: ReadonlyObservable<number> = root;
    for (let i = 0; i < 1000; i++) {
      const prev = last;
      last = computed(() => prev.value);
      nodes.push(last);
    }
    root.set(2);
    expect(nodes[999].value).toBe(2);
    expect(nodes[0].value).toBe(2);
  });
});

describe('spec §1: dynamic dependencies', () => {
  it('branch not taken is unsubscribed (effect)', () => {
    const cond = observable(true);
    const a = observable('a');
    const b = observable('b');
    const runs = vi.fn();
    effect(() => {
      runs(cond.value ? a.value : b.value);
    });
    expect(runs).toHaveBeenCalledTimes(1);
    b.set('b2'); // not tracked yet
    expect(runs).toHaveBeenCalledTimes(1);
    cond.set(false);
    expect(runs).toHaveBeenCalledTimes(2);
    expect(runs).toHaveBeenLastCalledWith('b2');
    a.set('a2'); // old branch, no longer tracked
    expect(runs).toHaveBeenCalledTimes(2);
    b.set('b3');
    expect(runs).toHaveBeenCalledTimes(3);
    expect(runs).toHaveBeenLastCalledWith('b3');
  });

  it('branch not taken is unsubscribed (live computed)', () => {
    const cond = observable(true);
    const a = observable(1);
    const b = observable(2);
    const fn = vi.fn(() => (cond.value ? a.value : b.value));
    const c = computed(fn);
    const cb = vi.fn();
    c.subscribe(cb);
    const base = fn.mock.calls.length;
    cond.set(false);
    expect(fn.mock.calls.length).toBe(base + 1);
    a.set(100);
    expect(fn.mock.calls.length).toBe(base + 1);
    b.set(3);
    expect(fn.mock.calls.length).toBe(base + 2);
    expect(c.value).toBe(3);
  });

  it('branch not taken (lazy computed): reading after old-branch change does not recompute', () => {
    const cond = observable(true);
    const a = observable(1);
    const b = observable(2);
    const fn = vi.fn(() => (cond.value ? a.value : b.value));
    const c = computed(fn);
    expect(c.value).toBe(1);
    cond.set(false);
    expect(c.value).toBe(2);
    a.set(50);
    expect(c.value).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('deps added on later runs are tracked', () => {
    const n = observable(1);
    const sigs = [observable(0), observable(0), observable(0)];
    const runs = vi.fn();
    effect(() => {
      let sum = 0;
      for (let i = 0; i < n.value; i++) sum += sigs[i].value;
      runs(sum);
    });
    sigs[2].set(5);
    expect(runs).toHaveBeenCalledTimes(1);
    n.set(3);
    expect(runs).toHaveBeenLastCalledWith(5);
    sigs[2].set(6);
    expect(runs).toHaveBeenLastCalledWith(6);
    expect(runs).toHaveBeenCalledTimes(3);
  });

  it('reading the same dep multiple times in one run tracks it once (one rerun per change)', () => {
    const s = observable(1);
    const runs = vi.fn();
    effect(() => {
      runs(s.value + s.value + s.get());
    });
    s.set(2);
    expect(runs).toHaveBeenCalledTimes(2);
  });
});

describe('spec §1: equality cutoff', () => {
  it('computed recomputing to equal value does not rerun downstream computeds/effects/subscribers', () => {
    const a = observable(0);
    const parity = computed(() => a.value % 2);
    const downFn = vi.fn(() => parity.value * 10);
    const down = computed(downFn);
    const eff = vi.fn();
    const sub = vi.fn();
    effect(() => {
      eff(down.value);
    });
    parity.subscribe(sub);
    expect(downFn).toHaveBeenCalledTimes(1);
    a.set(2);
    a.set(4);
    expect(downFn).toHaveBeenCalledTimes(1);
    expect(eff).toHaveBeenCalledTimes(1);
    expect(sub).not.toHaveBeenCalled();
    a.set(5);
    expect(downFn).toHaveBeenCalledTimes(2);
    expect(eff).toHaveBeenCalledTimes(2);
    expect(sub).toHaveBeenCalledWith(1, 0);
  });

  it('equality cutoff on lazy path: downstream not recomputed on read', () => {
    const a = observable(0);
    const parity = computed(() => a.value % 2);
    const downFn = vi.fn(() => parity.value);
    const down = computed(downFn);
    down.value;
    a.set(2);
    expect(down.value).toBe(0);
    expect(downFn).toHaveBeenCalledTimes(1);
  });

  it('custom equals on computed cuts off downstream', () => {
    const a = observable({ id: 1, n: 0 });
    const c = computed(() => ({ id: a.value.id, n: a.value.n }), {
      equals: (x, y) => x.id === y.id,
    });
    const eff = vi.fn();
    effect(() => {
      eff(c.value.id);
    });
    a.set({ id: 1, n: 5 });
    expect(eff).toHaveBeenCalledTimes(1);
    a.set({ id: 2, n: 5 });
    expect(eff).toHaveBeenCalledTimes(2);
    expect(eff).toHaveBeenLastCalledWith(2);
  });

  it('custom equals on computed: value keeps the old (equal) object', () => {
    const a = observable(1);
    const c = computed(() => ({ v: Math.floor(a.value / 10) }), {
      equals: (x, y) => x.v === y.v,
    });
    const first = c.value;
    a.set(2);
    expect(c.value).toBe(first);
  });

  it('computed returning a new array each run notifies every time with default equals', () => {
    const a = observable(1);
    const c = computed(() => [a.value % 2]);
    const eff = vi.fn();
    effect(() => {
      eff(c.value);
    });
    a.set(3);
    expect(eff).toHaveBeenCalledTimes(2);
  });
});

describe('spec §1: untracked / peek inside computed', () => {
  it('peek inside computed does not register a dependency', () => {
    const a = observable(1);
    const b = observable(10);
    const fn = vi.fn(() => a.value + b.peek());
    const c = computed(fn);
    const sub = vi.fn();
    c.subscribe(sub);
    const base = fn.mock.calls.length;
    b.set(20);
    expect(fn.mock.calls.length).toBe(base);
    expect(sub).not.toHaveBeenCalled();
    a.set(2);
    expect(c.value).toBe(22);
  });

  it('untracked inside computed does not register a dependency', () => {
    const a = observable(1);
    const b = observable(10);
    const fn = vi.fn(() => a.value + untracked(() => b.value));
    const c = computed(fn);
    expect(c.value).toBe(11);
    b.set(20);
    expect(c.value).toBe(11);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('computed.peek() inside effect does not track the computed', () => {
    const a = observable(1);
    const c = computed(() => a.value * 2);
    const runs = vi.fn();
    effect(() => {
      runs(c.peek());
    });
    a.set(2);
    expect(runs).toHaveBeenCalledTimes(1);
    expect(c.peek()).toBe(4);
  });
});

describe('spec §1: batch + computed', () => {
  it('computeds read inside a batch are up to date', () => {
    const a = observable(1);
    const c = computed(() => a.value * 2);
    const eff = vi.fn();
    effect(() => {
      eff(c.value);
    });
    batch(() => {
      a.set(5);
      expect(c.value).toBe(10);
      a.set(6);
      expect(c.value).toBe(12);
      expect(eff).toHaveBeenCalledTimes(1);
    });
    expect(eff).toHaveBeenCalledTimes(2);
    expect(eff).toHaveBeenLastCalledWith(12);
  });
});
