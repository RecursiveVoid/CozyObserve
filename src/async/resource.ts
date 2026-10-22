/*
 * Async resource (§3): reactive, abortable, race-safe async state.
 *
 * Decisions (see report / docs):
 * - Initial status: lazy → 'idle'; otherwise 'loading' (also when `initial` is given:
 *   `value === initial` while the first fetch runs).
 * - `error` is kept while re-loading and cleared on success / `mutate()`.
 * - `mutate()` aborts an in-flight fetch (the local write is the "last request").
 * - `abort()` restores the status that was current before loading started.
 * - `refresh()` resolves with this run's value; if the run is superseded it follows the
 *   newer run; if aborted/mutated/disposed it resolves with the current value. It rejects
 *   on error, but is pre-handled, so ignoring it never causes an unhandled rejection.
 * - `promise()` resolves on the next success (now if status is 'success'), rejects on the
 *   next error (now if status is 'error'); on a lazy idle resource it starts the fetch.
 *   `abort()`/`dispose()` settle pending `promise()`s: resolve with the value if the restored
 *   status is 'success', else reject with an `AbortError` DOMException. After dispose,
 *   `promise()` rejects with `AbortError` unless already 'success'/'error'.
 * - Errors thrown by effects/subscribers during an async settle have no caller: the run's
 *   `refresh()` promise still settles, and the error goes to `reportError` (platform
 *   `reportError` if present, else rethrown in a microtask). For sync paths (sync fetcher,
 *   `mutate()`, `abort()`) they are rethrown to the caller, like any core write.
 */
import { Computed, Signal, Tracker, createTracker } from '../core/internal';
import { batch, untracked } from '../core';
import type { ReadonlyObservable } from '../core';
import { guard } from './report';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ResourceState<T> {
  readonly status: AsyncStatus;
  readonly value: T | undefined;
  readonly error: unknown;
}

export interface FetcherContext<T> {
  /** Aborted when a newer fetch starts, on `abort()`, `mutate()` and `dispose()`. */
  signal: AbortSignal;
  /** Last successful value. */
  prev: T | undefined;
}

export type Fetcher<T> = (ctx: FetcherContext<T>) => Promise<T> | T;

export interface ResourceOptions<T> {
  initial?: T;
  lazy?: boolean;
}

export interface Resource<T> {
  /** Tracked; last successful value (kept while reloading). Reading it starts a lazy resource. */
  readonly value: T | undefined;
  readonly error: unknown;
  readonly status: AsyncStatus;
  readonly loading: boolean;
  /** Stable object identity while nothing changed. */
  readonly state: ReadonlyObservable<ResourceState<T>>;
  refresh(): Promise<T | undefined>;
  mutate(value: T | ((prev: T | undefined) => T)): void;
  abort(): void;
  promise(): Promise<T>;
  dispose(): void;
}

interface Waiter<T> {
  _resolve: (v: T) => void;
  _reject: (e: unknown) => void;
}

const abortError = (): unknown =>
  typeof DOMException === 'function'
    ? new DOMException('Aborted', 'AbortError')
    : Object.assign(new Error('Aborted'), { name: 'AbortError' });

interface Run<T> {
  _promise: Promise<T | undefined>;
  _resolve: (v: T | undefined | Promise<T | undefined>) => void;
  _reject: (e: unknown) => void;
}

const noop = () => {};

const isThenable = (x: unknown): x is PromiseLike<unknown> =>
  x != null && typeof (x as PromiseLike<unknown>).then === 'function';

const sameState = <T>(a: ResourceState<T>, b: ResourceState<T>): boolean =>
  a.status === b.status && Object.is(a.value, b.value) && Object.is(a.error, b.error);

class ResourceImpl<T> implements Resource<T> {
  /** @internal */ _fetcher: Fetcher<T>;
  /** @internal */ _value: Signal<T | undefined>;
  /** @internal */ _error: Signal<unknown>;
  /** @internal */ _status: Signal<AsyncStatus>;
  /** @internal */ _tracker: Tracker;
  /** @internal */ _ctrl: AbortController | undefined;
  /** @internal */ _run: Run<T> | undefined;
  /** @internal */ _id: number;
  /** @internal status to restore on abort */ _settled: AsyncStatus;
  /** @internal */ _disposed: boolean;
  /** @internal lazy and never started */ _lazy: boolean;
  /** @internal pending promise() callers */ _waiters: Set<Waiter<T>>;
  readonly state: ReadonlyObservable<ResourceState<T>>;

  constructor(fetcher: Promise<T> | Fetcher<T>, options: ResourceOptions<T> = {}) {
    this._fetcher = typeof fetcher === 'function' ? fetcher : () => fetcher;
    const lazy = !!options.lazy;
    this._value = new Signal<T | undefined>(options.initial);
    this._error = new Signal<unknown>(undefined);
    this._status = new Signal<AsyncStatus>(lazy ? 'idle' : 'loading');
    this._settled = options.initial !== undefined ? 'success' : 'idle';
    this._tracker = createTracker(() => this._start());
    this._ctrl = undefined;
    this._run = undefined;
    this._id = 0;
    this._disposed = false;
    this._lazy = lazy;
    this._waiters = new Set();
    this.state = new Computed<ResourceState<T>>(
      () => ({ status: this._status.value, value: this._value.value, error: this._error.value }),
      sameState,
    );
    if (!lazy) this._start();
  }

  get value(): T | undefined {
    if (this._lazy) this._start();
    return this._value.value;
  }
  get error(): unknown {
    return this._error.value;
  }
  get status(): AsyncStatus {
    return this._status.value;
  }
  get loading(): boolean {
    return this._status.value === 'loading';
  }

