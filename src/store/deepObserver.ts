import type { Unsubscribe } from '../core/types';
import { store, subscribeStore } from './store';

/**
 * 0.2.x compat: deep-observe a plain object/array.
 *
 * `observer` is `store(obj)` (mutate it to trigger changes). `callback(next, prev)` is called
 * once per batch with immutable snapshots of the new and previous state.
 *
 * Difference from 0.2.x: the legacy callback got `(target, structuredClone(oldTarget))` and fired
 * once per property write; v1 passes `(newSnapshot, prevSnapshot)` — both frozen, structurally
 * shared — and coalesces writes made inside `batch()` / array methods into one call.
 */
export function deepObserver<T extends object>(
  obj: T,
  callback: (next: T, prev: T) => void,
): { observer: T; unsubscribe: Unsubscribe } {
  const observer = store(obj);
  return { observer, unsubscribe: subscribeStore(observer, callback) };
}
