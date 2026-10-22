/*
 * Reactive graph: push-pull with version numbers (Preact-signals style).
 *
 * - Signal: source node with `_version`. Writes bump `_version` + `globalVersion`
 *   and push a NOTIFIED/OUTDATED mark downstream (iteratively); effects are queued FIFO.
 * - Computed: lazy. Re-validates on read by comparing the version stored in each
 *   dependency link with the source's current version (pull). If a version moved but the
 *   value equals the one the target last saw (per the source's `equals`), it is not a change.
 *   Unobserved computeds are not referenced by their sources (no leaks); `globalVersion`
 *   short-circuits.
 * - Links are doubly-linked in two lists: target's sources and source's targets.
 *   A link is reused across runs (version -1 = "unused so far in this run").
 * - Deep graphs: propagation and (un)subscription cascades are iterative. Nested
 *   computed re-validation/evaluation deeper than LIMIT is deferred: the deep node is
 *   resolved first from the outermost computed, then the outer one retries.
 */
import type { Equals, Observable, ReadonlyObservable, Unsubscribe } from './types';

const RUNNING = 1;
const NOTIFIED = 2;
const OUTDATED = 4;
const DISPOSED = 8;
const HAS_ERROR = 16;
const TRACKING = 32;
const COMPUTED = 64;

/**
 * Stack budget for nested computed refreshes before deferring (see Computed._refresh).
 * A re-validation level costs 1 unit, an evaluation level (user fn on the stack) 2 units:
 * → ~1200 warm levels / ~600 cold levels recurse directly; deeper ones are deferred.
 */
const LIMIT = 1200;
/** max recursion for notify / subscribe cascades before queueing (stack safety) */
const MAXN = 2000;

/** @internal dependency edge */
export interface Link {
  _source: Signal;
  _target: Target;
  /** source version seen by target; -1 = pending reuse during a run */
  _version: number;
  /** source value seen by target (ERR if it saw an error) */
  _seen: unknown;
  _prevSource: Link | undefined;
  _nextSource: Link | undefined;
  _prevTarget: Link | undefined;
  _nextTarget: Link | undefined;
  _rollback: Link | undefined;
}

/** @internal anything that can depend on signals (Computed, Effect, Tracker) */
export interface Target {
  _sources: Link | undefined;
  _flags: number;
  _notify(): void;
}

let evalContext: Target | undefined;
let owner: Effect | undefined;
let queueHead: Effect | undefined;
let queueTail: Effect | undefined;
let batchDepth = 0;
let batchIteration = 0;
let globalVersion = 0;
/** nesting of Computed._refresh */
let depth = 0;
/** nesting of notify / (un)subscribe cascades */
let ndepth = 0;
let deferred: Computed | undefined;
const DEFER = {};
const ERR = {};
/** overflow queues for deep cascades: notify / subscribe / unsubscribe */
const pendN: Computed[] = [];
const pendS: Computed[] = [];
const pendU: Computed[] = [];

const cycle = (): never => {
  throw new Error('Cycle detected');
};

const changed = <T>(eq: Equals<T> | false, a: T, b: T): boolean => eq === false || !eq(a, b);

/** process cascades that were too deep to recurse into (cold path) */
function drain(q: Computed[], m: number): void {
  let c: Computed | undefined;
  while ((c = q.pop()) !== undefined) {
    ndepth++;
    if (m) for (let n = c._sources; n !== undefined; n = n._nextSource) m < 2 ? n._source._subscribe(n) : n._source._unsubscribe(n);
    else for (let n = c._targets; n !== undefined; n = n._nextTarget) n._target._notify();
    ndepth--;
  }
}

export function startBatch(): void {
  batchDepth++;
}

export function endBatch(): void {
  if (batchDepth > 1) {
    batchDepth--;
    return;
  }
  let err: unknown;
  let has = false;
  while (queueHead !== undefined) {
    let e: Effect | undefined = queueHead;
    queueHead = queueTail = undefined;
    batchIteration++;
    while (e !== undefined) {
      const next: Effect | undefined = e._next;
      e._next = undefined;
      e._flags &= ~NOTIFIED;
      try {
        // needsToRecompute may run user `equals` / computeds: keep it inside the isolation
        if (!(e._flags & DISPOSED) && needsToRecompute(e)) e._callback();
      } catch (x) {
        if (!has) {
          err = x;
          has = true;
        }
      }
      e = next;
    }
  }
  batchIteration = 0;
  batchDepth--;
  if (has) throw err;
}

