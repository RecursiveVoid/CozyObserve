// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import {
  useObservable,
  useComputed,
  useObserver,
  useObserverEffect,
} from '../../src/react/index';
import { observable, isObservable, batch } from '../../src/index';
import type { Observable, ReadonlyObservable } from '../../src/index';

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  errSpy.mockRestore();
});

describe('spec §5 useObservable', () => {
  it('returns an observable with stable identity across renders', () => {
    const seen: Observable<number>[] = [];
    function C({ n }: { n: number }) {
      const o = useObservable(0);
      seen.push(o);
      return <span>{n}</span>;
    }
    const { rerender } = render(<C n={1} />);
    rerender(<C n={2} />);
    rerender(<C n={3} />);
    expect(seen.length).toBe(3);
    expect(isObservable(seen[0])).toBe(true);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
  });

  it('lazy initializer is called exactly once', () => {
    const init = vi.fn(() => 5);
    let o!: Observable<number>;
    function C({ n }: { n: number }) {
      o = useObservable(init);
      return <span>{n}</span>;
    }
    const { rerender } = render(<C n={1} />);
    rerender(<C n={2} />);
    rerender(<C n={3} />);
    expect(init).toHaveBeenCalledTimes(1);
    expect(o.peek()).toBe(5);
  });

  it('can be read with useObserver and set locally', () => {
    let o!: Observable<number>;
    function C() {
      o = useObservable(1);
      return <span data-testid="v">{useObserver(o)}</span>;
    }
    render(<C />);
    act(() => o.set(9));
    expect(screen.getByTestId('v').textContent).toBe('9');
  });

  it('each component instance gets its own observable', () => {
    const seen: Observable<number>[] = [];
    function C() {
      seen.push(useObservable(0));
      return null;
    }
    render(
      <>
        <C />
        <C />
      </>,
    );
    expect(seen[0]).not.toBe(seen[1]);
  });
});

