// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { computed, observable, store } from '../../src/index';
import { Observe, tracked, useObserver, useStore } from '../../src/react/index';

afterEach(cleanup);

const modes = [
  ['plain', ({ children }: { children: React.ReactNode }) => <>{children}</>],
  ['StrictMode', StrictMode],
] as const;

describe.each(modes)('review regressions (%s)', (_m, Wrap) => {
  it('useObserver(getter): branch switch with equal result still re-collects deps', () => {
    const flag = observable(false);
    const a = observable(1);
    const b = observable(1);
    let renders = 0;
    const C = () => {
      renders++;
      return <p>v{useObserver(() => (flag.value ? a.value : b.value))}</p>;
    };
    render(<Wrap><C /></Wrap>);
    const n = renders;
    act(() => flag.set(true)); // equal result → no re-render needed
    expect(renders).toBe(n);
    act(() => a.set(2)); // must now be tracked
    expect(screen.getByText('v2')).toBeTruthy();
    const m = renders;
    act(() => b.set(5)); // old branch dropped
    expect(renders).toBe(m);
  });

  it('useStore selector inside tracked() does not leak the deep snapshot dep', () => {
    const s = store({ count: 0, other: 0 });
    let renders = 0;
    const C = tracked(() => {
      renders++;
      return <p>c{useStore(s, (x) => x.count)}</p>;
    });
    render(<Wrap><C /></Wrap>);
    const n = renders;
    act(() => {
      s.other++;
    });
    expect(renders).toBe(n);
    act(() => {
      s.count++;
    });
    expect(screen.getByText('c1')).toBeTruthy();
  });

  it('useStore selector inside Observe does not leak', () => {
    const s = store({ count: 0, other: 0 });
    let renders = 0;
    const Inner = () => {
      renders++;
      return <p>o{useStore(s, (x) => x.count)}</p>;
    };
    render(<Wrap><Observe>{() => <Inner />}</Observe></Wrap>);
    const n = renders;
    act(() => {
      s.other++;
    });
    expect(renders).toBe(n);
  });

  it('useObserver selector / computed source inside tracked() does not leak deps', () => {
    const src = observable({ a: 1, b: 1 });
    const dbl = computed(() => src.value.a * 2);
    let renders = 0;
    const C = tracked(() => {
      renders++;
      const a = useObserver(src, (v) => v.a);
      const d = useObserver(dbl);
      return <p>{a + ':' + d}</p>;
    });
    render(<Wrap><C /></Wrap>);
    const n = renders;
    act(() => src.set({ a: 1, b: 2 }));
    expect(renders).toBe(n);
    act(() => src.set({ a: 3, b: 2 }));
    expect(screen.getByText('3:6')).toBeTruthy();
  });
});
