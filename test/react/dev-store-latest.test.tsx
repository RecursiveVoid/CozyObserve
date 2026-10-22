// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deepObserver, observable, store } from '../../src/index';
import type { ReadonlyObservable } from '../../src/index';
import {
  tracked,
  useComputed,
  useDeepObserver,
  useObserver,
  useStore,
} from '../../src/react/index';

afterEach(cleanup);

const modes = [
  ['plain', ({ children }: { children: React.ReactNode }) => <>{children}</>],
  ['StrictMode', StrictMode],
] as const;

describe.each(modes)('no-deps latest closure (%s)', (_m, Wrap) => {
  it('useObserver(getter): latest props, dynamic deps follow the closure', () => {
    const a = observable(1);
    const b = observable(100);
    const C = ({ useB }: { useB: boolean }) => (
      <p>{useObserver(() => (useB ? b.value : a.value))}</p>
    );
    const { rerender } = render(<Wrap><C useB={false} /></Wrap>);
    expect(screen.getByText('1')).toBeTruthy();
    rerender(<Wrap><C useB={true} /></Wrap>);
    expect(screen.getByText('100')).toBeTruthy();
    act(() => b.set(200));
    expect(screen.getByText('200')).toBeTruthy();
  });

  it('useObserver(getter): equality cutoff — no re-render when derived value is unchanged', () => {
    const a = observable(1);
    let renders = 0;
    const C = () => {
      renders++;
      return <p>{useObserver(() => a.value > 0 ? 'pos' : 'neg')}</p>;
    };
    render(<Wrap><C /></Wrap>);
    const n = renders;
    act(() => a.set(5));
    expect(renders).toBe(n);
    act(() => a.set(-1));
    expect(screen.getByText('neg')).toBeTruthy();
  });

  it('useComputed without deps: stable identity, latest closure', () => {
    const a = observable(2);
    const seen = new Set<ReadonlyObservable<number>>();
    const C = ({ k }: { k: number }) => {
      const c = useComputed(() => a.value * k);
      seen.add(c);
      return <p>{useObserver(c)}</p>;
    };
    const { rerender } = render(<Wrap><C k={1} /></Wrap>);
    expect(screen.getByText('2')).toBeTruthy();
    rerender(<Wrap><C k={5} /></Wrap>);
    expect(screen.getByText('10')).toBeTruthy();
    act(() => a.set(3));
    expect(screen.getByText('15')).toBeTruthy();
    expect(seen.size).toBeLessThanOrEqual(_m === 'plain' ? 1 : 2);
  });

  it('useComputed without deps: unrelated re-render does not re-render consumers', () => {
    const a = observable(1);
    let child = 0;
    let c!: ReadonlyObservable<number>;
    const Child = tracked(({ src }: { src: ReadonlyObservable<number> }) => {
      child++;
      return <p>c{src.value}</p>;
    });
    const P = ({ t }: { t: number }) => {
      c = useComputed(() => a.value * 2);
      return (
        <>
          <span>{t}</span>
          <Child src={c} />
        </>
      );
    };
    const { rerender } = render(<Wrap><P t={0} /></Wrap>);
    const n = child;
    rerender(<Wrap><P t={1} /></Wrap>);
    expect(child).toBe(n); // memo + equality cutoff on the stable computed
    act(() => a.set(2));
    expect(screen.getByText('c4')).toBeTruthy();
  });
});

describe.each(modes)('useStore (%s)', (_m, Wrap) => {
  it('snapshot re-renders on deep change; selector re-renders only on its slice', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = store({ user: { name: 'a' }, n: 0 });
    const r = { all: 0, name: 0 };
    const All = () => {
      r.all++;
      const snap = useStore(s);
      return <p>all{snap.user.name + snap.n}</p>;
    };
    const Name = () => {
      r.name++;
      return <p>name{useStore(s, (x) => x.user.name)}</p>;
    };
    render(<Wrap><All /><Name /></Wrap>);
    const st = { ...r };
    act(() => {
      s.n++;
    });
    expect(screen.getByText('alla1')).toBeTruthy();
    expect(r.name).toBe(st.name);
    act(() => {
      s.user.name = 'b';
    });
    expect(screen.getByText('nameb')).toBeTruthy();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('tracked() with store reads is per-property', () => {
    const s = store({ a: 1, b: 1 });
    let ra = 0;
    const A = tracked(() => {
      ra++;
      return <p>a{s.a}</p>;
    });
    render(<Wrap><A /></Wrap>);
    const n = ra;
    act(() => {
      s.b = 2;
    });
    expect(ra).toBe(n);
    act(() => {
      s.a = 3;
    });
    expect(screen.getByText('a3')).toBeTruthy();
  });

  it('useDeepObserver returns the snapshot of the deepObserver store', () => {
    const sub = deepObserver({ x: { y: 1 } }, () => {});
    const C = () => <p>d{useDeepObserver(sub).x.y}</p>;
    render(<Wrap><C /></Wrap>);
    act(() => {
      sub.observer.x.y = 2;
    });
    expect(screen.getByText('d2')).toBeTruthy();
    sub.unsubscribe();
  });
});
