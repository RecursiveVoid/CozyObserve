import { describe, expect, it, vi } from 'vitest';
import { batch, computed, effect, observable, onCleanup, watch } from '../../src/index';
import type { ReadonlyObservable } from '../../src/index';

const chain = (n: number) => {
  const root = observable(0);
  let last: ReadonlyObservable<number> = root;
  for (let i = 0; i < n; i++) {
    const p = last;
    last = computed(() => p.value + 1);
  }
  return { root, last };
};

describe('dev round 2 (PM decisions)', () => {
  it('10k chain: cold read, warm re-read, effect propagation, dispose', () => {
    const { root, last } = chain(10_000);
    expect(last.value).toBe(10_000);
    root.set(1);
    expect(last.value).toBe(10_001);
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(last.value);
    });
    root.set(2);
    root.set(3);
    expect(seen).toEqual([10_001, 10_002, 10_003]);
    stop();
    root.set(4);
    expect(seen.length).toBe(3);
    expect(last.value).toBe(10_004);
  });

  it('10k chain warmed unobserved, then subscribed (deep subscribe cascade)', () => {
    const { root, last } = chain(10_000);
    expect(last.value).toBe(10_000);
    const cb = vi.fn();
    const un = last.subscribe(cb);
    root.set(5);
    expect(cb).toHaveBeenCalledWith(10_005, 10_000);
    un();
  });

  it('effect not re-run when computed returns to the value it saw (set+reset in batch)', () => {
    const a = observable(1);
    const c = computed(() => a.value * 2);
    const log: number[] = [];
    effect(() => {
      log.push(c.value);
    });
    batch(() => {
      a.set(2);
      c.value;
      a.set(1);
    });
    expect(log).toEqual([2]);
    a.set(3);
    expect(log).toEqual([2, 6]);
  });

  it('subscribe on raw observable: set+reset in batch does not fire', () => {
    const a = observable(1);
    const cb = vi.fn();
    a.subscribe(cb);
    batch(() => {
      a.set(2);
      a.set(1);
    });
    expect(cb).not.toHaveBeenCalled();
    batch(() => {
      a.set(2);
      a.set(3);
    });
    expect(cb).toHaveBeenCalledWith(3, 1);
  });

  it('subscribe()/watch() inside an effect are not owned', () => {
    const trigger = observable(0);
    const s = observable(0);
    const sub = vi.fn();
    const w = vi.fn();
    let n = 0;
    effect(() => {
      trigger.value;
      if (n++ === 0) {
        s.subscribe(sub);
        watch(s, w);
      }
    });
    trigger.set(1); // parent re-runs
    s.set(1);
    expect(sub).toHaveBeenCalledTimes(1);
    expect(w).toHaveBeenCalledTimes(1);
  });

  it('cleanup order: onCleanup in registration order, then returned cleanup', () => {
    const a = observable(0);
    const order: string[] = [];
    const stop = effect(() => {
      a.value;
      onCleanup(() => order.push('c1'));
      onCleanup(() => order.push('c2'));
      return () => order.push('ret');
    });
    a.set(1);
    expect(order).toEqual(['c1', 'c2', 'ret']);
    stop();
    expect(order).toEqual(['c1', 'c2', 'ret', 'c1', 'c2', 'ret']);
  });

  it('effects run in scheduling order (creation order) across sources', () => {
    const a = observable(0);
    const b = observable(0);
    const order: string[] = [];
    effect(() => {
      if (a.value) order.push('A');
    });
    effect(() => {
      if (b.value) order.push('B');
    });
    effect(() => {
      if (a.value) order.push('A2');
    });
    batch(() => {
      a.set(1);
      b.set(1);
    });
    expect(order).toEqual(['A', 'A2', 'B']);
  });

  it('computed is read-only at runtime', () => {
    const c = computed(() => 1) as any;
    expect(() => c.set(2)).toThrow();
    expect(() => c.update((x: number) => x)).toThrow();
    expect(() => {
      c.value = 3;
    }).toThrow();
    expect(c.value).toBe(1);
  });

  it('errors deep in a 5k chain are cached and propagate', () => {
    const root = observable(0);
    let last: ReadonlyObservable<number> = computed(() => {
      if (root.value === 1) throw new Error('deep');
      return root.value;
    });
    for (let i = 0; i < 5000; i++) {
      const p = last;
      last = computed(() => p.value + 1);
    }
    expect(last.value).toBe(5000);
    root.set(1);
    expect(() => last.value).toThrow('deep');
    root.set(2);
    expect(last.value).toBe(5002);
  });
});

describe('dev round 3 (review bugs)', () => {
  it('a throwing user equals during flush re-validation does not kill the scheduler', () => {
    const b = observable(1, {
      equals: (x, y) => {
        if (x === 1 && y === 3) throw new Error('eq');
        return x === y;
      },
    });
    effect(() => {
      b.value;
    });
    const o2 = observable(0);
    let runs = 0;
    effect(() => {
      o2.value;
      runs++;
    });
    expect(() =>
      batch(() => {
        b.set(2);
        b.set(3);
        o2.set(1);
      }),
    ).toThrow('eq');
    expect(runs).toBe(2);
    const fresh = observable(0);
    let fr = 0;
    effect(() => {
      fresh.value;
      fr++;
    });
    fresh.set(1);
    o2.set(5);
    expect(fr).toBe(2);
    expect(runs).toBe(3);
  });

  it('internal deferral is not swallowed by a user try/catch in a deep chain', () => {
    const src = observable(1);
    let c: ReadonlyObservable<number> = computed(() => src.value);
    for (let i = 0; i < 3000; i++) {
      const p = c;
      c =
        i === 2500
          ? computed(() => {
              try {
                return p.value + 1;
              } catch {
                return -999;
              }
            })
          : computed(() => p.value + 1);
    }
    expect(c.value).toBe(3001);
    src.set(2);
    expect(c.value).toBe(3002);
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(c.value);
    });
    src.set(3);
    expect(seen).toEqual([3002, 3003]);
    stop();
  });
});
