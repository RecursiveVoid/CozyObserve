// @vitest-environment jsdom
import React, { startTransition, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import { useObserver, tracked, useStore } from '../../src/react/index';
import { observable, batch, store } from '../../src/index';

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  errSpy.mockRestore();
});

const N = 200;

describe('spec §5 many subscribers / batching', () => {
  it(`${N} useObserver components, single set → each renders exactly once more`, () => {
    const o = observable(0);
    const renders = new Array(N).fill(0);
    function Item({ i }: { i: number }) {
      renders[i]++;
      return <span data-testid={`i${i}`}>{useObserver(o)}</span>;
    }
    render(
      <>
        {Array.from({ length: N }, (_, i) => (
          <Item key={i} i={i} />
        ))}
      </>,
    );
    expect(renders.every((r) => r === 1)).toBe(true);
    act(() => o.set(1));
    expect(renders.every((r) => r === 2)).toBe(true);
    expect(screen.getByTestId('i0').textContent).toBe('1');
    expect(screen.getByTestId(`i${N - 1}`).textContent).toBe('1');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it(`${N} tracked components, single set → each renders exactly once more`, () => {
    const o = observable(0);
    const renders = new Array(N).fill(0);
    const Item = tracked(({ i }: { i: number }) => {
      renders[i]++;
      return <span data-testid={`t${i}`}>{o.value}</span>;
    });
    render(
      <>
        {Array.from({ length: N }, (_, i) => (
          <Item key={i} i={i} />
        ))}
      </>,
    );
    act(() => o.set(1));
    expect(renders.every((r) => r === 2)).toBe(true);
    expect(screen.getByTestId(`t${N - 1}`).textContent).toBe('1');
  });

  it(`${N} useStore selector consumers, each on its own key: one mutation → one re-render`, () => {
    const s = store({ items: Array.from({ length: N }, (_, i) => ({ n: i })) });
    const renders = new Array(N).fill(0);
    function Item({ i }: { i: number }) {
      renders[i]++;
      const n = useStore(s, (snap) => snap.items[i].n);
      return <span data-testid={`s${i}`}>{n}</span>;
    }
    render(
      <>
        {Array.from({ length: N }, (_, i) => (
          <Item key={i} i={i} />
        ))}
      </>,
    );
    act(() => {
      s.items[7].n = 999;
    });
    expect(renders[7]).toBe(2);
    expect(renders.filter((r) => r !== 1).length).toBe(1);
    expect(screen.getByTestId('s7').textContent).toBe('999');
  });

  it('multiple sets in one act (no explicit batch) → single render per component', () => {
    const a = observable(0);
    const b = observable(0);
    let renders = 0;
    function C() {
      renders++;
      const x = useObserver(a);
      const y = useObserver(b);
      return <span data-testid="v">{x + y}</span>;
    }
    render(<C />);
    act(() => {
      a.set(1);
      b.set(2);
      a.set(3);
    });
    expect(renders).toBe(2);
    expect(screen.getByTestId('v').textContent).toBe('5');
  });

  it('explicit batch over many observables → single render for a tracked reader of all', () => {
    const obs = Array.from({ length: 50 }, () => observable(0));
    let renders = 0;
    const C = tracked(() => {
      renders++;
      return <span data-testid="v">{obs.reduce((acc, o) => acc + o.value, 0)}</span>;
    });
    render(<C />);
    act(() =>
      batch(() => {
        obs.forEach((o, i) => o.set(i + 1));
      }),
    );
    expect(renders).toBe(2);
    expect(screen.getByTestId('v').textContent).toBe(String((50 * 51) / 2));
  });

  it('concurrent transition: external store update during transition renders consistent values', async () => {
    const o = observable(0);
    function Reader({ id }: { id: string }) {
      return <span data-testid={id}>{useObserver(o)}</span>;
    }
    let setShow!: (b: boolean) => void;
    function App() {
      const [show, _set] = useState(false);
      setShow = _set;
      return (
        <>
          <Reader id="a" />
          {show && <Reader id="b" />}
        </>
      );
    }
    render(<App />);
    await act(async () => {
      startTransition(() => setShow(true));
      o.set(1);
    });
    expect(screen.getByTestId('a').textContent).toBe('1');
    expect(screen.getByTestId('b').textContent).toBe('1');
  });
});
