// @vitest-environment jsdom
import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import {
  tracked,
  useObserver,
  useObserverEffect,
  useObservable,
  useStore,
} from '../../src/react/index';
import { observable, effect, store } from '../../src/index';
import type { Observable } from '../../src/index';

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  errSpy.mockRestore();
});

describe('spec §5 edge cases', () => {
  it('tracked + Suspense: suspending render does not leak scope; tracks after resolve', async () => {
    const ready = observable(false);
    const v = observable(1);
    let resolve!: () => void;
    const p = new Promise<void>((r) => (resolve = r));
    const C = tracked(() => {
      const x = v.value;
      if (!ready.peek()) throw p;
      return <span data-testid="v">{x}</span>;
    });
    render(
      <Suspense fallback={<span data-testid="fb">loading</span>}>
        <C />
      </Suspense>,
    );
    expect(screen.getByTestId('fb')).toBeTruthy();
    // no leaked scope: plain effect only tracks its own reads
    const other = observable(0);
    const fn = vi.fn(() => other.value);
    const stop = effect(fn);
    act(() => v.set(2)); // must not re-run fn
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
    await act(async () => {
      ready.set(true);
      resolve();
      await p;
    });
    expect(screen.getByTestId('v').textContent).toBe('2');
    act(() => v.set(3));
    expect(screen.getByTestId('v').textContent).toBe('3');
  });

  it('useObserverEffect inside tracked: render deps and effect deps are separate', () => {
    const a = observable(0);
    const b = observable(0);
    let renders = 0;
    const eff = vi.fn();
    const C = tracked(() => {
      renders++;
      useObserverEffect(() => {
        eff(b.value);
      });
      return <span data-testid="v">{a.value}</span>;
    });
    render(<C />);
    expect([renders, eff.mock.calls.length]).toEqual([1, 1]);
    act(() => b.set(1));
    expect([renders, eff.mock.calls.length]).toEqual([1, 2]);
    act(() => a.set(1));
    expect([renders, eff.mock.calls.length]).toEqual([2, 2]);
  });

  it('getter form without deps uses the latest closure (props)', () => {
    const a = observable(2);
    function C({ k }: { k: number }) {
      return <span data-testid="v">{useObserver(() => a.value * k)}</span>;
    }
    const { rerender } = render(<C k={1} />);
    rerender(<C k={5} />);
    expect(screen.getByTestId('v').textContent).toBe('10');
  });

  it('zombie child: removing an item and its consumer in one mutation does not throw', () => {
    const s = store({ list: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] });
    const Row = tracked(({ i }: { i: number }) => <li>{s.list[i].name}</li>);
    const List = tracked(() => (
      <ul data-testid="ul">
        {s.list.map((_, i) => (
          <Row key={i} i={i} />
        ))}
      </ul>
    ));
    render(<List />);
    act(() => {
      s.list.pop();
    });
    expect(screen.getByTestId('ul').textContent).toBe('ab');
  });

  it('zombie child with useStore selector: parent removes child in same update', () => {
    const s = store({ items: { x: { n: 1 } } as Record<string, { n: number }>, ids: ['x'] });
    function Row({ id }: { id: string }) {
      const n = useStore(s, (snap) => snap.items[id].n);
      return <li>{n}</li>;
    }
    function List() {
      const ids = useStore(s, (snap) => snap.ids);
      return (
        <ul data-testid="ul">
          {ids.map((id) => (
            <Row key={id} id={id} />
          ))}
        </ul>
      );
    }
    render(<List />);
    act(() => {
      s.ids = [];
      delete s.items.x;
    });
    expect(screen.getByTestId('ul').textContent).toBe('');
  });

  it('adding a key to a store re-renders snapshot consumers and Object.keys readers', () => {
    const s = store({ a: 1 } as Record<string, number>);
    const Keys = tracked(() => <span data-testid="k">{Object.keys(s).join(',')}</span>);
    function Snap() {
      return <span data-testid="s">{Object.keys(useStore(s)).join(',')}</span>;
    }
    render(
      <>
        <Keys />
        <Snap />
      </>,
    );
    act(() => {
      s.b = 2;
    });
    expect(screen.getByTestId('k').textContent).toBe('a,b');
    expect(screen.getByTestId('s').textContent).toBe('a,b');
  });

  it('useObservable identity is stable in StrictMode after mount', () => {
    const seen: Observable<number>[] = [];
    let force!: () => void;
    function C() {
      const [, set] = React.useState(0);
      force = () => set((x) => x + 1);
      const o = useObservable(0);
      seen.push(o);
      return <span data-testid="v">{useObserver(o)}</span>;
    }
    render(
      <React.StrictMode>
        <C />
      </React.StrictMode>,
    );
    const last = seen[seen.length - 1];
    act(() => force());
    expect(seen[seen.length - 1]).toBe(last);
    act(() => last.set(4));
    expect(screen.getByTestId('v').textContent).toBe('4');
  });
});
