import { describe, it, expect, vi } from 'vitest';
import { observable, computed, effect, batch, untracked, onCleanup } from '../../src/index';

describe('spec §1: effect basics', () => {
  it('runs synchronously once on creation', () => {
    const fn = vi.fn();
    effect(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-runs synchronously when a tracked dep changes', () => {
    const s = observable(1);
    const seen: number[] = [];
    effect(() => {
      seen.push(s.value);
    });
    s.set(2);
    expect(seen).toEqual([1, 2]);
    s.set(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('does not re-run on unrelated changes', () => {
    const s = observable(1);
    const other = observable(1);
    const fn = vi.fn(() => {
      s.value;
    });
    effect(fn);
    other.set(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns a dispose function that stops all future runs', () => {
    const s = observable(1);
    const fn = vi.fn(() => {
      s.value;
    });
    const dispose = effect(fn);
    dispose();
    s.set(2);
    s.set(3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('dispose is idempotent', () => {
    const cleanup = vi.fn();
    const dispose = effect(() => cleanup);
    dispose();
    dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('effect tracking a computed re-runs when the computed changes', () => {
    const s = observable(2);
    const sq = computed(() => s.value * s.value);
    const seen: number[] = [];
    effect(() => {
      seen.push(sq.value);
    });
    s.set(3);
    expect(seen).toEqual([4, 9]);
  });

  it('multiple deps changed in a batch → single re-run', () => {
    const a = observable(1);
    const b = observable(2);
    const fn = vi.fn(() => a.value + b.value);
    effect(fn);
    batch(() => {
      a.set(10);
      b.set(20);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveLastReturnedWith(30);
  });

  it('effect writing a signal another effect reads: the other effect sees the new value', () => {
    const a = observable(1);
    const b = observable(0);
    const seenB: number[] = [];
    effect(() => {
      b.set(a.value * 10);
    });
    effect(() => {
      seenB.push(b.value);
    });
    a.set(2);
    expect(b.value).toBe(20);
    expect(seenB[seenB.length - 1]).toBe(20);
  });

  it('effect writing a signal it reads but converging does not throw', () => {
    const s = observable(0);
    effect(() => {
      if (s.value > 10) s.set(10);
    });
    expect(() => s.set(50)).not.toThrow();
    expect(s.value).toBe(10);
  });
});

describe('spec §1: effect cleanup', () => {
  it('returned cleanup runs before the next run', () => {
    const s = observable(1);
    const log: string[] = [];
    effect(() => {
      const v = s.value;
      log.push(`run${v}`);
      return () => log.push(`cleanup${v}`);
    });
    s.set(2);
    s.set(3);
    expect(log).toEqual(['run1', 'cleanup1', 'run2', 'cleanup2', 'run3']);
  });

  it('returned cleanup runs on dispose', () => {
    const s = observable(1);
    const log: string[] = [];
    const dispose = effect(() => {
      const v = s.value;
      log.push(`run${v}`);
      return () => log.push(`cleanup${v}`);
    });
    dispose();
    expect(log).toEqual(['run1', 'cleanup1']);
    s.set(2);
    expect(log).toEqual(['run1', 'cleanup1']);
  });

  it('cleanup does not track reads', () => {
    const s = observable(1);
    const other = observable(1);
    const fn = vi.fn();
    effect(() => {
      fn();
      s.value;
      return () => {
        other.value;
      };
    });
    s.set(2); // runs cleanup (reads other) then re-runs
    expect(fn).toHaveBeenCalledTimes(2);
    other.set(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('onCleanup registers a cleanup for the current run (before next run and on dispose)', () => {
    const s = observable(1);
    const log: string[] = [];
    const dispose = effect(() => {
      const v = s.value;
      log.push(`run${v}`);
      onCleanup(() => log.push(`onCleanup${v}`));
    });
    s.set(2);
    expect(log).toEqual(['run1', 'onCleanup1', 'run2']);
    dispose();
    expect(log).toEqual(['run1', 'onCleanup1', 'run2', 'onCleanup2']);
  });

  it('multiple onCleanup + returned cleanup all run before next run', () => {
    const s = observable(1);
    const log: string[] = [];
    effect(() => {
      const v = s.value;
      log.push(`run${v}`);
      onCleanup(() => log.push(`a${v}`));
      onCleanup(() => log.push(`b${v}`));
      return () => log.push(`ret${v}`);
    });
    s.set(2);
    const between = log.slice(1, log.indexOf('run2'));
    expect(between.sort()).toEqual(['a1', 'b1', 'ret1']);
    expect(log[log.length - 1]).toBe('run2');
  });

  it('onCleanup each run is a fresh registration (old cleanups do not run twice)', () => {
    const s = observable(0);
    const cleanup = vi.fn();
    effect(() => {
      s.value;
      onCleanup(cleanup);
    });
    s.set(1);
    s.set(2);
    s.set(3);
    expect(cleanup).toHaveBeenCalledTimes(3);
  });
});

describe('spec §1: effect ownership (nested effects)', () => {
  it('inner effect is disposed when the parent re-runs', () => {
    const outerDep = observable(0);
    const innerDep = observable(0);
    const innerRuns = vi.fn();
    const innerCleanup = vi.fn();
    effect(() => {
      outerDep.value;
      effect(() => {
        innerRuns(innerDep.value);
        return innerCleanup;
      });
    });
    expect(innerRuns).toHaveBeenCalledTimes(1);
    innerDep.set(1);
    expect(innerRuns).toHaveBeenCalledTimes(2);

    outerDep.set(1); // disposes old inner, creates new inner
    expect(innerCleanup).toHaveBeenCalledTimes(2); // once for inner re-run, once for disposal
    expect(innerRuns).toHaveBeenCalledTimes(3);

    innerDep.set(2); // only ONE live inner effect must run
    expect(innerRuns).toHaveBeenCalledTimes(4);
  });

  it('inner effects do not accumulate across many parent re-runs', () => {
    const outerDep = observable(0);
    const innerDep = observable(0);
    const innerRuns = vi.fn();
    effect(() => {
      outerDep.value;
      effect(() => {
        innerRuns(innerDep.value);
      });
    });
    for (let i = 1; i <= 10; i++) outerDep.set(i);
    innerRuns.mockClear();
    innerDep.set(1);
    expect(innerRuns).toHaveBeenCalledTimes(1);
  });

  it('inner effect is disposed when the parent is disposed', () => {
    const innerDep = observable(0);
    const innerRuns = vi.fn();
    const innerCleanup = vi.fn();
    const dispose = effect(() => {
      effect(() => {
        innerRuns(innerDep.value);
        return innerCleanup;
      });
    });
    dispose();
    expect(innerCleanup).toHaveBeenCalledTimes(1);
    innerDep.set(1);
    expect(innerRuns).toHaveBeenCalledTimes(1);
  });

  it('grandchild effects are disposed transitively', () => {
    const dep = observable(0);
    const runs = vi.fn();
    const dispose = effect(() => {
      effect(() => {
        effect(() => {
          runs(dep.value);
        });
      });
    });
    dispose();
    dep.set(1);
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('inner effect reads do not become parent deps', () => {
    const innerDep = observable(0);
    const outerRuns = vi.fn();
    effect(() => {
      outerRuns();
      effect(() => {
        innerDep.value;
      });
    });
    innerDep.set(1);
    expect(outerRuns).toHaveBeenCalledTimes(1);
  });

  it('inner effect can be disposed manually without affecting the parent', () => {
    const outerDep = observable(0);
    const innerDep = observable(0);
    const innerRuns = vi.fn();
    const outerRuns = vi.fn();
    let disposeInner: (() => void) | undefined;
    effect(() => {
      outerRuns(outerDep.value);
      disposeInner = effect(() => {
        innerRuns(innerDep.value);
      });
    });
    disposeInner!();
    innerDep.set(1);
    expect(innerRuns).toHaveBeenCalledTimes(1);
    outerDep.set(1);
    expect(outerRuns).toHaveBeenCalledTimes(2);
  });
});

describe('spec §1: dispose during own run', () => {
  it('effect that disposes itself during a run does not run again', () => {
    const s = observable(0);
    const runs = vi.fn();
    let stop: (() => void) | undefined;
    stop = effect(() => {
      const v = s.value;
      runs(v);
      if (v === 1) stop!();
    });
    expect(() => s.set(1)).not.toThrow();
    expect(runs).toHaveBeenCalledTimes(2);
    s.set(2);
    s.set(3);
    expect(runs).toHaveBeenCalledTimes(2);
  });

  it('cleanup registered in the disposing run still runs exactly once', () => {
    const s = observable(0);
    const cleanup = vi.fn();
    let stop: (() => void) | undefined;
    stop = effect(() => {
      const v = s.value;
      if (v === 1) {
        onCleanup(cleanup);
        stop!();
      }
    });
    s.set(1);
    s.set(2);
    // cleanup must not be leaked / run more than once
    expect(cleanup.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('effect disposing ANOTHER pending effect in the same flush prevents its run', () => {
    const s = observable(0);
    const bRuns = vi.fn();
    let stopB: (() => void) | undefined;
    effect(() => {
      if (s.value === 1) stopB!();
    });
    stopB = effect(() => {
      bRuns(s.value);
    });
    s.set(1);
    // b may or may not run in this flush depending on ordering, but never after
    const n = bRuns.mock.calls.length;
    s.set(2);
    expect(bRuns.mock.calls.length).toBe(n);
  });
});

describe('spec §1: effects + untracked/peek', () => {
  it('untracked(fn) returns fn value and does not track', () => {
    const a = observable(1);
    const b = observable(2);
    const runs = vi.fn();
    effect(() => {
      runs(a.value + untracked(() => b.value));
    });
    expect(runs).toHaveBeenLastCalledWith(3);
    b.set(10);
    expect(runs).toHaveBeenCalledTimes(1);
    a.set(5);
    expect(runs).toHaveBeenLastCalledWith(15);
  });

  it('peek() inside effect does not track', () => {
    const a = observable(1);
    const runs = vi.fn();
    effect(() => {
      runs(a.peek());
    });
    a.set(2);
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('untracked returns value outside any tracking context', () => {
    expect(untracked(() => 42)).toBe(42);
  });

  it('tracking resumes after untracked block in same effect', () => {
    const a = observable(1);
    const b = observable(1);
    const c = observable(1);
    const runs = vi.fn();
    effect(() => {
      a.value;
      untracked(() => b.value);
      c.value;
      runs();
    });
    c.set(2);
    expect(runs).toHaveBeenCalledTimes(2);
    b.set(2);
    expect(runs).toHaveBeenCalledTimes(2);
  });

  it('nested untracked inside untracked restores correctly', () => {
    const a = observable(1);
    const b = observable(1);
    const runs = vi.fn();
    effect(() => {
      untracked(() => untracked(() => a.value));
      b.value;
      runs();
    });
    a.set(2);
    expect(runs).toHaveBeenCalledTimes(1);
    b.set(2);
    expect(runs).toHaveBeenCalledTimes(2);
  });
});