describe('spec §5 useComputed', () => {
  it('derives from observables and is stable while deps are unchanged', () => {
    const a = observable(2);
    const seen: ReadonlyObservable<number>[] = [];
    function C({ k, tick }: { k: number; tick: number }) {
      const c = useComputed(() => a.value * k, [k]);
      seen.push(c);
      return (
        <span data-testid="v">
          {useObserver(c)}-{tick}
        </span>
      );
    }
    const { rerender } = render(<C k={1} tick={0} />);
    expect(screen.getByTestId('v').textContent).toBe('2-0');
    rerender(<C k={1} tick={1} />);
    expect(seen[1]).toBe(seen[0]);
    act(() => a.set(3));
    expect(screen.getByTestId('v').textContent).toBe('3-1');
  });

  it('is re-created when deps change and reflects the new closure', () => {
    const a = observable(2);
    const seen: ReadonlyObservable<number>[] = [];
    function C({ k }: { k: number }) {
      const c = useComputed(() => a.value * k, [k]);
      seen.push(c);
      return <span data-testid="v">{useObserver(c)}</span>;
    }
    const { rerender } = render(<C k={1} />);
    rerender(<C k={10} />);
    expect(screen.getByTestId('v').textContent).toBe('20');
    expect(seen[seen.length - 1]).not.toBe(seen[0]);
    act(() => a.set(5));
    expect(screen.getByTestId('v').textContent).toBe('50');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('returns a ReadonlyObservable (readable via .value / peek outside React)', () => {
    const a = observable(1);
    let c!: ReadonlyObservable<number>;
    function C() {
      c = useComputed(() => a.value + 1, []);
      return null;
    }
    render(<C />);
    expect(isObservable(c)).toBe(true);
    expect(c.peek()).toBe(2);
    a.set(4);
    expect(c.value).toBe(5);
  });
});

describe('spec §5 useObserverEffect', () => {
  it('runs after mount (DOM is committed when it runs), not during render', () => {
    const a = observable(1);
    const found: (Element | null)[] = [];
    let rendering = false;
    let ranDuringRender = false;
    function C() {
      rendering = true;
      useObserverEffect(() => {
        if (rendering) ranDuringRender = true;
        found.push(document.querySelector('[data-testid="mounted"]'));
        a.value;
      });
      rendering = false;
      return <span data-testid="mounted">x</span>;
    }
    render(<C />);
    expect(ranDuringRender).toBe(false);
    expect(found.length).toBe(1);
    expect(found[0]).not.toBeNull();
  });

  it('re-runs only when read observables change, not on parent re-render', () => {
    const a = observable(1);
    const b = observable(1);
    const fn = vi.fn();
    function C({ n }: { n: number }) {
      useObserverEffect(() => {
        fn(a.value);
      });
      return <span>{n}</span>;
    }
    const { rerender } = render(<C n={1} />);
    expect(fn).toHaveBeenCalledTimes(1);
    rerender(<C n={2} />);
    rerender(<C n={3} />);
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => b.set(2));
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => a.set(2));
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(2);
    act(() => a.set(2));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not re-render the component when the effect re-runs', () => {
    const a = observable(1);
    let renders = 0;
    function C() {
      renders++;
      useObserverEffect(() => {
        a.value;
      });
      return null;
    }
    render(<C />);
    act(() => a.set(2));
    expect(renders).toBe(1);
  });

  it('always calls the latest fn (closure from latest render)', () => {
    const a = observable(1);
    const log: string[] = [];
    function C({ label }: { label: string }) {
      useObserverEffect(() => {
        log.push(`${label}:${a.value}`);
      });
      return null;
    }
    const { rerender } = render(<C label="A" />);
    rerender(<C label="B" />);
    expect(log).toEqual(['A:1']);
    act(() => a.set(2));
    expect(log).toEqual(['A:1', 'B:2']);
  });

  it('runs cleanup before re-run and on unmount', () => {
    const a = observable(1);
    const log: string[] = [];
    function C() {
      useObserverEffect(() => {
        const v = a.value;
        log.push(`run${v}`);
        return () => log.push(`clean${v}`);
      });
      return null;
    }
    const { unmount } = render(<C />);
    act(() => a.set(2));
    expect(log).toEqual(['run1', 'clean1', 'run2']);
    unmount();
    expect(log).toEqual(['run1', 'clean1', 'run2', 'clean2']);
    a.set(3);
    expect(log).toEqual(['run1', 'clean1', 'run2', 'clean2']);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('dynamic deps: re-tracks what the latest run read', () => {
    const flag = observable(true);
    const a = observable(0);
    const b = observable(0);
    const fn = vi.fn();
    function C() {
      useObserverEffect(() => {
        fn(flag.value ? a.value : b.value);
      });
      return null;
    }
    render(<C />);
    act(() => b.set(1));
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => flag.set(false));
    expect(fn).toHaveBeenCalledTimes(2);
    act(() => a.set(1));
    expect(fn).toHaveBeenCalledTimes(2);
    act(() => b.set(2));
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('batched writes → single re-run', () => {
    const a = observable(0);
    const b = observable(0);
    const fn = vi.fn();
    function C() {
      useObserverEffect(() => {
        fn(a.value + b.value);
      });
      return null;
    }
    render(<C />);
    act(() =>
      batch(() => {
        a.set(1);
        b.set(1);
      }),
    );
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(2);
  });

  it('writing to an observable inside the effect works (e.g. sync to local state)', () => {
    const a = observable(1);
    const mirror = observable(0);
    function C() {
      useObserverEffect(() => {
        mirror.set(a.value * 2);
      });
      return <span data-testid="v">{useObserver(mirror)}</span>;
    }
    render(<C />);
    expect(screen.getByTestId('v').textContent).toBe('2');
    act(() => a.set(4));
    expect(screen.getByTestId('v').textContent).toBe('8');
  });

  it('StrictMode: a single set re-runs the effect exactly once (no duplicate live subscription)', () => {
    const a = observable(1);
    let runs = 0;
    let cleanups = 0;
    function C() {
      useObserverEffect(() => {
        a.value;
        runs++;
        return () => {
          cleanups++;
        };
      });
      return null;
    }
    const { unmount } = render(
      <React.StrictMode>
        <C />
      </React.StrictMode>,
    );
    const r0 = runs;
    expect(r0).toBeGreaterThanOrEqual(1);
    expect(runs - cleanups).toBe(1); // exactly one live effect
    act(() => a.set(2));
    expect(runs - r0).toBe(1);
    act(() => a.set(3));
    expect(runs - r0).toBe(2);
    expect(runs - cleanups).toBe(1);
    unmount();
    expect(runs - cleanups).toBe(0);
    const r1 = runs;
    a.set(4);
    expect(runs).toBe(r1);
  });

  it('StrictMode: re-render does not re-run the effect', () => {
    const a = observable(1);
    let runs = 0;
    let setN!: (n: number) => void;
    function C() {
      const [n, _setN] = useState(0);
      setN = _setN;
      useObserverEffect(() => {
        a.value;
        runs++;
      });
      return <span>{n}</span>;
    }
    render(
      <React.StrictMode>
        <C />
      </React.StrictMode>,
    );
    const r0 = runs;
    act(() => setN(1));
    act(() => setN(2));
    expect(runs).toBe(r0);
  });
});