export const getCurrentObserver = (): Target | undefined => evalContext;
/** Sets the tracking context; returns the previous one (restore it afterwards). */
export function setCurrentObserver(t: Target | undefined): Target | undefined {
  const p = evalContext;
  evalContext = t;
  return p;
}

function addDependency(signal: Signal): Link | undefined {
  const t = evalContext;
  if (t === undefined) return;
  let node = signal._node;
  if (node === undefined || node._target !== t) {
    node = {
      _version: 0,
      _seen: undefined,
      _source: signal,
      _prevSource: t._sources,
      _nextSource: undefined,
      _target: t,
      _prevTarget: undefined,
      _nextTarget: undefined,
      _rollback: node,
    };
    if (t._sources !== undefined) t._sources._nextSource = node;
    t._sources = node;
    signal._node = node;
    if (t._flags & TRACKING) signal._subscribe(node);
    return node;
  }
  if (node._version === -1) {
    node._version = 0;
    // move to tail so the list stays in access order
    const next = node._nextSource;
    if (next !== undefined) {
      next._prevSource = node._prevSource;
      if (node._prevSource !== undefined) node._prevSource._nextSource = next;
      node._prevSource = t._sources;
      node._nextSource = undefined;
      t._sources!._nextSource = node;
      t._sources = node;
    }
    return node;
  }
}

function needsToRecompute(t: Target): boolean {
  for (let n = t._sources; n !== undefined; n = n._nextSource) {
    const s = n._source;
    if (!s._refresh()) return true; // cycle or too deep: recompute (the run reports/defers it)
    if (s._version !== n._version) {
      // Each version bump is a real change vs the previous value, so a single bump means
      // changed; after several, the value may be back to what this target last saw.
      if (
        s._version - n._version < 2 ||
        n._version < 0 ||
        n._seen === ERR ||
        (s as Computed)._flags & HAS_ERROR ||
        changed(s._equals, n._seen, s._value)
      )
        return true;
      n._version = s._version;
    }
  }
  return false;
}

function prepareSources(t: Target): void {
  for (let n = t._sources; n !== undefined; n = n._nextSource) {
    const rb = n._source._node;
    if (rb !== undefined) n._rollback = rb;
    n._source._node = n;
    n._version = -1;
    if (n._nextSource === undefined) {
      t._sources = n; // tail
      break;
    }
  }
}

function cleanupSources(t: Target): void {
  let n = t._sources;
  let head: Link | undefined;
  while (n !== undefined) {
    const prev = n._prevSource;
    if (n._version === -1) {
      n._source._unsubscribe(n);
      if (prev !== undefined) prev._nextSource = n._nextSource;
      if (n._nextSource !== undefined) n._nextSource._prevSource = prev;
    } else head = n;
    n._source._node = n._rollback;
    n._rollback = undefined;
    n = prev;
  }
  t._sources = head;
}

function subscribeAll(t: Target): void {
  for (let n = t._sources; n !== undefined; n = n._nextSource) n._source._subscribe(n);
}
function unsubscribeAll(t: Target): void {
  for (let n = t._sources; n !== undefined; n = n._nextSource) n._source._unsubscribe(n);
}

// ---------------------------------------------------------------------------

export class Signal<T = any> implements Observable<T> {
  /** @internal */ _value: T;
  /** @internal */ _version: number;
  /** @internal */ _node: Link | undefined;
  /** @internal */ _targets: Link | undefined;
  /** @internal */ _tail: Link | undefined;
  /** @internal */ _equals: Equals<T> | false;

  constructor(value: T, equals?: Equals<T> | false) {
    this._value = value;
    this._version = 0;
    this._node = undefined;
    this._targets = undefined;
    this._tail = undefined;
    this._equals = equals === undefined ? Object.is : equals;
  }

  /** @internal */
  _refresh(): boolean {
    return true;
  }

  /** @internal append target link (idempotent) */
  _subscribe(node: Link): void {
    if (node._prevTarget === undefined && this._targets !== node) {
      node._prevTarget = this._tail;
      if (this._tail !== undefined) this._tail._nextTarget = node;
      else this._targets = node;
      this._tail = node;
    }
  }

  /** @internal remove target link (idempotent) */
  _unsubscribe(node: Link): void {
    const prev = node._prevTarget;
    const next = node._nextTarget;
    if (prev !== undefined) prev._nextTarget = next;
    else if (this._targets === node) this._targets = next;
    else return;
    if (next !== undefined) next._prevTarget = prev;
    else this._tail = prev;
    node._prevTarget = node._nextTarget = undefined;
  }

