/**
 * INTERNAL core API for sibling modules (store, async, compat, react).
 * NOT re-exported from `src/index.ts` — import via relative path, e.g. `../core/internal`.
 */
export {
  Signal,
  Computed,
  Effect,
  Tracker,
  mount,
  startBatch,
  endBatch,
  getCurrentObserver,
  setCurrentObserver,
} from './signal';
export type { Link, Target } from './signal';
import { Tracker } from './signal';

/**
 * Create a tracking scope. `onChange` is called (untracked, after the outermost batch,
 * at most once per flush) when any dep read during the last `start()`/`stop()` window changes.
 * `subscribed = false` → deps are recorded but not linked until `tracker.subscribe()`.
 */
export const createTracker = (onChange: () => void, subscribed = true): Tracker =>
  new Tracker(onChange, subscribed);
