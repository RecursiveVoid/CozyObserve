// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import { useStore, useResource } from '../../src/react/index';
import { observable, store, resource } from '../../src/index';

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  errSpy.mockRestore();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('spec §5 useStore(s) — snapshot', () => {
  it('renders a snapshot and re-renders on deep change', () => {
    const s = store({ a: { b: 1 }, list: [1, 2] });
    let renders = 0;
    function C() {
      renders++;
      const snap = useStore(s);
      return (
        <span data-testid="v">
          {snap.a.b}:{snap.list.join(',')}
        </span>
      );
    }
    render(<C />);
    expect(screen.getByTestId('v').textContent).toBe('1:1,2');
    act(() => {
      s.a.b = 2;
    });
    expect(screen.getByTestId('v').textContent).toBe('2:1,2');
    act(() => {
      s.list.push(3);
    });
    expect(screen.getByTestId('v').textContent).toBe('2:1,2,3');
    expect(renders).toBe(3);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('returned snapshot is frozen and stable between renders when unchanged', () => {
    const s = store({ a: { b: 1 } });
    const snaps: unknown[] = [];
    function C({ n }: { n: number }) {
      const snap = useStore(s);
      snaps.push(snap);
      return <span>{n}</span>;
    }
    const { rerender } = render(<C n={1} />);
    rerender(<C n={2} />);
    expect(snaps[1]).toBe(snaps[0]);
    expect(Object.isFrozen(snaps[0])).toBe(true);
  });

  it('assigning the same value does not re-render', () => {
    const s = store({ a: 1 });
    let renders = 0;
    function C() {
      renders++;
      return <span>{useStore(s).a}</span>;
    }
    render(<C />);
    act(() => {
      s.a = 1;
    });
    expect(renders).toBe(1);
  });

  it('array splice / mutating method → single re-render', () => {
    const s = store({ list: [1, 2, 3, 4] });
    let renders = 0;
    function C() {
      renders++;
      return <span data-testid="v">{useStore(s).list.join(',')}</span>;
    }
    render(<C />);
    act(() => {
      s.list.splice(1, 2, 9);
    });
    expect(screen.getByTestId('v').textContent).toBe('1,9,4');
    expect(renders).toBe(2);
  });
});

describe('spec §5 useStore(s, selector, equals)', () => {
  it('re-renders selector consumer only when its slice changes (fine-grained)', () => {
    const s = store({ user: { name: 'ann' }, count: 0 });
    let renders = 0;
    function C() {
      renders++;
      const name = useStore(s, (snap) => snap.user.name);
      return <span data-testid="v">{name}</span>;
    }
    render(<C />);
    act(() => {
      s.count++;
    });
    act(() => {
      s.count++;
    });
    expect(renders).toBe(1);
    act(() => {
      s.user.name = 'bob';
    });
    expect(screen.getByTestId('v').textContent).toBe('bob');
    expect(renders).toBe(2);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('selecting a subtree returns a structurally-shared reference (no re-render on unrelated change)', () => {
    const s = store({ user: { name: 'ann' }, count: 0 });
    let renders = 0;
    function C() {
      renders++;
      const user = useStore(s, (snap) => snap.user);
      return <span>{user.name}</span>;
    }
    render(<C />);
    act(() => {
      s.count = 5;
    });
    expect(renders).toBe(1);
  });

  it('custom equals: derived fresh object does not re-render when equal', () => {
    const s = store({ a: 1, b: 1 });
    let renders = 0;
    function C() {
      renders++;
      const v = useStore(
        s,
        (snap) => ({ a: snap.a }),
        (x, y) => x.a === y.a,
      );
      return <span data-testid="v">{v.a}</span>;
    }
    render(<C />);
    act(() => {
      s.b = 2;
    });
    expect(renders).toBe(1);
    act(() => {
      s.a = 2;
    });
    expect(screen.getByTestId('v').textContent).toBe('2');
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('selector returning fresh array (no equals) does not loop / warn', () => {
    const s = store({ a: 1 });
    let renders = 0;
    function C() {
      renders++;
      const v = useStore(s, (snap) => [snap.a]);
      return <span data-testid="v">{v[0]}</span>;
    }
    render(<C />);
    act(() => {
      s.a = 2;
    });
    expect(screen.getByTestId('v').textContent).toBe('2');
    expect(renders).toBeLessThan(10);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('two consumers of different slices: only the affected one re-renders', () => {
    const s = store({ x: 0, y: 0 });
    let rx = 0;
    let ry = 0;
    function X() {
      rx++;
      return <span>{useStore(s, (v) => v.x)}</span>;
    }
    function Y() {
      ry++;
      return <span>{useStore(s, (v) => v.y)}</span>;
    }
    render(
      <>
        <X />
        <Y />
      </>,
    );
    act(() => {
      s.x = 1;
    });
    expect([rx, ry]).toEqual([2, 1]);
  });
});

describe('spec §5 useResource', () => {
  it('loading → success rendering', async () => {
    const d = deferred<string>();
    const r = resource(() => d.promise);
    function C() {
      const { status, value, loading } = useResource(r);
      return (
        <span data-testid="v">
          {status}|{String(loading)}|{value ?? '-'}
        </span>
      );
    }
    render(<C />);
    expect(screen.getByTestId('v').textContent).toBe('loading|true|-');
    await act(async () => {
      d.resolve('data');
      await d.promise;
    });
    expect(screen.getByTestId('v').textContent).toBe('success|false|data');
    r.dispose();
  });

  it('error state', async () => {
    const d = deferred<string>();
    const r = resource(() => d.promise);
    function C() {
      const { status, error } = useResource(r);
      return (
        <span data-testid="v">
          {status}|{error ? (error as Error).message : '-'}
        </span>
      );
    }
    render(<C />);
    await act(async () => {
      d.reject(new Error('nope'));
      await d.promise.catch(() => {});
    });
    expect(screen.getByTestId('v').textContent).toBe('error|nope');
    r.dispose();
  });

  it('refetches when an observable read by the fetcher changes', async () => {
    const id = observable(1);
    const calls: number[] = [];
    const pending = new Map<number, ReturnType<typeof deferred<string>>>();
    const r = resource(() => {
      const i = id.value;
      calls.push(i);
      const d = deferred<string>();
      pending.set(i, d);
      return d.promise;
    });
    function C() {
      const { status, value } = useResource(r);
      return (
        <span data-testid="v">
          {status}|{value ?? '-'}
        </span>
      );
    }
    render(<C />);
    await act(async () => {
      pending.get(1)!.resolve('one');
      await pending.get(1)!.promise;
    });
    expect(screen.getByTestId('v').textContent).toBe('success|one');
    await act(async () => {
      id.set(2);
    });
    expect(calls).toEqual([1, 2]);
    // last successful value kept while reloading
    expect(screen.getByTestId('v').textContent).toBe('loading|one');
    await act(async () => {
      pending.get(2)!.resolve('two');
      await pending.get(2)!.promise;
    });
    expect(screen.getByTestId('v').textContent).toBe('success|two');
    r.dispose();
  });

  it('race: stale response after dependency change is ignored', async () => {
    const id = observable(1);
    const pending = new Map<number, ReturnType<typeof deferred<string>>>();
    const r = resource(() => {
      const i = id.value;
      const d = deferred<string>();
      pending.set(i, d);
      return d.promise;
    });
    function C() {
      const { value } = useResource(r);
      return <span data-testid="v">{value ?? '-'}</span>;
    }
    render(<C />);
    await act(async () => {
      id.set(2);
    });
    await act(async () => {
      pending.get(2)!.resolve('two');
      await pending.get(2)!.promise;
    });
    await act(async () => {
      pending.get(1)!.resolve('one-stale');
      await pending.get(1)!.promise;
    });
    expect(screen.getByTestId('v').textContent).toBe('two');
    r.dispose();
  });

  it('refresh() from the hook re-runs the fetcher', async () => {
    let n = 0;
    const r = resource(async () => {
      n++;
      return n;
    });
    let refresh!: () => unknown;
    function C() {
      const res = useResource(r);
      refresh = res.refresh;
      return <span data-testid="v">{res.value ?? '-'}</span>;
    }
    render(<C />);
    await act(async () => {
      await r.promise();
    });
    expect(screen.getByTestId('v').textContent).toBe('1');
    await act(async () => {
      await refresh();
    });
    expect(screen.getByTestId('v').textContent).toBe('2');
    r.dispose();
  });

  it('component re-renders do not refetch', async () => {
    const fetcher = vi.fn(async () => 'x');
    const r = resource(fetcher);
    function C({ n }: { n: number }) {
      const { value } = useResource(r);
      return (
        <span>
          {value}
          {n}
        </span>
      );
    }
    const { rerender } = render(<C n={1} />);
    await act(async () => {
      await r.promise();
    });
    rerender(<C n={2} />);
    rerender(<C n={3} />);
    expect(fetcher).toHaveBeenCalledTimes(1);
    r.dispose();
  });
});