  /** @internal raw write: no updater-function handling. */
  _set(v: T): void {
    if (evalContext && evalContext._flags & COMPUTED) throw new Error('Cannot write inside computed');
    if (changed(this._equals, this._value, v)) {
      if (batchIteration > 100) cycle();
      this._value = v;
      this._version++;
      globalVersion++;
      batchDepth++;
      try {
        for (let n = this._targets; n !== undefined; n = n._nextTarget) n._target._notify();
        if (pendN.length) drain(pendN, 0);
      } finally {
        endBatch();
      }
    }
  }

  get value(): T {
    const n = addDependency(this);
    if (n !== undefined) {
      n._version = this._version;
      n._seen = this._value;
    }
    return this._value;
  }
  set value(v: T) {
    this.set(v);
  }

  get(): T {
    return this.value;
  }

  peek(): T {
    return this._value;
  }

  set(next: T | ((prev: T) => T)): void {
    this._set(typeof next === 'function' ? (next as (p: T) => T)(this._value) : next);
  }

  update(fn: (prev: T) => T): void {
    this._set(fn(this._value));
  }

  subscribe(cb: (value: T, prev: T) => void, options?: { immediate?: boolean }): Unsubscribe {
    return listen(this, cb, options && options.immediate, false, true);
  }
}

export class Computed<T = any> extends Signal<T> implements Target {
  /** @internal */ _fn: (prev: T | undefined) => T;
  /** @internal */ _sources: Link | undefined;
  /** @internal */ _globalVersion: number;
  /** @internal */ _flags: number;

  constructor(fn: (prev: T | undefined) => T, equals?: Equals<T>) {
    super(undefined as T, equals);
    this._fn = fn;
    this._sources = undefined;
    this._globalVersion = -1;
    this._flags = OUTDATED | COMPUTED;
  }

  /**
   * @internal returns false on cycle.
   * Recursive fast path; past LIMIT nested refreshes it throws DEFER, which unwinds to the
   * outermost refresh, which refreshes the deep node first (with a fresh stack) and retries.
   */
  override _refresh(): boolean {
    this._flags &= ~NOTIFIED;
    if (this._flags & RUNNING) return false;
    // live & not marked outdated → value is current
    if ((this._flags & (OUTDATED | TRACKING)) === TRACKING) return true;
    this._flags &= ~OUTDATED;
    if (this._globalVersion === globalVersion) return true;
    if (depth > LIMIT) {
      this._flags |= OUTDATED;
      deferred = this;
      throw DEFER;
    }
    this._globalVersion = globalVersion;
    this._flags |= RUNNING;
    depth++;
    const prev = evalContext;
    try {
      if (!this._version || needsToRecompute(this)) {
        prepareSources(this);
        evalContext = this;
        depth++;
        const v = this._fn(this._flags & HAS_ERROR ? undefined : this._value);
        // a deferral still pending here was swallowed by user code: the result is invalid
        if (deferred !== undefined) throw DEFER;
        depth--;
        evalContext = prev;
        cleanupSources(this);
        if (this._flags & HAS_ERROR || !this._version || changed(this._equals, this._value, v)) {
          this._value = v;
          this._flags &= ~HAS_ERROR;
          this._version++;
        }
      }
    } catch (err) {
      if (evalContext === this) {
        depth--;
        evalContext = prev;
        cleanupSources(this);
      }
      if (deferred !== undefined) {
        // too deep: unwind to the outermost refresh, refresh the deep node there, then retry
        this._flags = (this._flags & ~RUNNING) | OUTDATED;
        this._globalVersion = -1;
        if (--depth) throw DEFER;
        const d = deferred!;
        deferred = undefined;
        d._refresh();
        return this._refresh();
      }
      this._value = err as T;
      this._flags |= HAS_ERROR;
      this._version++;
    }
    this._flags &= ~RUNNING;
    depth--;
    return true;
  }

  /** @internal going live subscribes to own sources (recursive; queued past MAXN) */
  override _subscribe(node: Link): void {
    if (this._targets === undefined) {
      this._flags |= OUTDATED | TRACKING;
      if (ndepth > MAXN) pendS.push(this);
      else {
        ndepth++;
        subscribeAll(this);
        if (!--ndepth && pendS.length) drain(pendS, 1);
      }
    }
    super._subscribe(node);
  }

