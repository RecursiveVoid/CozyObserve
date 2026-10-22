// cozyobserve/react — React bindings. Public core only via '../index', internals via '../core/internal'
// (so the bundle shares one core chunk with the main entry).
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { computed, effect, observable, snapshot, subscribeStore, untracked } from '../index';
import type {
  AsyncStatus,
  DeepReadonly,
  Equals,
  Observable,
  ReadonlyObservable,
  Resource,
  Unsubscribe,
} from '../index';
import { createTracker } from '../core/internal';

const is = Object.is;
// useLayoutEffect without the React 18 SSR warning
const useIsoLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Shared useSyncExternalStore wrapper. `sub`/`get` are bound to `key` (stable while `key` is).
 * With a selector, the snapshot is cached by input and by `equals` so getSnapshot is stable.
 */
function useSub<T, S = T>(
  key: unknown,
  sub: (cb: () => void) => Unsubscribe,
  get: () => T,
  sel?: (v: T) => S,
  eq: Equals<S> = is,
): S {
  const subscribe = useCallback(sub, [key]);
  const snap = useMemo(() => {
    let has = false;
    let i: T;
    let o: S;
    return (): S => {
      // untracked: never leak into an enclosing tracked()/Observe scope
      const v = untracked(get);
      if (!sel) return v as unknown as S;
      if (!has || !is(i, v)) {
        const n = untracked(() => sel(v));
        if (!has || !eq(o, n)) o = n;
        i = v;
        has = true;
      }
      return o;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sel, eq]);
  return useSyncExternalStore(subscribe, snap, snap);
}

type Inst = {
  /** version bumped on dep change (the uSES snapshot) */ v: number;
  /** uSES listener while subscribed */ cb?: () => void;
  t: ReturnType<typeof createTracker>;
  /** latest getter (useObserver no-deps form) */ f?: () => unknown;
  /** last rendered value (useObserver no-deps form) */ o?: unknown;
};

/**
 * Per-instance tracking scope + useSyncExternalStore on its version. The tracker starts
 * UNSUBSCRIBED: a render that never commits (StrictMode/concurrent discard) links nothing and is GC'd.
 * Subscribed in uSES's subscribe (commit), unsubscribed on unmount; if a dep changed between render
 * and subscribe (`dirty()`), force a re-render. `changed(s)` optionally filters notifications.
 */
function useTrackerInst(changed?: (s: Inst) => boolean): Inst {
  const [s] = useState(() => {
    const i = { v: 0 } as Inst;
    i.t = createTracker(() => {
      if (!changed || changed(i)) {
        i.v++;
        i.cb && i.cb();
      }
    }, false);
    return i;
  });
  useSyncExternalStore(
    useCallback((cb: () => void) => {
      s.cb = cb;
      s.t.subscribe();
      if (s.t.dirty()) {
        s.v++;
        cb();
      }
      return () => {
        s.cb = undefined;
        s.t.unsubscribe();
      };
    }, []),
    () => s.v,
    () => s.v,
  );
  return s;
}

const getterChanged = (s: Inst): boolean => {
  try {
    // re-run inside the tracker so deps are re-collected even when the result is equal
    return !is(s.o, s.t.run(s.f!));
  } catch {
    return true; // let the render surface the error
  }
};

// ── useObserver ──────────────────────────────────────────────────────────────

/** Subscribe to an observable/computed; re-render when it changes. */
export function useObserver<T>(source: ReadonlyObservable<T>): T;
/** Subscribe to a selected slice; re-render only when the selection changes per `equals`. */
export function useObserver<T, S>(
  source: ReadonlyObservable<T>,
  selector: (v: T) => S,
  equals?: Equals<S>,
): S;
/**
 * Auto-tracked derived value. Without `deps`: the latest closure is re-evaluated (tracked) on every
 * render and re-renders when what it read changes to a different value. With `deps`: a computed
 * memoized per deps (stale-closure rules like `useMemo`).
 * Keep the call shape (with/without deps) stable for a given call site.
 */
export function useObserver<T>(getter: () => T, deps?: unknown[]): T;
export function useObserver(source: any, a?: any, b?: any): unknown {
  const fn = typeof source === 'function';
  if (fn && !a) {
    const s = useTrackerInst(getterChanged);
    s.f = source;
    return (s.o = s.t.run(source));
  }
  const src: ReadonlyObservable<unknown> = useMemo(
    () => (fn ? computed(source) : source),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    fn ? a : [source],
  );
  return useSub(
    src,
    (cb) => src.subscribe(() => cb()),
    () => src.peek(),
    fn ? undefined : a,
    b,
  );
}

/** Component-local observable with stable identity (lazy initializer like useState). */
export function useObservable<T>(initial: T | (() => T)): Observable<T> {
  return useState(() =>
    observable(typeof initial === 'function' ? (initial as () => T)() : initial),
  )[0];
}

/**
 * Component-local computed. With `deps`: memoized per deps (new identity when they change).
 * Without `deps`: stable identity for the component's lifetime, always using the latest closure
 * (re-validated after every commit; downstream is only notified if the value actually changed).
 * Read it with `useObserver` or in `tracked()`. Keep the call shape stable per call site.
 */
export function useComputed<T>(fn: () => T, deps?: unknown[]): ReadonlyObservable<T> {
  // eslint-disable-next-line react-hooks/rules-of-hooks, react-hooks/exhaustive-deps
  if (deps) return useMemo(() => computed(fn), deps);
  const [s] = useState(() => {
    const t = observable(0);
    const o: { f: () => T; t: typeof t; c: ReadonlyObservable<T> } = {
      f: fn,
      t,
      c: computed((): T => (t.value, o.f())),
    };
    return o;
  });
  s.f = fn; // any recompute uses the latest closure
  // invalidate after commit — not during render, where the write would notify other components
  useIsoLayoutEffect(() => {
    s.t.set(s.t.peek() + 1);
  });
  return s.c;
}

/**
 * Auto-tracked effect — no deps array. Runs after mount, re-runs only when observables it read
 * change (not on re-render), always calls the latest `fn`, cleans up on unmount. StrictMode-safe:
 * the simulated unmount disposes the core effect and the remount creates a fresh one.
 */
export function useObserverEffect(fn: () => void | (() => void)): void {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => effect(() => ref.current()), []);
}

