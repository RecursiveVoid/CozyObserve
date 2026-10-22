// @vitest-environment jsdom
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useObserver } from '../../src/react/index';
import { observable, computed, batch } from '../../src/index';

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  errSpy.mockRestore();
});

describe('spec §5 useObserver(observable)', () => {
  it('renders the current value', () => {
    const o = observable(42);
    function C() {
      return <span data-testid="v">{useObserver(o)}</span>;
    }
    render(<C />);
    expect(screen.getByTestId('v').textContent).toBe('42');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('re-renders on set, exactly once per set', () => {
    const o = observable(1);
    let renders = 0;
    function C() {
      renders++;
      return <span data-testid="v">{useObserver(o)}</span>;
    }
    render(<C />);
    expect(renders).toBe(1);
    act(() => o.set(2));
    expect(screen.getByTestId('v').textContent).toBe('2');
    expect(renders).toBe(2);
    act(() => o.set((p) => p + 1));
    expect(screen.getByTestId('v').textContent).toBe('3');
    expect(renders).toBe(3);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('does not re-render on equal set', () => {
    const o = observable(1);
    let renders = 0;
    function C() {
      renders++;
      return <span>{useObserver(o)}</span>;
    }
    render(<C />);
    act(() => o.set(1));
    expect(renders).toBe(1);
  });

  it('respects observable custom equals (no re-render when equal per equals)', () => {
    const o = observable({ id: 1, n: 0 }, { equals: (a, b) => a.id === b.id });
    let renders = 0;
    function C() {
      renders++;
      return <span>{useObserver(o).id}</span>;
    }
    render(<C />);
    act(() => o.set({ id: 1, n: 5 }));
    expect(renders).toBe(1);
  });

  it('works with computed sources', () => {
    const o = observable(2);
    const dbl = computed(() => o.value * 2);
    function C() {
      return <span data-testid="v">{useObserver(dbl)}</span>;
    }
    render(<C />);
    expect(screen.getByTestId('v').textContent).toBe('4');
    act(() => o.set(5));
    expect(screen.getByTestId('v').textContent).toBe('10');
  });

  it('switches source when a different observable is passed', () => {
    const a = observable('a');
    const b = observable('b');
    function C({ src }: { src: typeof a }) {
      return <span data-testid="v">{useObserver(src)}</span>;
    }
    const { rerender } = render(<C src={a} />);
    expect(screen.getByTestId('v').textContent).toBe('a');
    rerender(<C src={b} />);
    expect(screen.getByTestId('v').textContent).toBe('b');
    act(() => a.set('a2'));
    expect(screen.getByTestId('v').textContent).toBe('b');
    act(() => b.set('b2'));
    expect(screen.getByTestId('v').textContent).toBe('b2');
  });

  it('stops updating after unmount (no errors / act warnings)', () => {
    const o = observable(1);
    let renders = 0;
    function C() {
      renders++;
      return <span>{useObserver(o)}</span>;
    }
    const { unmount } = render(<C />);
    unmount();
    o.set(2); // intentionally outside act: must not schedule anything
    expect(renders).toBe(1);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('works in StrictMode and updates once per set (≤2 renders for double render)', () => {
    const o = observable(1);
    let renders = 0;
    function C() {
      renders++;
      return <span data-testid="v">{useObserver(o)}</span>;
    }
    render(
      <React.StrictMode>
        <C />
      </React.StrictMode>,
    );
    const r0 = renders;
    act(() => o.set(2));
    expect(screen.getByTestId('v').textContent).toBe('2');
    expect(renders - r0).toBeLessThanOrEqual(2);
    expect(renders - r0).toBeGreaterThanOrEqual(1);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('SSR: renderToString uses current value', () => {
    const o = observable('ssr-value');
    function C() {
      return <span>{useObserver(o)}</span>;
    }
    expect(renderToString(<C />)).toContain('ssr-value');
  });
});

describe('spec §5 useObserver(source, selector, equals)', () => {
  it('re-renders only when the selected slice changes', () => {
    const o = observable({ a: 1, b: 1 });
    let renders = 0;
    function C() {
      renders++;
      const a = useObserver(o, (v) => v.a);
      return <span data-testid="v">{a}</span>;
    }
    render(<C />);
    expect(renders).toBe(1);
    act(() => o.set({ a: 1, b: 2 }));
    expect(renders).toBe(1);
    act(() => o.set({ a: 2, b: 2 }));
    expect(renders).toBe(2);
    expect(screen.getByTestId('v').textContent).toBe('2');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('custom equals: selector returning fresh objects does not re-render when equal', () => {
    const o = observable({ a: 1, b: 1 });
    let renders = 0;
    function C() {
      renders++;
      const sel = useObserver(
        o,
        (v) => ({ a: v.a }),
        (x, y) => x.a === y.a,
      );
      return <span data-testid="v">{sel.a}</span>;
    }
    render(<C />);
    act(() => o.set({ a: 1, b: 9 }));
    expect(renders).toBe(1);
    act(() => o.set({ a: 3, b: 9 }));
    expect(renders).toBe(2);
    expect(screen.getByTestId('v').textContent).toBe('3');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('selector returning a fresh object (no equals) does not trigger getSnapshot-not-cached warning or loop', () => {
    const o = observable({ a: 1 });
    let renders = 0;
    function C() {
      renders++;
      const sel = useObserver(o, (v) => [v.a]);
      return <span data-testid="v">{sel[0]}</span>;
    }
    render(<C />);
    expect(renders).toBeLessThan(5);
    act(() => o.set({ a: 2 }));
    expect(screen.getByTestId('v').textContent).toBe('2');
    expect(renders).toBeLessThan(10);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('inline (non-memoized) selector changing between renders uses the latest selector', () => {
    const o = observable({ a: 1, b: 10 });
    function C({ k }: { k: 'a' | 'b' }) {
      const v = useObserver(o, (s) => s[k]);
      return <span data-testid="v">{v}</span>;
    }
    const { rerender } = render(<C k="a" />);
    expect(screen.getByTestId('v').textContent).toBe('1');
    rerender(<C k="b" />);
    expect(screen.getByTestId('v').textContent).toBe('10');
    act(() => o.set({ a: 1, b: 11 }));
    expect(screen.getByTestId('v').textContent).toBe('11');
    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe('spec §5 useObserver(getter, deps)', () => {
  it('auto-tracks multiple observables', () => {
    const a = observable(1);
    const b = observable(10);
    let renders = 0;
    function C() {
      renders++;
      const sum = useObserver(() => a.value + b.value);
      return <span data-testid="v">{sum}</span>;
    }
    render(<C />);
    expect(screen.getByTestId('v').textContent).toBe('11');
    act(() => a.set(2));
    expect(screen.getByTestId('v').textContent).toBe('12');
    act(() => b.set(20));
    expect(screen.getByTestId('v').textContent).toBe('22');
    expect(renders).toBe(3);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('does not re-render when the derived value is unchanged', () => {
    const a = observable(1);
    let renders = 0;
    function C() {
      renders++;
      return <span>{useObserver(() => a.value > 0)}</span>;
    }
    render(<C />);
    act(() => a.set(5));
    expect(renders).toBe(1);
  });

  it('batched writes to two deps cause a single re-render', () => {
    const a = observable(1);
    const b = observable(1);
    let renders = 0;
    function C() {
      renders++;
      return <span>{useObserver(() => a.value + b.value)}</span>;
    }
    render(<C />);
    act(() => batch(() => {
      a.set(2);
      b.set(3);
    }));
    expect(renders).toBe(2);
  });

  it('dynamic deps in getter: untaken branch is not tracked', () => {
    const flag = observable(true);
    const a = observable('A');
    const b = observable('B');
    let renders = 0;
    function C() {
      renders++;
      return <span data-testid="v">{useObserver(() => (flag.value ? a.value : b.value))}</span>;
    }
    render(<C />);
    act(() => b.set('B2'));
    expect(renders).toBe(1);
    act(() => flag.set(false));
    expect(screen.getByTestId('v').textContent).toBe('B2');
    const r = renders;
    act(() => a.set('A2'));
    expect(renders).toBe(r);
  });

  it('deps arg: getter is re-created when deps change', () => {
    const a = observable(2);
    function C({ k }: { k: number }) {
      const v = useObserver(() => a.value * k, [k]);
      return <span data-testid="v">{v}</span>;
    }
    const { rerender } = render(<C k={1} />);
    expect(screen.getByTestId('v').textContent).toBe('2');
    rerender(<C k={3} />);
    expect(screen.getByTestId('v').textContent).toBe('6');
    act(() => a.set(4));
    expect(screen.getByTestId('v').textContent).toBe('12');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('getter returning a fresh object each call does not loop or warn', () => {
    const a = observable(1);
    let renders = 0;
    function C() {
      renders++;
      const obj = useObserver(() => ({ x: a.value }));
      return <span data-testid="v">{obj.x}</span>;
    }
    render(<C />);
    expect(renders).toBeLessThan(5);
    act(() => a.set(2));
    expect(screen.getByTestId('v').textContent).toBe('2');
    expect(renders).toBeLessThan(10);
    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe('spec §5 no tearing / no missed updates between render and effect', () => {
  it('set in a sibling useLayoutEffect is reflected (observable form)', () => {
    const o = observable(0);
    function Reader() {
      return <span data-testid="v">{useObserver(o)}</span>;
    }
    function Writer() {
      useLayoutEffect(() => {
        o.set(5);
      }, []);
      return null;
    }
    act(() => {
      render(
        <>
          <Reader />
          <Writer />
        </>,
      );
    });
    expect(screen.getByTestId('v').textContent).toBe('5');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('set in an earlier sibling useEffect (before reader subscribes) is reflected', () => {
    const o = observable(0);
    function Reader() {
      return <span data-testid="v">{useObserver(o)}</span>;
    }
    function Writer() {
      useEffect(() => {
        o.set(7);
      }, []);
      return null;
    }
    act(() => {
      render(
        <>
          <Writer />
          <Reader />
        </>,
      );
    });
    expect(screen.getByTestId('v').textContent).toBe('7');
  });

  it('set during a child render (before parent effects) is reflected (getter form)', () => {
    const o = observable(0);
    function Reader() {
      return <span data-testid="v">{useObserver(() => o.value * 10)}</span>;
    }
    function Writer() {
      useLayoutEffect(() => {
        o.set(3);
      }, []);
      return null;
    }
    act(() => {
      render(
        <>
          <Reader />
          <Writer />
        </>,
      );
    });
    expect(screen.getByTestId('v').textContent).toBe('30');
  });

  it('two readers of the same observable never show different values after commit', () => {
    const o = observable(0);
    function Reader({ id }: { id: string }) {
      return <span data-testid={id}>{useObserver(o)}</span>;
    }
    function Writer() {
      const [n, setN] = useState(0);
      useLayoutEffect(() => {
        if (n === 0) {
          o.set(1);
          setN(1);
        }
      }, [n]);
      return null;
    }
    act(() => {
      render(
        <>
          <Reader id="r1" />
          <Writer />
          <Reader id="r2" />
        </>,
      );
    });
    expect(screen.getByTestId('r1').textContent).toBe('1');
    expect(screen.getByTestId('r2').textContent).toBe('1');
  });
});