  /** @internal going dead unsubscribes from own sources */
  override _unsubscribe(node: Link): void {
    if (this._targets !== undefined) {
      super._unsubscribe(node);
      if (this._targets === undefined) {
        this._flags &= ~TRACKING;
        if (ndepth > MAXN) pendU.push(this);
        else {
          ndepth++;
          unsubscribeAll(this);
          if (!--ndepth && pendU.length) drain(pendU, 2);
        }
      }
    }
  }

  /** @internal */
  _notify(): void {
    if (!(this._flags & NOTIFIED)) {
      this._flags |= OUTDATED | NOTIFIED;
      if (ndepth > MAXN) pendN.push(this);
      else {
        ndepth++;
        for (let n = this._targets; n !== undefined; n = n._nextTarget) n._target._notify();
        ndepth--;
      }
    }
  }

  override get value(): T {
    if (this._flags & RUNNING) cycle();
    const n = addDependency(this);
    this._refresh();
    const err = this._flags & HAS_ERROR;
    if (n !== undefined) {
      n._version = this._version;
      n._seen = err ? ERR : this._value;
    }
    if (err) throw this._value;
    return this._value;
  }

  override peek(): T {
    if (!this._refresh()) cycle();
    if (this._flags & HAS_ERROR) throw this._value;
    return this._value;
  }

  /** computeds are read-only */
  override set(_?: unknown): void {
    throw new Error('Cannot set a computed');
  }
  override update(_?: unknown): void {
    this.set();
  }
}

// ---------------------------------------------------------------------------

function addCleanup(e: Effect, fn: () => void): void {
  (e._cleanup || (e._cleanup = [])).push(fn);
}

function cleanupEffect(e: Effect): void {
  const c = e._cleanup;
  if (c !== undefined) {
    e._cleanup = undefined;
    const p = evalContext;
    evalContext = undefined;
    batchDepth++;
    let err: unknown;
    let has = false;
    for (let i = 0; i < c.length; i++) {
      try {
        c[i]();
      } catch (x) {
        if (!has) {
          err = x;
          has = true;
        }
      }
    }
    evalContext = p;
    endBatch();
    if (has) throw err;
  }
}

function disposeEffect(e: Effect): void {
  unsubscribeAll(e);
  e._sources = undefined;
  cleanupEffect(e);
}

export class Effect implements Target {
  /** @internal */ _fn: () => unknown;
  /** @internal onCleanup fns, owned child disposers, returned cleanup — in that order */
  _cleanup: (() => void)[] | undefined;
  /** @internal */ _sources: Link | undefined;
  /** @internal next in batched queue */ _next: Effect | undefined;
  /** @internal */ _flags: number;

  constructor(fn: () => unknown) {
    this._fn = fn;
    this._cleanup = undefined;
    this._sources = undefined;
    this._next = undefined;
    this._flags = TRACKING;
  }

  /** @internal */
  _callback(): void {
    if (this._flags & RUNNING) cycle();
    cleanupEffect(this);
    this._flags |= RUNNING;
    prepareSources(this);
    batchDepth++;
    const pc = evalContext;
    const po = owner;
    evalContext = owner = this;
    try {
      const c = this._fn();
      if (typeof c === 'function') addCleanup(this, c as () => void);
    } finally {
      evalContext = pc;
      owner = po;
      cleanupSources(this);
      this._flags &= ~RUNNING;
      if (this._flags & DISPOSED) disposeEffect(this);
      endBatch();
    }
  }

  /** @internal queue FIFO (scheduling order) */
  _notify(): void {
    if (!(this._flags & NOTIFIED)) {
      this._flags |= NOTIFIED;
      if (queueTail !== undefined) queueTail._next = this;
      else queueHead = this;
      queueTail = this;
    }
  }

  /** @internal */
  _dispose(): void {
    this._flags |= DISPOSED;
    if (!(this._flags & RUNNING)) disposeEffect(this);
  }
}

/** Runs an effect node for the first time (disposing it if that throws). Not owned. */
export function mount(e: Effect): Unsubscribe {
  try {
    e._callback();
  } catch (err) {
    e._dispose();
    throw err;
  }
  return e._dispose.bind(e);
}

