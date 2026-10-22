# CozyObserve v1 — Design Spec

This file is the contract between the dev agents, the tester agents and the project manager.
If the code and this file disagree, raise it — don't silently diverge.

## Goals

1. **Fine-grained reactivity** (signals model): automatic dependency tracking, lazy cached
   computeds, glitch-free updates, batching. No manual `update()` calls, no dependency arrays.
2. **Beats `useEffect` in React**: hooks built on `useSyncExternalStore` (no tearing, no missed
   updates between render and effect), auto-tracked effects with no deps arrays, component-level
   auto-tracking, async resources with abort + race protection.
3. **Tiny** (min+brotli, enforced by `npm run size`): core primitives `observable/computed/effect/batch`
   ≤ 1.75 kB; everything in core (store, resource, compat) ≤ 4.75 kB; React essentials incl. core ≤ 2.75 kB. Zero dependencies. `sideEffects: false`, tree-shakeable.
4. **Fast**: competitive with `@preact/signals-core` / `alien-signals`; much faster than legacy
   cozyobserve on deep objects.
5. **Backwards compatible** with 0.2.x names: `Observer`, `ComputeObserver`, `AsyncObserver`,
   `deepObserver`, `ObserverCallback`, `ObserverSubscription`, `useObserver`, `Observe`,
   `useAsyncObserver`, `useComputeObserver`, `useDeepObserver`. (Only breaking change: React
   bindings move to `cozyobserve/react`.)

## Package layout

```
src/
  index.ts            core public entry  ("cozyobserve")         — must NOT import react
  core/               reactive graph: observable, computed, effect, batch, untracked, watch
  store/              deep reactive proxy store + snapshot
  async/              async resource
  compat/             0.2.x classes/functions built on the new core
  react/index.ts      React entry        ("cozyobserve/react")   — imports core only via "../index"
test/
  core/ store/ async/ compat/   (node env)
  react/                        (jsdom: put `// @vitest-environment jsdom` at top of each file)
bench/                mitata benchmarks vs legacy, preact signals, alien-signals, mobx, zustand, rxjs
legacy/               the 0.2.2 source + tests, reference only (not built, not tested)
```

Tooling: TypeScript strict, `tsup` build (ESM + CJS + d.ts), `vitest`, `@testing-library/react`,
`size-limit`, `mitata`. Commands: `npm run typecheck`, `npm test`, `npm run build`, `npm run size`,
`npm run bench`. Internal-only symbols are exported from internal modules but NOT from `src/index.ts`.

---

## 1. Core API (`cozyobserve`)

```ts
type Unsubscribe = () => void;
type Equals<T> = (a: T, b: T) => boolean;      // default: Object.is

interface ReadonlyObservable<T> {
  readonly value: T;          // tracked read (registers dependency inside computed/effect/tracked render)
  get(): T;                   // same as .value
  peek(): T;                  // untracked read
  subscribe(cb: (value: T, prev: T) => void, options?: { immediate?: boolean }): Unsubscribe;
}
interface Observable<T> extends ReadonlyObservable<T> {
  value: T;                                   // setter = set()
  set(next: T | ((prev: T) => T)): void;      // function form is an updater. To store a function value, wrap: set(() => fn)
  update(fn: (prev: T) => T): void;           // explicit updater
}

