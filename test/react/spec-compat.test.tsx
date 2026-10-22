// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import {
  useObserver,
  useComputeObserver,
  useAsyncObserver,
  useDeepObserver,
  Observe,
} from '../../src/react/index';
import { Observer, ComputeObserver, AsyncObserver, deepObserver } from '../../src/index';

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  errSpy.mockRestore();
});

describe('spec §5 compat hooks (0.2.x API)', () => {
  it('useObserver(new Observer(...)) renders and updates', () => {
    const o = new Observer(1);
    function C() {
      return <span data-testid="v">{useObserver(o)}</span>;
    }
    render(<C />);
    expect(screen.getByTestId('v').textContent).toBe('1');
    act(() => o.set(2));
    expect(screen.getByTestId('v').textContent).toBe('2');
  });

  it('useComputeObserver re-renders when the underlying Observer changes (auto-tracked)', () => {
    const a = new Observer(2);
    const c = new ComputeObserver(() => a.get() * 10);
    let renders = 0;
    function C() {
      renders++;
      return <span data-testid="v">{useComputeObserver(c)}</span>;
    }
    render(<C />);
    expect(screen.getByTestId('v').textContent).toBe('20');
    act(() => a.set(3));
    expect(screen.getByTestId('v').textContent).toBe('30');
    expect(renders).toBe(2);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('useComputeObserver reflects ComputeObserver.update() for non-reactive inputs', () => {
    let external = 1;
    const c = new ComputeObserver(() => external);
    function C() {
      return <span data-testid="v">{useComputeObserver(c)}</span>;
    }
    render(<C />);
    external = 5;
    act(() => c.update());
    expect(screen.getByTestId('v').textContent).toBe('5');
  });

  it('useAsyncObserver: null then resolved value', async () => {
    let resolve!: (v: string) => void;
    const p = new Promise<string>((r) => (resolve = r));
    const ao = new AsyncObserver(p);
    const seen: (string | null)[] = [];
    function C() {
      const v = useAsyncObserver(ao);
      seen.push(v);
      return <span data-testid="v">{v === null ? 'null' : v}</span>;
    }
    render(<C />);
    expect(screen.getByTestId('v').textContent).toBe('null');
    await act(async () => {
      resolve('done');
      await p;
    });
    expect(screen.getByTestId('v').textContent).toBe('done');
    expect(seen[0]).toBeNull();
  });

  it('useAsyncObserver: rejection does not crash and stays null', async () => {
    let reject!: (e: unknown) => void;
    const p = new Promise<string>((_, r) => (reject = r));
    const ao = new AsyncObserver(p);
    function C() {
      const v = useAsyncObserver(ao);
      return <span data-testid="v">{v === null ? 'null' : v}</span>;
    }
    render(<C />);
    await act(async () => {
      reject(new Error('x'));
      await p.catch(() => {});
    });
    expect(screen.getByTestId('v').textContent).toBe('null');
  });

  it('useDeepObserver re-renders on deep mutation of deepObserver(...).observer', () => {
    const cb = vi.fn();
    const sub = deepObserver({ a: { b: 1 }, list: [1] }, cb);
    let renders = 0;
    function C() {
      renders++;
      const snap = useDeepObserver(sub) as any;
      return (
        <span data-testid="v">
          {snap.a.b}:{snap.list.length}
        </span>
      );
    }
    render(<C />);
    expect(screen.getByTestId('v').textContent).toBe('1:1');
    act(() => {
      (sub.observer as any).a.b = 2;
    });
    expect(screen.getByTestId('v').textContent).toBe('2:1');
    expect(cb).toHaveBeenCalled();
    act(() => {
      (sub.observer as any).list.push(2);
    });
    expect(screen.getByTestId('v').textContent).toBe('2:2');
    expect(renders).toBe(3);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('useDeepObserver: unrelated re-render keeps the same snapshot reference', () => {
    const sub = deepObserver({ a: 1 }, () => {});
    const snaps: unknown[] = [];
    function C({ n }: { n: number }) {
      snaps.push(useDeepObserver(sub));
      return <span>{n}</span>;
    }
    const { rerender } = render(<C n={1} />);
    rerender(<C n={2} />);
    expect(snaps[1]).toBe(snaps[0]);
  });

  it('legacy <Observe observer={new Observer()}>', () => {
    const o = new Observer('x');
    render(<Observe observer={o}>{(v: string) => <span data-testid="v">{v}</span>}</Observe>);
    act(() => o.set('y'));
    expect(screen.getByTestId('v').textContent).toBe('y');
  });
});
