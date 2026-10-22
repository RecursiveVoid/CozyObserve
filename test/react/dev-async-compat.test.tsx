// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AsyncObserver, ComputeObserver, Observer, observable, resource } from '../../src/index';
import {
  Observe,
  useAsyncObserver,
  useComputeObserver,
  useObserver,
  useResource,
} from '../../src/react/index';

afterEach(cleanup);

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('useResource', () => {
  it('loading → success, re-fetches reactively, refresh works, stable result object', async () => {
    const id = observable(1);
    const r = resource(async ({ signal }) => {
      const i = id.value;
      await tick();
      if (signal.aborted) throw new Error('aborted');
      return 'item' + i;
    });
    const seen: unknown[] = [];
    const C = () => {
      const s = useResource(r);
      seen.push(s);
      return <p>{s.loading ? 'loading' : s.status + ':' + s.value}</p>;
    };
    render(
      <StrictMode>
        <C />
      </StrictMode>,
    );
    expect(screen.getByText('loading')).toBeTruthy();
    await act(tick);
    expect(screen.getByText('success:item1')).toBeTruthy();
    await act(async () => {
      id.set(2);
      await tick();
    });
    expect(screen.getByText('success:item2')).toBeTruthy();
    // StrictMode double render returns the identical memoized object
    expect(seen[seen.length - 1]).toBe(seen[seen.length - 2]);
    await act(async () => {
      await (seen[seen.length - 1] as { refresh: () => Promise<unknown> }).refresh();
    });
    expect(screen.getByText('success:item2')).toBeTruthy();
    r.dispose();
  });

  it('error state', async () => {
    const r = resource(() => Promise.reject(new Error('nope')));
    const C = () => {
      const s = useResource(r);
      return <p>{s.status + (s.error ? String((s.error as Error).message) : '')}</p>;
    };
    render(<C />);
    await act(tick);
    expect(screen.getByText('errornope')).toBeTruthy();
  });

  it('starts a lazy resource after mount', async () => {
    const r = resource(async () => 7, { lazy: true });
    const C = () => <p>{useResource(r).status}</p>;
    render(<C />);
    await act(tick);
    expect(screen.getByText('success')).toBeTruthy();
  });
});

describe('compat hooks', () => {
  it('useObserver with Observer + Observe compat', () => {
    const o = new Observer(1);
    const C = () => <p>o{useObserver(o)}</p>;
    render(
      <>
        <C />
        <Observe observer={o}>{(v) => <p>w{v}</p>}</Observe>
      </>,
    );
    act(() => o.set(2));
    expect(screen.getByText('o2')).toBeTruthy();
    expect(screen.getByText('w2')).toBeTruthy();
  });

  it('useComputeObserver', () => {
    const o = new Observer(2);
    const c = new ComputeObserver(() => o.get() * 3);
    const C = () => <p>c{useComputeObserver(c)}</p>;
    render(<C />);
    expect(screen.getByText('c6')).toBeTruthy();
    act(() => o.set(3));
    expect(screen.getByText('c9')).toBeTruthy();
  });

  it('useAsyncObserver: null until resolved', async () => {
    const a = new AsyncObserver(Promise.resolve('done'));
    const C = () => <p>{String(useAsyncObserver(a))}</p>;
    render(<C />);
    expect(screen.getByText('null')).toBeTruthy();
    await act(tick);
    expect(screen.getByText('done')).toBeTruthy();
  });
});
