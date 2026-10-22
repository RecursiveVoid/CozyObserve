// cozyobserve — public entry. Must NOT import react.

// ── core (§1) ────────────────────────────────────────────────────────────────
export {
  observable,
  computed,
  effect,
  batch,
  untracked,
  watch,
  isObservable,
  onCleanup,
} from './core';
export type { Observable, ReadonlyObservable, Unsubscribe, Equals } from './core';

// ── store (§2) ── store dev: add exports here ────────────────────────────────
export { store, snapshot, subscribeStore, toRaw, isStore, deepObserver } from './store';
export type { DeepReadonly } from './store';

// ── async (§3) ── async dev: add exports here ────────────────────────────────
export { resource } from './async';
export type {
  Resource,
  AsyncStatus,
  ResourceState,
  ResourceOptions,
  Fetcher,
  FetcherContext,
} from './async';

// ── compat (§4) ── compat dev: add exports here ──────────────────────────────
export { Observer, ComputeObserver, AsyncObserver } from './compat';
export type { ObserverCallback, ObserverSubscription } from './compat';
