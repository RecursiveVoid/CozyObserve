// @vitest-environment jsdom
import React, { useLayoutEffect, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import { tracked, Observe } from '../../src/react/index';
import { observable, computed, effect, store, batch } from '../../src/index';

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  errSpy.mockRestore();
});

class Boundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { err: unknown }
> {
  override state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown) {
    return { err };
  }
  override render() {
    if (this.state.err) return this.props.fallback ?? <span data-testid="fallback">error</span>;
    return this.props.children;
  }
}

describe('spec §5 tracked(Component)', () => {
  it('re-renders only when observables read during render change', () => {
    const a = observable(1);
    const b = observable(1);
    let renders = 0;
    const C = tracked(() => {
      renders++;
      return <span data-testid="v">{a.value}</span>;
    });
    render(<C />);
    expect(screen.getByTestId('v').textContent).toBe('1');
    act(() => b.set(2));
    expect(renders).toBe(1);
    act(() => a.set(2));
    expect(screen.getByTestId('v').textContent).toBe('2');
    expect(renders).toBe(2);
    act(() => a.set(2));
    expect(renders).toBe(2);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('tracks .get() and computed reads; peek() is untracked', () => {
    const a = observable(1);
    const p = observable(1);
    const dbl = computed(() => a.value * 2);
    let renders = 0;
    const C = tracked(() => {
      renders++;
      return (
        <span data-testid="v">
          {dbl.get()}/{p.peek()}
        </span>
      );
    });
    render(<C />);
    act(() => p.set(5));
    expect(renders).toBe(1);
    act(() => a.set(3));
    expect(screen.getByTestId('v').textContent).toBe('6/5');
    expect(renders).toBe(2);
  });

  it('tracks store property reads (per-property)', () => {
    const s = store({ x: 1, y: 1, nested: { z: 1 } });
    let renders = 0;
    const C = tracked(() => {
      renders++;
      return (
        <span data-testid="v">
          {s.x}-{s.nested.z}
        </span>
      );
    });
    render(<C />);
    act(() => {
      s.y = 2;
    });
    expect(renders).toBe(1);
    act(() => {
      s.x = 2;
    });
    expect(renders).toBe(2);
    expect(screen.getByTestId('v').textContent).toBe('2-1');
    act(() => {
      s.nested.z = 3;
    });
    expect(screen.getByTestId('v').textContent).toBe('2-3');
    act(() => {
      s.nested = { z: 4 };
    });
    expect(screen.getByTestId('v').textContent).toBe('2-4');
  });

  it('dynamic deps: subscriptions follow what the latest render read', () => {
    const flag = observable(true);
    const a = observable('A');
    const b = observable('B');
    let renders = 0;
    const C = tracked(() => {
      renders++;
      return <span data-testid="v">{flag.value ? a.value : b.value}</span>;
    });
    render(<C />);
    act(() => b.set('B2'));
    expect(renders).toBe(1);
    act(() => flag.set(false));
    expect(screen.getByTestId('v').textContent).toBe('B2');
    const r = renders;
    act(() => a.set('A2'));
    expect(renders).toBe(r);
    act(() => b.set('B3'));
    expect(screen.getByTestId('v').textContent).toBe('B3');
    expect(renders).toBe(r + 1);
  });

  it('deps collected on a props-driven re-render replace old ones', () => {
    const a = observable('A');
    const b = observable('B');
    let renders = 0;
    const C = tracked(({ useA }: { useA: boolean }) => {
      renders++;
      return <span data-testid="v">{useA ? a.value : b.value}</span>;
    });
    const { rerender } = render(<C useA={true} />);
    rerender(<C useA={false} />);
    expect(screen.getByTestId('v').textContent).toBe('B');
    const r = renders;
    act(() => a.set('A2'));
    expect(renders).toBe(r);
    act(() => b.set('B2'));
    expect(screen.getByTestId('v').textContent).toBe('B2');
  });

  it('fine-grained: siblings are not re-rendered', () => {
    const a = observable(0);
    const b = observable(0);
    let ra = 0;
    let rb = 0;
    let rp = 0;
    const A = tracked(() => {
      ra++;
      return <span data-testid="a">{a.value}</span>;
    });
    const B = tracked(() => {
      rb++;
      return <span data-testid="b">{b.value}</span>;
    });
    function Parent() {
      rp++;
      return (
        <>
          <A />
          <B />
        </>
      );
    }
    render(<Parent />);
    act(() => a.set(1));
    expect([rp, ra, rb]).toEqual([1, 2, 1]);
    act(() => b.set(1));
    expect([rp, ra, rb]).toEqual([1, 2, 2]);
  });

  it('nested tracked: child reads do not subscribe the parent', () => {
    const a = observable(0);
    const b = observable(0);
    let rp = 0;
    let rc = 0;
    const Child = tracked(() => {
      rc++;
      return <span data-testid="c">{b.value}</span>;
    });
    const Parent = tracked(() => {
      rp++;
      return (
        <div>
          <span data-testid="p">{a.value}</span>
          <Child />
        </div>
      );
    });
    render(<Parent />);
    act(() => b.set(1));
    expect([rp, rc]).toEqual([1, 2]);
    act(() => a.set(1));
    expect(rp).toBe(2);
    expect(rc).toBe(2); // memo: child props unchanged
  });

  it('memo behaviour: parent re-render with same props does not re-render', () => {
    let renders = 0;
    const C = tracked(({ x }: { x: number }) => {
      renders++;
      return <span data-testid="v">{x}</span>;
    });
    let setTick!: (n: number) => void;
    function Parent({ x }: { x: number }) {
      const [tick, _set] = useState(0);
      setTick = _set;
      return (
        <div data-tick={tick}>
          <C x={x} />
        </div>
      );
    }
    const { rerender } = render(<Parent x={1} />);
    act(() => setTick(1));
    expect(renders).toBe(1);
    rerender(<Parent x={1} />);
    expect(renders).toBe(1);
    rerender(<Parent x={2} />);
    expect(renders).toBe(2);
    expect(screen.getByTestId('v').textContent).toBe('2');
  });

  it('keeps displayName / name of the wrapped component', () => {
    function MyFancyComponent() {
      return null;
    }
    const W: any = tracked(MyFancyComponent);
    const name = String(W.displayName ?? W.type?.displayName ?? W.type?.name ?? W.name);
    expect(name).toContain('MyFancyComponent');
  });

  it('works with hooks inside the tracked component', () => {
    const a = observable(1);
    let setLocal!: (n: number) => void;
    const C = tracked(() => {
      const [local, _set] = useState(10);
      setLocal = _set;
      return (
        <span data-testid="v">
          {a.value + local}
        </span>
      );
    });
    render(<C />);
    act(() => setLocal(20));
    expect(screen.getByTestId('v').textContent).toBe('21');
    act(() => a.set(2));
    expect(screen.getByTestId('v').textContent).toBe('22');
  });

  it('render throwing inside an error boundary does not break later tracking', () => {
    const bad = observable(false);
    const c = observable(0);
    const d = observable(0);
    const Thrower = tracked(() => {
      if (bad.value) throw new Error('boom');
      return <span data-testid="t">ok</span>;
    });
    const Other = tracked(() => <span data-testid="o">{c.value}</span>);
    render(
      <>
        <Boundary>
          <Thrower />
        </Boundary>
        <Other />
      </>,
    );
    act(() => bad.set(true));
    expect(screen.getByTestId('fallback')).toBeTruthy();
    // sibling tracking still works
    act(() => c.set(1));
    expect(screen.getByTestId('o').textContent).toBe('1');
    // newly mounted tracked components still track
    const Late = tracked(() => <span data-testid="late">{d.value}</span>);
    render(<Late />);
    act(() => d.set(5));
    expect(screen.getByTestId('late').textContent).toBe('5');
    // no leaked tracking scope: a plain effect outside React tracks only its own reads
    const x = observable(0);
    const y = observable(0);
    const fn = vi.fn();
    const stop = effect(() => {
      fn(x.value);
    });
    y.set(1);
    expect(fn).toHaveBeenCalledTimes(1);
    x.set(1);
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('throwing render: remounted component (boundary reset via key) tracks again', () => {
    const bad = observable(true);
    const v = observable(1);
    const Thrower = tracked(() => {
      if (bad.value) throw new Error('boom');
      return <span data-testid="t">{v.value}</span>;
    });
    const { rerender } = render(
      <Boundary key="1">
        <Thrower />
      </Boundary>,
    );
    expect(screen.getByTestId('fallback')).toBeTruthy();
    bad.set(false); // nothing mounted & subscribed; outside act is fine (should not warn)
    rerender(
      <Boundary key="2">
        <Thrower />
      </Boundary>,
    );
    expect(screen.getByTestId('t').textContent).toBe('1');
    act(() => v.set(2));
    expect(screen.getByTestId('t').textContent).toBe('2');
  });

  it('reads outside of tracked components (plain components) are not tracked', () => {
    const a = observable(1);
    let renders = 0;
    function Plain() {
      renders++;
      return <span>{a.value}</span>;
    }
    render(<Plain />);
    act(() => a.set(2));
    expect(renders).toBe(1);
  });

  it('StrictMode: updates correctly, bounded renders, no duplicate subscriptions', () => {
    const a = observable(1);
    let renders = 0;
    const C = tracked(() => {
      renders++;
      return <span data-testid="v">{a.value}</span>;
    });
    const { unmount } = render(
      <React.StrictMode>
        <C />
      </React.StrictMode>,
    );
    const r0 = renders;
    act(() => a.set(2));
    expect(screen.getByTestId('v').textContent).toBe('2');
    expect(renders - r0).toBeGreaterThanOrEqual(1);
    expect(renders - r0).toBeLessThanOrEqual(2);
    const r1 = renders;
    act(() => a.set(3));
    expect(screen.getByTestId('v').textContent).toBe('3');
    expect(renders - r1).toBeLessThanOrEqual(2);
    unmount();
    const r2 = renders;
    a.set(4);
    expect(renders).toBe(r2);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('unmount stops updates (no state updates / act warnings after unmount)', () => {
    const a = observable(1);
    let renders = 0;
    const C = tracked(() => {
      renders++;
      return <span>{a.value}</span>;
    });
    const { unmount } = render(<C />);
    unmount();
    a.set(2); // outside act on purpose
    a.set(3);
    expect(renders).toBe(1);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('no missed update: write in a sibling layout effect after render is reflected', () => {
    const a = observable(0);
    const C = tracked(() => <span data-testid="v">{a.value}</span>);
    function Writer() {
      useLayoutEffect(() => {
        a.set(9);
      }, []);
      return null;
    }
    act(() => {
      render(
        <>
          <C />
          <Writer />
        </>,
      );
    });
    expect(screen.getByTestId('v').textContent).toBe('9');
  });

  it('batched writes to multiple deps → one re-render', () => {
    const a = observable(0);
    const b = observable(0);
    let renders = 0;
    const C = tracked(() => {
      renders++;
      return <span>{a.value + b.value}</span>;
    });
    render(<C />);
    act(() =>
      batch(() => {
        a.set(1);
        b.set(1);
      }),
    );
    expect(renders).toBe(2);
  });
});

describe('spec §5 <Observe>', () => {
  it('function-child island re-renders without the parent re-rendering', () => {
    const a = observable(1);
    let parentRenders = 0;
    let islandRenders = 0;
    function Parent() {
      parentRenders++;
      return (
        <div>
          <Observe>
            {() => {
              islandRenders++;
              return <span data-testid="v">{a.value}</span>;
            }}
          </Observe>
        </div>
      );
    }
    render(<Parent />);
    act(() => a.set(2));
    expect(screen.getByTestId('v').textContent).toBe('2');
    expect(parentRenders).toBe(1);
    expect(islandRenders).toBe(2);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('function-child island tracks store reads and dynamic deps', () => {
    const s = store({ a: 1, b: 1, useA: true });
    let renders = 0;
    render(
      <Observe>
        {() => {
          renders++;
          return <span data-testid="v">{s.useA ? s.a : s.b}</span>;
        }}
      </Observe>,
    );
    act(() => {
      s.b = 2;
    });
    expect(renders).toBe(1);
    act(() => {
      s.useA = false;
    });
    expect(screen.getByTestId('v').textContent).toBe('2');
    const r = renders;
    act(() => {
      s.a = 5;
    });
    expect(renders).toBe(r);
  });

  it('legacy observer-prop form', () => {
    const o = observable('hello');
    let parentRenders = 0;
    function Parent() {
      parentRenders++;
      return <Observe observer={o}>{(v: string) => <span data-testid="v">{v}</span>}</Observe>;
    }
    render(<Parent />);
    expect(screen.getByTestId('v').textContent).toBe('hello');
    act(() => o.set('world'));
    expect(screen.getByTestId('v').textContent).toBe('world');
    expect(parentRenders).toBe(1);
  });

  it('two islands in one parent update independently', () => {
    const a = observable(0);
    const b = observable(0);
    let ra = 0;
    let rb = 0;
    render(
      <>
        <Observe>
          {() => {
            ra++;
            return <span>{a.value}</span>;
          }}
        </Observe>
        <Observe>
          {() => {
            rb++;
            return <span>{b.value}</span>;
          }}
        </Observe>
      </>,
    );
    act(() => a.set(1));
    expect([ra, rb]).toEqual([2, 1]);
  });
});
