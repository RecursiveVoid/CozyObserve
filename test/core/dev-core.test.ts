import { describe, expect, it, vi } from 'vitest';
import {
  batch,
  computed,
  effect,
  isObservable,
  observable,
  onCleanup,
  untracked,
  watch,
} from '../../src/index';
import {
  Computed,
  Signal,
  Tracker,
  createTracker,
  endBatch,
  getCurrentObserver,
  startBatch,
} from '../../src/core/internal';

describe('dev: core', () => {
  it('observable() returns a Signal; subclassing keeps instanceof', () => {
    class Observer<T> extends Signal<T> {}
    const o = new Observer(1);
    expect(o).toBeInstanceOf(Signal);
    expect(isObservable(o)).toBe(true);
    expect(observable(1)).toBeInstanceOf(Signal);
    expect(computed(() => 1)).toBeInstanceOf(Computed);
    o.value = 2;
    expect(o.get()).toBe(2);
  });

  it('computed self-read throws Cycle; error cached until dep changes', () => {
    const c: { value: number } = computed((): number => c.value + 1);
    expect(() => c.value).toThrow(/Cycle/);
    let n = 0;
    const a = observable(0);
    const bad = computed(() => {
      n++;
      if (a.value === 0) throw new Error('boom');
      return a.value;
    });
    expect(() => bad.value).toThrow('boom');
    expect(() => bad.value).toThrow('boom');
    expect(n).toBe(1);
    a.set(1);
    expect(bad.value).toBe(1);
  });

  it('write inside computed throws', () => {
    const a = observable(0);
    const c = computed(() => {
      a.set(1);
      return 1;
    });
    expect(() => c.value).toThrow('Cannot write inside computed');
  });

  it('effect writing its own dep throws Cycle and does not hang', () => {
    const a = observable(0);
    expect(() => effect(() => a.set(a.value + 1))).toThrow(/Cycle/);
  });

  it('nested effects are disposed on parent re-run and dispose', () => {
    const a = observable(0);
    const b = observable(0);
    const inner = vi.fn();
    const stop = effect(() => {
      a.value;
      effect(() => inner(b.value));
    });
    expect(inner).toHaveBeenCalledTimes(1);
    a.set(1); // parent re-runs → old child disposed, new child created
    expect(inner).toHaveBeenCalledTimes(2);
    b.set(1); // only one child alive
    expect(inner).toHaveBeenCalledTimes(3);
    stop();
    b.set(2);
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it('onCleanup inside untracked still registers on the running effect', () => {
    const a = observable(0);
    const cl = vi.fn();
    const stop = effect(() => {
      a.value;
      untracked(() => onCleanup(cl));
    });
    a.set(1);
    expect(cl).toHaveBeenCalledTimes(1);
    stop();
    expect(cl).toHaveBeenCalledTimes(2);
  });

  it('watch: getter, equals, once, onCleanup', () => {
    const a = observable({ n: 1, x: 0 });
    const cl = vi.fn();
    const cb = vi.fn((_v: number, _p: number | undefined, oc: (f: () => void) => void) => oc(cl));
    const stop = watch(() => a.value.n, cb);
    a.set({ n: 1, x: 1 }); // selected value equal → no cb
    expect(cb).not.toHaveBeenCalled();
    a.set({ n: 2, x: 1 });
    expect(cb).toHaveBeenLastCalledWith(2, 1, expect.any(Function));
    expect(cl).not.toHaveBeenCalled();
    a.set({ n: 3, x: 1 });
    expect(cl).toHaveBeenCalledTimes(1);
    stop();
    expect(cl).toHaveBeenCalledTimes(2);

    const once = vi.fn();
    const s = observable(0);
    watch(s, once, { once: true });
    s.set(1);
    s.set(2);
    expect(once).toHaveBeenCalledTimes(1);

    const eq = vi.fn();
    const o = observable({ id: 1 });
    watch(o, eq, { equals: (x, y) => x.id === y.id, immediate: true });
    expect(eq).toHaveBeenCalledWith({ id: 1 }, undefined, expect.any(Function));
    o.set({ id: 1 });
    expect(eq).toHaveBeenCalledTimes(1);
  });

  it('error isolation: all effects run, first error rethrown', () => {
    const a = observable(0);
    const ran: number[] = [];
    effect(() => {
      if (a.value) throw new Error('e1');
    });
    effect(() => {
      ran.push(a.value);
    });
    effect(() => {
      if (a.value) throw new Error('e3');
    });
    expect(() => a.set(1)).toThrow('e1');
    expect(ran).toEqual([0, 1]);
  });

  it('unobserved computed is not referenced by its source', () => {
    const a = observable(1);
    const c = computed(() => a.value * 2);
    expect(c.value).toBe(2);
    expect((a as any)._targets).toBeUndefined();
    const stop = c.subscribe(() => {});
    expect((a as any)._targets).toBeDefined();
    stop();
    expect((a as any)._targets).toBeUndefined();
    a.set(2);
    expect(c.value).toBe(4);
  });

  it('startBatch/endBatch defer effects', () => {
    const a = observable(0);
    const fn = vi.fn(() => a.value);
    effect(fn);
    startBatch();
    a.set(1);
    a.set(2);
    expect(fn).toHaveBeenCalledTimes(1);
    endBatch();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('raw Signal _set stores functions as values', () => {
    const s = new Signal<unknown>(0);
    const f = () => 1;
    s._set(f);
    expect(s.peek()).toBe(f);
  });
});

describe('dev: Tracker', () => {
  it('records deps between start/stop and notifies once per flush', () => {
    const a = observable(1);
    const b = observable(2);
    const onChange = vi.fn();
    const t = createTracker(onChange);
    t.start();
    expect(getCurrentObserver()).toBe(t);
    a.value;
    t.stop();
    expect(getCurrentObserver()).toBeUndefined();
    b.set(3);
    expect(onChange).not.toHaveBeenCalled();
    batch(() => {
      a.set(5);
      a.set(6);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    // re-link: now depends on b only
    t.run(() => b.value);
    a.set(7);
    expect(onChange).toHaveBeenCalledTimes(1);
    b.set(4);
    expect(onChange).toHaveBeenCalledTimes(2);
    t.dispose();
    b.set(5);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('unsubscribed mode: records deps without linking; dirty() detects missed changes', () => {
    const a = observable(1);
    const c = computed(() => a.value * 10);
    const onChange = vi.fn();
    const t = createTracker(onChange, false);
    t.run(() => c.value);
    expect((a as any)._targets).toBeUndefined(); // render did not subscribe
    expect(t.dirty()).toBe(false);
    a.set(2); // change between render and commit
    expect(onChange).not.toHaveBeenCalled();
    t.subscribe();
    expect(t.dirty()).toBe(true);
    a.set(3);
    expect(onChange).toHaveBeenCalledTimes(1);
    t.unsubscribe();
    a.set(4);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((a as any)._targets).toBeUndefined();
  });

  it('stop() restores context even if render throws (via run)', () => {
    const t = new Tracker(() => {});
    expect(() =>
      t.run(() => {
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(getCurrentObserver()).toBeUndefined();
  });

  it('reads in onChange are not tracked by an active tracker', () => {
    const a = observable(0);
    const b = observable(0);
    const t2 = createTracker(() => {});
    const t = createTracker(() => b.value);
    t.run(() => a.value);
    t2.start();
    a.set(1);
    t2.stop();
    expect(t2._sources).toBeUndefined();
  });
});
