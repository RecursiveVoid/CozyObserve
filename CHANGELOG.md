# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0-beta.0] - 2026-10-22

A rewrite on a fine-grained signals core. The 0.2.x API is still available on top of it;
see [MIGRATION.md](MIGRATION.md) for the breaking changes.

### Added

- **Core reactive graph** (`cozyobserve`): `observable`, `computed`, `effect`, `batch`,
  `untracked`, `watch`, `onCleanup`, `isObservable`.
  - Automatic dependency tracking with dynamic dependencies; no dependency arrays, no manual
    `update()`.
  - Lazy, cached computeds that hold no subscriptions while unobserved (no leaks).
  - Glitch-free propagation (diamonds run once with consistent values) and equality cutoff.
  - Nested batching; reads inside a batch see the new values.
  - Effects with cleanup functions, `onCleanup`, and ownership of nested effects.
  - Error isolation: one failing effect or subscriber does not stop the others in a flush.
  - Cycle detection for self-reading computeds and effects that loop (after 100 re-runs).
  - Deep computed chains (10,000+ levels) without stack overflow.
  - `peek()`, `update(fn)`, `subscribe(cb, { immediate })`, custom `equals` (or `false`).
- **Store**: `store`, `snapshot`, `subscribeStore`, `toRaw`, `isStore`, and the
  `DeepReadonly` type. Per-property tracking (including keys, `in` and iteration), cached
  proxies, one notification per array method, frozen structurally shared snapshots.
- **Async resources**: `resource(fetcher, { initial, lazy })` with `status` / `value` /
  `error` / `loading` / `state`, auto-refetch when observables read by the fetcher change,
  `AbortSignal` per fetch, last-request-wins race protection, `refresh`, `mutate`, `abort`,
  `promise`, `dispose`.
- **React entry** `cozyobserve/react`, built on `useSyncExternalStore` (React 18 and 19,
  StrictMode, concurrent rendering, SSR):
  - `useObserver` with three forms: observable, observable + selector, auto-tracked getter.
  - `useObservable`, `useComputed`, `useObserverEffect` (auto-tracked effect, no deps array).
  - `useStore(store, selector?, equals?)`, `useResource(resource)`.
  - `tracked(Component)` for component-level auto-tracking, and the `<Observe>{() => …}</Observe>` island.
- ESM + CJS builds with type definitions, `exports` map, `sideEffects: false`.
- Benchmarks (`npm run bench`) against 0.2.2, `@preact/signals-core`, `alien-signals`, MobX,
  Zustand, RxJS and Valtio; bundle size checks (`npm run size`).

### Changed

- **React bindings moved to `cozyobserve/react`.** The main entry no longer imports React.
- `set(fn)` treats a function as an updater: `set(prev => next)`. To store a function value,
  use `set(() => fn)`.
- Equality is `Object.is` instead of `!==` (`NaN` → `NaN` no longer notifies; `0` → `-0` does).
- `subscribe()` returns `() => void` (it used to return the `boolean` from `Set.delete`).
- `deepObserver` callbacks receive `(nextSnapshot, prevSnapshot)`, frozen root snapshots,
  once per batch, instead of `(target, structuredClone(old))` on every property write.
- `Observer` is now the core observable class (`observable(x) instanceof Observer`), so it
  also has `.value`, `peek()`, `update()` and takes part in auto-tracking.
- `ComputeObserver` auto-tracks observables read by its function; `update()` still forces a
  recompute for non-reactive inputs.
- `AsyncObserver.promise()` returns `Promise<T>` and rejects when the source promise rejects.
- `<Observe observer={…}>` also tracks any other observable read inside its children.

### Fixed

- `useObserver` could tear and miss updates: it copied the value into `useState` and
  subscribed in `useEffect`, so a change between render and effect was lost. All hooks now use
  `useSyncExternalStore`.
- `useDeepObserver` was broken (it called `.get()` on the plain proxied object and threw).
  It now returns a snapshot and re-renders on deep changes.
- `deepObserver` allocated a new `Proxy` on every property read (so `obj.a !== obj.a`) and ran
  `structuredClone` on every write. Proxies are now cached and snapshots are structurally
  shared; nothing is cloned.
- `deepObserver().unsubscribe()` only swapped the callback for a no-op; it now really
  unsubscribes.
- `AsyncObserver`: a rejected promise caused an unhandled rejection, and `promise()` hung
  forever if the value had already resolved (or the source rejected). It now resolves
  immediately when a value is present and rejects on rejection.
- `ComputeObserver` only updated when `update()` was called by hand; it now updates when the
  observables it reads change.
- Importing `cozyobserve` pulled in React even in non-React projects.