function listen<T>(
  src: ReadonlyObservable<T>,
  cb: (value: T, prev: any, onCleanup: (fn: () => void) => void) => void,
  immediate: boolean | undefined,
  once: boolean | undefined,
  same: boolean,
): Unsubscribe {
  let init = true;
  let prev: T | undefined;
  const oc = same ? undefined : (fn: () => void) => addCleanup(e, fn);
  const e: Effect = new Effect(() => {
    const v = src.value;
    if (init) {
      init = false;
      if (!immediate) {
        prev = v;
        return;
      }
      if (same) prev = v;
    }
    // callbacks run outside the graph: untracked and unowned (effects/subscriptions
    // created in a callback are not disposed by the next notification)
    const p = evalContext;
    evalContext = owner = undefined;
    try {
      same ? (cb as (v: T, p: unknown) => void)(v, prev) : cb(v, prev, oc!);
    } finally {
      evalContext = p;
      owner = e;
      prev = v;
      if (once) e._dispose();
    }
  });
  return mount(e); // subscriptions are never owned by an enclosing effect
}

/**
 * @internal Tracking scope for React `tracked()`, resources, etc.
 * Records every signal read between `start()` and `stop()`; calls `onChange`
 * (once per flush, after the outermost batch) when any of them changes.
 */
export class Tracker extends Effect {
  /** @internal */ _prev: Target | undefined;

  constructor(onChange: () => void, subscribed = true) {
    super(onChange);
    this._prev = undefined;
    if (!subscribed) this._flags = 0;
  }

  /** @internal flush hook: notify, untracked */
  override _callback(): void {
    if (this._flags & TRACKING) {
      const p = evalContext;
      evalContext = undefined;
      try {
        this._fn();
      } finally {
        evalContext = p;
      }
    }
  }

  /** Begin collecting deps (replaces the previous dep set at `stop()`). Must be paired with `stop()`. */
  start(): void {
    this._flags = (this._flags & ~DISPOSED) | RUNNING;
    prepareSources(this);
    this._prev = evalContext;
    evalContext = this;
  }

  /** End collecting deps; drops deps not read since `start()`. */
  stop(): void {
    evalContext = this._prev;
    this._prev = undefined;
    cleanupSources(this);
    this._flags &= ~RUNNING;
    if (this._flags & DISPOSED) disposeEffect(this);
  }

  /** `start()`; fn(); `stop()` — exception safe. */
  run<R>(fn: () => R): R {
    this.start();
    try {
      return fn();
    } finally {
      this.stop();
    }
  }

  /** Link to the recorded deps so `onChange` fires. Idempotent. */
  subscribe(): void {
    if (!(this._flags & TRACKING)) {
      this._flags |= TRACKING;
      subscribeAll(this);
    }
  }

  /** Unlink from deps (deps are remembered; GC-safe; `subscribe()` again later). Idempotent. */
  unsubscribe(): void {
    if (this._flags & TRACKING) {
      this._flags &= ~TRACKING;
      unsubscribeAll(this);
    }
  }

  /** True if any recorded dep changed since it was read (works while unsubscribed). */
  dirty(): boolean {
    return needsToRecompute(this);
  }

  /** Unsubscribe and forget all deps. The tracker may be `start()`ed again. */
  dispose(): void {
    this.unsubscribe();
    this._dispose();
  }
}

// ---------------------------------------------------------------------------
// public API

export function observable<T>(
  initial: T,
  options?: { equals?: Equals<NoInfer<T>> | false },
): Observable<T> {
  return new Signal(initial, options && options.equals);
}

export function computed<T>(
  fn: (prev: T | undefined) => T,
  options?: { equals?: Equals<T> },
): ReadonlyObservable<T> {
  return new Computed(fn, options && options.equals);
}

/** `fn` may return a cleanup function (any other return value is ignored). Owned by the running effect, if any. */
export function effect(fn: () => unknown): Unsubscribe {
  const d = mount(new Effect(fn));
  if (owner !== undefined) addCleanup(owner, d);
  return d;
}

export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    endBatch();
  }
}

export function untracked<T>(fn: () => T): T {
  const p = evalContext;
  evalContext = undefined;
  try {
    return fn();
  } finally {
    evalContext = p;
  }
}

/** Register a cleanup for the currently running effect (no-op outside effects). */
export function onCleanup(fn: () => void): void {
  if (owner !== undefined) addCleanup(owner, fn);
}

export function isObservable(x: unknown): x is ReadonlyObservable<unknown> {
  return x instanceof Signal;
}

export function watch<T>(
  source: ReadonlyObservable<T> | (() => T),
  cb: (value: T, prev: T | undefined, onCleanup: (fn: () => void) => void) => void,
  options: { immediate?: boolean; equals?: Equals<T>; once?: boolean } = {},
): Unsubscribe {
  const src =
    typeof source === 'function' || options.equals
      ? new Computed(typeof source === 'function' ? source : () => source.value, options.equals)
      : source;
  return listen(src, cb, options.immediate, options.once, false);
}
