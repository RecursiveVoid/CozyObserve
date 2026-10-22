// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { batch, computed, observable } from '../../src/index';
import {
  Observe,
  tracked,
  useComputed,
  useComputeObserver,
  useObservable,
  useObserver,
  useObserverEffect,
} from '../../src/react/index';

afterEach(cleanup);

const modes = [
  ['plain', ({ children }: { children: React.ReactNode }) => <>{children}</>],
  ['StrictMode', StrictMode],
] as const;

describe.each(modes)('react hooks (%s)', (_m, Wrap) => {
  it('useObserver(observable) renders and updates', () => {
    const a = observable(1);
    const C = () => <p>{useObserver(a)}</p>;
    render(<Wrap><C /></Wrap>);
    expect(screen.getByText('1')).toBeTruthy();
    act(() => a.set(2));
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('useObserver(computed)', () => {
    const a = observable(2);
    const d = computed(() => a.value * 10);
    const C = () => <p>{useComputeObserver(d)}</p>;
    render(<Wrap><C /></Wrap>);
    expect(screen.getByText('20')).toBeTruthy();
    act(() => a.set(3));
    expect(screen.getByText('30')).toBeTruthy();
  });

  it('useObserver with selector re-renders only when selection changes; object selector is stable', () => {
    const s = observable({ a: 1, b: 1 });
    let renders = 0;
    const C = () => {
      renders++;
      const v = useObserver(s, (x) => ({ a: x.a }), (p, n) => p.a === n.a);
      return <p>{v.a}</p>;
    };
    render(<Wrap><C /></Wrap>);
    const r0 = renders;
    act(() => s.set({ a: 1, b: 2 }));
    expect(renders).toBe(r0);
    act(() => s.set({ a: 5, b: 2 }));
    expect(screen.getByText('5')).toBeTruthy();
    expect(renders).toBeGreaterThan(r0);
  });

  it('useObserver(getter) auto-tracks and respects deps', () => {
    const a = observable(1);
    const b = observable(100);
    const C = ({ k }: { k: number }) => <p>{useObserver(() => a.value + b.value * k, [k])}</p>;
    const { rerender } = render(<Wrap><C k={0} /></Wrap>);
    expect(screen.getByText('1')).toBeTruthy();
    act(() => a.set(2));
    expect(screen.getByText('2')).toBeTruthy();
    rerender(<Wrap><C k={1} /></Wrap>);
    expect(screen.getByText('102')).toBeTruthy();
    act(() => b.set(200));
    expect(screen.getByText('202')).toBeTruthy();
  });

  it('useObservable is component-local and stable', () => {
    const seen = new Set<unknown>();
    let setter: (n: number) => void = () => {};
    const C = () => {
      const o = useObservable(() => 5);
      seen.add(o);
      setter = (n) => o.set(n);
      return <p>{useObserver(o)}</p>;
    };
    render(<Wrap><C /></Wrap>);
    expect(screen.getByText('5')).toBeTruthy();
    act(() => setter(6));
    expect(screen.getByText('6')).toBeTruthy();
    // StrictMode may create a discarded instance on the first double-render; at most 2.
    expect(seen.size).toBeLessThanOrEqual(2);
  });

  it('useComputed memoizes per deps', () => {
    const a = observable(1);
    const C = ({ m }: { m: number }) => {
      const c = useComputed(() => a.value * m, [m]);
      return <p>{useObserver(c)}</p>;
    };
    const { rerender } = render(<Wrap><C m={2} /></Wrap>);
    expect(screen.getByText('2')).toBeTruthy();
    rerender(<Wrap><C m={3} /></Wrap>);
    expect(screen.getByText('3')).toBeTruthy();
    act(() => a.set(2));
    expect(screen.getByText('6')).toBeTruthy();
  });

  it('getSnapshot is cached: no infinite-loop warnings', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = observable({ x: 1 });
    const C = () => <p>{useObserver(s, (v) => ({ ...v })).x}</p>;
    render(<Wrap><C /></Wrap>);
    act(() => s.set({ x: 2 }));
    expect(screen.getByText('2')).toBeTruthy();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('useObserverEffect', () => {
  it('runs after mount, re-runs only on dep change (not re-render), cleans up on unmount', () => {
    const a = observable(1);
    const log: string[] = [];
    let force: () => void = () => {};
    const C = () => {
      const [, set] = useState(0);
      force = () => set((x) => x + 1);
      useObserverEffect(() => {
        const v = a.value;
        log.push('run ' + v);
        return () => log.push('clean ' + v);
      });
      return null;
    };
    const { unmount } = render(<C />);
    expect(log).toEqual(['run 1']);
    act(() => force());
    act(() => force());
    expect(log).toEqual(['run 1']);
    act(() => a.set(2));
    expect(log).toEqual(['run 1', 'clean 1', 'run 2']);
    unmount();
    expect(log).toEqual(['run 1', 'clean 1', 'run 2', 'clean 2']);
    act(() => a.set(3));
    expect(log.length).toBe(4);
  });

  it('always calls the latest fn', () => {
    const a = observable(0);
    const log: string[] = [];
    const C = ({ tag }: { tag: string }) => {
      useObserverEffect(() => {
        log.push(tag + a.value);
      });
      return null;
    };
    const { rerender } = render(<C tag="x" />);
    rerender(<C tag="y" />);
    act(() => a.set(1));
    expect(log).toEqual(['x0', 'y1']);
  });

  it('StrictMode: balanced runs/cleanups, single live effect', () => {
    const a = observable(1);
    let live = 0;
    let runs = 0;
    const C = () => {
      useObserverEffect(() => {
        a.value;
        live++;
        runs++;
        return () => live--;
      });
      return null;
    };
    const { unmount } = render(
      <StrictMode>
        <C />
      </StrictMode>,
    );
    expect(live).toBe(1);
    const r = runs;
    act(() => a.set(2));
    expect(runs).toBe(r + 1); // exactly one live effect re-ran
    expect(live).toBe(1);
    unmount();
    expect(live).toBe(0);
  });
});

describe.each(modes)('tracked() (%s)', (_m, Wrap) => {
  it('fine-grained: only the component reading a changed signal re-renders', () => {
    const a = observable(1);
    const b = observable(1);
    const r = { A: 0, B: 0, P: 0 };
    const A = tracked(() => {
      r.A++;
      return <p>a{a.value}</p>;
    });
    const B = tracked(() => {
      r.B++;
      return <p>b{b.value}</p>;
    });
    const P = () => {
      r.P++;
      return (
        <>
          <A />
          <B />
        </>
      );
    };
    render(<Wrap><P /></Wrap>);
    const s = { ...r };
    act(() => a.set(2));
    expect(screen.getByText('a2')).toBeTruthy();
    expect(r.A - s.A).toBe(_m === 'plain' ? 1 : 2); // StrictMode double-render
    expect(r.B).toBe(s.B);
    expect(r.P).toBe(s.P);
    act(() => batch(() => { a.set(3); b.set(3); }));
    expect(screen.getByText('a3')).toBeTruthy();
    expect(screen.getByText('b3')).toBeTruthy();
    expect(r.P).toBe(s.P);
  });

  it('dynamic deps: drops branches not read', () => {
    const flag = observable(true);
    const x = observable(1);
    const y = observable(1);
    let renders = 0;
    const C = tracked(() => {
      renders++;
      return <p>{flag.value ? 'x' + x.value : 'y' + y.value}</p>;
    });
    render(<Wrap><C /></Wrap>);
    act(() => flag.set(false));
    expect(screen.getByText('y1')).toBeTruthy();
    const n = renders;
    act(() => x.set(5));
    expect(renders).toBe(n);
    act(() => y.set(7));
    expect(screen.getByText('y7')).toBeTruthy();
  });

  it('tracks computed reads and props', () => {
    const a = observable(1);
    const d = computed(() => a.value * 2);
    const C = tracked(({ label }: { label: string }) => <p>{label + d.value}</p>);
    const { rerender } = render(<Wrap><C label="v" /></Wrap>);
    expect(screen.getByText('v2')).toBeTruthy();
    act(() => a.set(4));
    expect(screen.getByText('v8')).toBeTruthy();
    rerender(<Wrap><C label="w" /></Wrap>);
    expect(screen.getByText('w8')).toBeTruthy();
  });

  it('memo-wrapped and keeps displayName', () => {
    function Named() {
      return null;
    }
    const T = tracked(Named) as unknown as { displayName: string; $$typeof: symbol };
    expect(T.displayName).toBe('Named');
    expect(String(T.$$typeof)).toContain('memo');
  });

  it('unmount unsubscribes', () => {
    const a = observable(1);
    let renders = 0;
    const C = tracked(() => {
      renders++;
      return <p>{a.value}</p>;
    });
    const { unmount } = render(<Wrap><C /></Wrap>);
    unmount();
    const n = renders;
    act(() => a.set(2));
    expect(renders).toBe(n);
    expect((a as any)._targets).toBeUndefined();
  });

  it('render throwing always stops the tracker (no leaked scope)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = observable(1);
    const outside = observable(0);
    const Bad = tracked(() => {
      a.value;
      throw new Error('boom');
    });
    expect(() => render(<Wrap><Bad /></Wrap>)).toThrow('boom');
    // reads after the throw must not be tracked by a leaked scope
    const d = computed(() => outside.value);
    expect(d.value).toBe(0);
    let runs = 0;
    const C = tracked(() => {
      runs++;
      return <p>ok{a.value}</p>;
    });
    render(<Wrap><C /></Wrap>);
    const n = runs;
    act(() => outside.set(1));
    expect(runs).toBe(n);
    err.mockRestore();
  });

  it('dep changed between render and subscribe forces a re-render', () => {
    const a = observable(1);
    const C = tracked(() => {
      const v = a.value;
      if (v === 1) a.peek(); // noop
      return <p>v{v}</p>;
    });
    // Change the signal in a child's layout effect: after C rendered, before C's passive subscribe.
    const Mutator = () => {
      useLayoutEffectOnce(() => a.set(2));
      return null;
    };
    render(<Wrap><C /><Mutator /></Wrap>);
    expect(screen.getByText('v2')).toBeTruthy();
  });

  it('works with hooks inside the tracked component', () => {
    const a = observable(1);
    const C = tracked(() => {
      const [n, setN] = useState(10);
      return <button onClick={() => setN(n + 1)}>{n + a.value}</button>;
    });
    render(<Wrap><C /></Wrap>);
    act(() => screen.getByRole('button').click());
    expect(screen.getByText('12')).toBeTruthy();
    act(() => a.set(5));
    expect(screen.getByText('16')).toBeTruthy();
  });
});

import { useLayoutEffect } from 'react';
function useLayoutEffectOnce(fn: () => void) {
  useLayoutEffect(fn, []);
}

describe.each(modes)('Observe (%s)', (_m, Wrap) => {
  it('island form re-renders only itself', () => {
    const a = observable(1);
    let parent = 0;
    const P = () => {
      parent++;
      return <Observe>{() => <p>i{a.value}</p>}</Observe>;
    };
    render(<Wrap><P /></Wrap>);
    const n = parent;
    act(() => a.set(2));
    expect(screen.getByText('i2')).toBeTruthy();
    expect(parent).toBe(n);
  });

  it('compat observer form', () => {
    const a = observable('x');
    render(<Wrap><Observe observer={a}>{(v) => <p>c{v}</p>}</Observe></Wrap>);
    expect(screen.getByText('cx')).toBeTruthy();
    act(() => a.set('y'));
    expect(screen.getByText('cy')).toBeTruthy();
  });
});

describe('no tearing', () => {
  it('useObserver sees updates made between render and subscribe', () => {
    const a = observable(1);
    const C = () => <p>t{useObserver(a)}</p>;
    const M = () => {
      useLayoutEffectOnce(() => a.set(9));
      return null;
    };
    render(<><C /><M /></>);
    expect(screen.getByText('t9')).toBeTruthy();
  });
});