function observable<T>(initial: T, options?: { equals?: Equals<T> | false }): Observable<T>;
function computed<T>(fn: (prev: T | undefined) => T, options?: { equals?: Equals<T> }): ReadonlyObservable<T>;
function effect(fn: () => void | (() => void)): Unsubscribe;
function batch<T>(fn: () => T): T;
function untracked<T>(fn: () => T): T;
function watch<T>(
  source: ReadonlyObservable<T> | (() => T),
  cb: (value: T, prev: T | undefined, onCleanup: (fn: () => void) => void) => void,
  options?: { immediate?: boolean; equals?: Equals<T>; once?: boolean },
): Unsubscribe;
function isObservable(x: unknown): x is ReadonlyObservable<unknown>;
function onCleanup(fn: () => void): void;     // inside effect/computed-less scopes: register cleanup for current effect run
```

### Semantics (testers: every bullet is a test)

- `observable.set(v)` with `equals(old, v) === true` is a no-op (no notifications). `equals: false` always notifies.
- **Lazy computeds**: a computed's fn does not run until first read. Reading twice with no source changes runs fn once.
  An unobserved computed (no subscribers/effects) does not hold references that keep it alive (no leaks):
  it re-validates on read via source versions.
- **Dynamic dependencies**: deps are re-collected every run; branches not taken are unsubscribed.
- **Glitch-free / diamond**: `a → b, a → c, (b,c) → d`; setting `a` runs `d` exactly once with consistent values.
  Effects never observe half-updated state.
- **Equality cutoff**: if a computed recomputes to an equal value, downstream computeds/effects/subscribers don't run.
- **Effects** run synchronously once on creation, then re-run (synchronously, after the outermost batch ends) when
  any tracked dependency changes. Returned function = cleanup, run before next run and on dispose. `onCleanup()`
  also registers cleanups. Disposing stops all future runs. Effects created inside an effect are disposed when the
  parent re-runs or is disposed (ownership).
- **batch**: nested batches; notifications flush when the outermost batch ends; returns fn's value. A `set` inside a
  batch is visible immediately to reads (`.value`/`peek()` return the new value, computeds read inside the batch are
  up to date).
- **subscribe(cb)**: cb(value, prev) runs after each change of the value (after batch). Not called initially unless
  `immediate: true` (then called with `(value, value)`). Unsubscribing inside a callback — including other callbacks
  of the same observable — is safe. Multiple subscriptions of the same function are independent.
  subscribe on a computed makes it live (eagerly kept up to date) until the last subscriber leaves.
- **Cycles**: a computed that reads itself throws `Error` containing "Cycle". An effect that writes a signal it
  reads must not loop forever: throw after 100 consecutive re-runs within a single flush ("Cycle").
- **Errors**: an error thrown in a computed is cached and re-thrown on read until a dependency changes.
  An error in one effect/subscriber must not prevent other effects/subscribers in the same flush from running;
  after the flush the first error is re-thrown.
- `untracked(fn)` and `peek()` never register dependencies.
- Writing to an observable inside a computed throws (`"Cannot write inside computed"`).
- `watch(source, cb)`: like subscribe but source can be a getter fn (auto-tracked selector); cb only fires when the
  selected value changes per `equals`; `onCleanup` registered in cb runs before next cb and on unsubscribe; `once`
  auto-unsubscribes after the first call.

### Implementation guidance (core dev)

Push-pull graph with version numbers (Preact-signals / alien-signals style): nodes have `version`; dependency
links store the version seen; writes mark downstream as `CHECK`/`DIRTY` and queue effects; computeds re-validate
lazily by comparing source versions. Use a global version counter so unobserved computeds can short-circuit.
Prefer classes with prototype methods, linked lists / arrays over `Set`/`Map` on the hot path, no closures per
notification, no `Array.prototype.forEach` in hot loops. Export from an internal module (NOT the public index) what
other modules need: the current tracking context accessor, a way to create a "tracking scope" that records deps and
gets notified (React `tracked()` needs this — see §5), and `startBatch/endBatch`.

---

## 2. Store (`store`, deep reactive objects)

```ts
function store<T extends object>(initial: T): T;              // deep reactive proxy
function snapshot<T extends object>(s: T): DeepReadonly<T>;   // immutable, structurally shared, cached
function subscribeStore<T extends object>(s: T, cb: (snap: T, prev: T) => void): Unsubscribe; // deep
function toRaw<T>(s: T): T;
function isStore(x: unknown): boolean;
```

- Per-property tracking: an effect reading `s.a.b` re-runs when `s.a.b` changes or `s.a` is replaced, NOT when
  `s.c` changes. `in`, `Object.keys`, `for...in`, `ownKeys` are tracked (re-run when keys added/removed).
- Proxies are created lazily and **cached** (WeakMap): `s.a === s.a`. No `structuredClone`.
- Arrays: index reads, `length`, iteration, and mutating methods (`push`, `splice`, `sort`, ...) work and each
  mutating method call is a single batch (one notification).
- Map/Set inside store: out of scope for v1 (stored as plain values, not deep-reactive) — document it.
- Assigning the same value is a no-op. Assigning a store proxy stores the raw target.
- `snapshot(s)`: returns frozen plain object; unchanged subtrees keep the same reference between snapshots
  (structural sharing); calling twice with no changes returns the identical object (cheap — use per-object versions).
  This is what React hooks use with `useSyncExternalStore`.
- `subscribeStore` notifies once per batch with (newSnapshot, prevSnapshot).
- Non-plain objects (Date, class instances other than plain objects/arrays, Promise, etc.) are not proxied.

---

## 3. Async (`resource`)

```ts
type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';
interface Resource<T> {
  readonly value: T | undefined;     // tracked; last successful value (kept while reloading)
  readonly error: unknown;           // tracked
  readonly status: AsyncStatus;      // tracked
  readonly loading: boolean;         // tracked
  readonly state: ReadonlyObservable<{ status: AsyncStatus; value: T | undefined; error: unknown }>;
  refresh(): Promise<T | undefined>; // re-run fetcher now
  mutate(value: T | ((prev: T | undefined) => T)): void;  // optimistic local set → status 'success'
  abort(): void;
  promise(): Promise<T>;             // resolves on next success (or now if already success); rejects on error
  dispose(): void;
}
function resource<T>(
  fetcher: Promise<T> | ((ctx: { signal: AbortSignal; prev: T | undefined }) => Promise<T> | T),
  options?: { initial?: T; lazy?: boolean },
): Resource<T>;
```

- Fetcher fn is **auto-tracked** for the synchronous part before its first `await`: if it reads observables, the
  resource re-fetches when they change (a reactive query — this replaces `useEffect(() => { fetch... }, [id])`).
- When a new fetch starts, the previous one's `AbortSignal` is aborted, and its result is ignored even if it
  resolves (race protection: last request wins).
- `lazy: true` → status `idle` until first `refresh()` or first read of `.value`.
- `dispose()` aborts in-flight and stops tracking.

---

## 4. Compat (0.2.x API on the new core)

- `class Observer<T>`: `constructor(initial)`, `get()`, `set(v)`, `subscribe(cb(new, old)) → unsubscribe` — plus all
  new `Observable` members. Note `set(fn)` is updater form in v1 — document as the one semantic change.
  `instanceof Observer` must hold for `new Observer()`; ideally `observable()` returns the same underlying class.
- `class ComputeObserver<T>`: `constructor(fn)`, `get()`, `subscribe()`, `update()` (forces recompute + notify if
  changed). Also auto-tracks observables read by fn now.
- `class AsyncObserver<T> extends Observer<T | null>`: `constructor(promise)`, `promise()`; value null until resolved.
  Fixes: rejection doesn't produce unhandled rejection crash; `promise()` resolves immediately if already resolved.
- `deepObserver(obj, cb)` → `{ observer, unsubscribe }`, built on `store` + `subscribeStore`; cb(newSnapshot, prevSnapshot).
- Types `ObserverCallback<T>`, `ObserverSubscription<T>`.

---

## 5. React (`cozyobserve/react`)

All hooks use `useSyncExternalStore`. Must work in React 18 and 19, StrictMode (double effects/render), and
concurrent rendering. SSR: `getServerSnapshot` = current value.

```ts
function useObserver<T>(source: ReadonlyObservable<T>): T;
function useObserver<T, S>(source: ReadonlyObservable<T>, selector: (v: T) => S, equals?: Equals<S>): S;
function useObserver<T>(getter: () => T, deps?: unknown[]): T;          // auto-tracked derived value
function useObservable<T>(initial: T | (() => T)): Observable<T>;       // component-local observable, stable identity
function useComputed<T>(fn: () => T, deps?: unknown[]): ReadonlyObservable<T>;
function useObserverEffect(fn: () => void | (() => void)): void;        // auto-tracked effect, NO deps array:
   // runs after mount; re-runs only when observables it read change (not on re-render);
   // always calls the latest fn (ref); cleanup on unmount; StrictMode-safe.