// ── store / resource ─────────────────────────────────────────────────────────

/** Immutable snapshot of a store; re-renders on deep change (structural sharing keeps refs stable). */
export function useStore<T extends object>(s: T): DeepReadonly<T>;
export function useStore<T extends object, S>(
  s: T,
  selector: (snap: DeepReadonly<T>) => S,
  equals?: Equals<S>,
): S;
export function useStore(s: object, sel?: (v: any) => unknown, eq?: Equals<unknown>): unknown {
  return useSub(
    s,
    (cb) => subscribeStore(s, () => cb()),
    () => snapshot(s),
    sel,
    eq,
  );
}

export interface UseResourceResult<T> {
  value: T | undefined;
  error: unknown;
  status: AsyncStatus;
  loading: boolean;
  refresh: () => Promise<T | undefined>;
}

/** Subscribe to a resource's state. Counts as a read of `.value`: starts a `lazy` resource on mount. */
export function useResource<T>(r: Resource<T>): UseResourceResult<T> {
  const st = useObserver(r.state);
  useEffect(() => {
    untracked(() => r.value);
  }, [r]);
  return useMemo(
    () => ({ ...st, loading: st.status === 'loading', refresh: () => r.refresh() }),
    [st, r],
  );
}

// ── tracked / Observe ────────────────────────────────────────────────────────

/**
 * Auto-track every observable/store read during render; re-render only when those change.
 * memo-wrapped; displayName kept. The tracker is always stopped, even if render throws.
 */
export function tracked<P extends object>(
  Component: (props: P) => ReactNode,
): (props: P) => ReactNode {
  const M = memo((props: P): ReactNode =>
    useTrackerInst().t.run(() => Component(props)),
  ) as unknown as { displayName?: string };
  M.displayName = (Component as { displayName?: string }).displayName || Component.name;
  return M as unknown as (props: P) => ReactNode;
}

/**
 * Fine-grained reactive island: auto-tracks reads inside `children()` (or `children(observer.value)`
 * in the 0.2.x form) so only this subtree re-renders.
 */
export function Observe<T>(props: {
  observer: ReadonlyObservable<T>;
  children: (v: T) => ReactNode;
}): ReactNode;
export function Observe(props: { children: () => ReactNode }): ReactNode;
export function Observe(p: { observer?: ReadonlyObservable<unknown>; children: Function }): ReactNode {
  // not memo-wrapped: `children` is a new function on every parent render anyway
  return useTrackerInst().t.run(() => (p.observer ? p.children(p.observer.value) : p.children()));
}

// ── 0.2.x compat aliases ─────────────────────────────────────────────────────

/** @deprecated use `useObserver` */
export const useComputeObserver = <T>(c: ReadonlyObservable<T>): T => useObserver(c);
/** @deprecated use `useObserver` */
export const useAsyncObserver = <T>(a: ReadonlyObservable<T | null>): T | null => useObserver(a);
/** @deprecated use `useStore`. Snapshot of the deepObserver's store (legacy version was broken). */
export const useDeepObserver = <T extends object>(sub: { observer: T }): DeepReadonly<T> =>
  useStore(sub.observer);