  /** @internal end the current run (if any) without applying its result. */
  _cancel(next?: Run<T>): void {
    this._id++;
    const ctrl = this._ctrl;
    const run = this._run;
    this._ctrl = undefined;
    this._run = undefined;
    if (ctrl) ctrl.abort();
    if (run) run._resolve(next ? next._promise : this._value.peek());
  }

  /** @internal begin a new fetch; returns its run. */
  _start(): Run<T> {
    let _resolve!: Run<T>['_resolve'];
    let _reject!: Run<T>['_reject'];
    const _promise = new Promise<T | undefined>((res, rej) => {
      _resolve = res;
      _reject = rej;
    });
    _promise.catch(noop); // errors live in `.error`; awaiting refresh() still sees them
    const run: Run<T> = { _promise, _resolve, _reject };
    if (this._disposed) {
      _resolve(this._value.peek());
      return run;
    }
    this._lazy = false;
    const prevStatus = this._status.peek();
    if (prevStatus !== 'loading') this._settled = prevStatus;
    this._cancel(run);
    const id = this._id;
    const ctrl = (this._ctrl = new AbortController());
    this._run = run;

    untracked(() =>
      batch(() => {
        this._status.set('loading');
        let result: unknown;
        try {
          result = this._tracker.run(() =>
            this._fetcher({ signal: ctrl.signal, prev: this._value.peek() }),
          );
        } catch (e) {
          this._fail(id, run, e);
          return;
        }
        if (isThenable(result)) {
          // no caller to throw to here: flush errors (effects/subscribers) → reportError
          result.then(
            (v) => guard(() => this._succeed(id, run, v as T)),
            (e) => guard(() => this._fail(id, run, e)),
          );
        } else this._succeed(id, run, result as T);
      }),
    );
    return run;
  }

  /** @internal */
  _succeed(id: number, run: Run<T>, v: T): void {
    if (id !== this._id) return; // stale
    this._ctrl = undefined;
    this._run = undefined;
    try {
      untracked(() =>
        batch(() => {
          this._value.set(() => v);
          this._error.set(undefined);
          this._status.set('success');
        }),
      );
    } finally {
      run._resolve(v); // settle even if an effect/subscriber threw during the flush
    }
  }

  /** @internal */
  _fail(id: number, run: Run<T>, e: unknown): void {
    if (id !== this._id) return; // stale: swallowed (handler attached → no unhandled rejection)
    this._ctrl = undefined;
    this._run = undefined;
    try {
      untracked(() =>
        batch(() => {
          this._error.set(() => e);
          this._status.set('error');
        }),
      );
    } finally {
      run._reject(e);
    }
  }

  /** @internal settle pending promise() callers after abort/dispose */
  _settleWaiters(): void {
    const ok = this._settled === 'success';
    const v = this._value.peek() as T;
    for (const w of Array.from(this._waiters)) ok ? w._resolve(v) : w._reject(abortError());
  }

  refresh(): Promise<T | undefined> {
    return this._start()._promise;
  }

  mutate(value: T | ((prev: T | undefined) => T)): void {
    if (this._disposed) return;
    this._cancel();
    const v =
      typeof value === 'function'
        ? (value as (p: T | undefined) => T)(this._value.peek())
        : value;
    untracked(() =>
      batch(() => {
        this._value.set(() => v);
        this._error.set(undefined);
        this._status.set('success');
      }),
    );
  }

  abort(): void {
    if (!this._run) return;
    this._cancel();
    this._settleWaiters();
    untracked(() => this._status.set(this._settled));
  }

  promise(): Promise<T> {
    const s = this.state.peek();
    if (s.status === 'success') return Promise.resolve(s.value as T);
    if (s.status === 'error') return Promise.reject(s.error);
    if (this._disposed) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      let off: (() => void) | undefined;
      const done = () => {
        this._waiters.delete(w);
        if (off) off();
        off = undefined;
      };
      const w: Waiter<T> = {
        _resolve: (v) => {
          done();
          resolve(v);
        },
        _reject: (e) => {
          done();
          reject(e);
        },
      };
      this._waiters.add(w);
      off = this.state.subscribe((st) => {
        if (st.status === 'success') w._resolve(st.value as T);
        else if (st.status === 'error') w._reject(st.error);
      });
      if (!this._waiters.has(w)) off(); // (defensive) settled during subscribe
      if (this._lazy) this._start();
    });
  }

  dispose(): void {
    if (this._disposed) return;
    const wasLoading = !!this._run;
    this._cancel();
    this._disposed = true;
    this._lazy = false;
    this._tracker.dispose();
    if (wasLoading) {
      this._settleWaiters();
      untracked(() => this._status.set(this._settled));
    }
    this._settleWaiters(); // any left (e.g. idle lazy) → AbortError
  }
}

/**
 * Typing: `T` is inferred from the fetcher's result; `ctx.prev` is `unknown` unless `T` is given
 * explicitly (`resource<User>(...)`) — TS cannot infer `T` from a context-sensitive parameter.
 *
 * Reactive async resource. `fetcher` is auto-tracked for its synchronous part (before the
 * first `await`): observables read there trigger a re-fetch when they change. Starting a
 * new fetch aborts the previous one; only the latest fetch's result is applied.
 */
export function resource<T, P = T>(
  fetcher: Promise<T> | ((ctx: FetcherContext<P>) => Promise<T> | T),
  options?: ResourceOptions<T>,
): Resource<T> {
  return new ResourceImpl<T>(fetcher as Promise<T> | Fetcher<T>, options);
}