function useStore<T extends object>(s: T): DeepReadonly<T>;             // snapshot, re-render on deep change
function useStore<T extends object, S>(s: T, selector: (snap: T) => S, equals?: Equals<S>): S;
function useResource<T>(r: Resource<T>): { value, error, status, loading, refresh };
function tracked<P>(Component: (props: P) => ReactNode): (props: P) => ReactNode;  // auto-track every
   // observable/store read during render; re-render only when those change. memo-wrapped. displayName kept.
function Observe(props: { children: () => ReactNode }): ReactNode;      // fine-grained island, auto-tracked
function Observe<T>(props: { observer: ReadonlyObservable<T>; children: (v: T) => ReactNode }): ReactNode; // compat
// compat aliases:
useComputeObserver, useAsyncObserver (returns T | null), useDeepObserver(sub) (snapshot of sub.observer)
```

`tracked()` implementation hint: in render, open a tracking scope (from core internals) around the component call,
collect deps, close it; subscribe via `useSyncExternalStore` to a per-instance version counter bumped when any dep
changes; re-subscribe deps after each render. Must not leak scopes if render throws. Selectors in `useObserver`
must be stable under `useSyncExternalStore` (cache by input to avoid "getSnapshot should be cached" loops).

---

## Resolved ambiguities (PM decisions, after core QA round 1)

1. `subscribe()` / `watch()` called inside an effect are **not** owned by that effect — the caller holds the
   returned `Unsubscribe`. Only nested `effect()`s are owned. (Same for `resource()` created inside an effect.)
2. Writes inside `untracked()` inside a computed are allowed (escape hatch).
3. Subscribing to a computed that is currently erroring rethrows the error (current behaviour, keep).
4. `watch(..., { immediate: true })` calls cb with `prev = undefined` the first time; with `once`, the immediate
   call counts as the one call.
5. An effect that throws keeps its dependencies and re-runs on the next change. Effects within a flush run in
   the order they were scheduled (creation order for siblings).
6. Setting and resetting a value inside one batch: an effect whose computed ended up equal SHOULD NOT re-run
   (computed re-validation before running effects). Plain `subscribe` on the raw observable may still fire if
   the value differs from the pre-batch value per `equals` — it must not fire if it's equal.
7. Depth: computed chains of **10,000** must read and propagate without stack overflow.
8. `onCleanup` outside an effect is a no-op. Cleanup order: `onCleanup` callbacks in registration order, then
   the returned cleanup function.
9. React: `useObserver(getter)` / `useComputed(fn)` **without deps** always use the **latest closure**: the
   getter is re-evaluated on every render (cheap, tracked) and on observable changes. `useComputed` identity
   stays stable for the component's lifetime. With `deps`, the getter is memoized per deps (stale-closure
   rules like `useMemo`).
10. `useResource(lazyResource)` counts as a read of `.value` → triggers the first fetch on mount.
