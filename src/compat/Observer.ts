import { Signal } from '../core/internal';

/**
 * 0.2.x `Observer` on the v1 core. It IS the core observable class (`Observer === Signal`), so
 * `observable(x) instanceof Observer` holds and `new Observer(initial)` works everywhere an
 * `Observable` does (`.value`, `peek()`, `update()`, auto-tracking, `subscribe(cb(new, old))` …).
 * Note: computeds are Signals too, so `computed(...) instanceof Observer` is also true.
 *
 * Semantic change vs 0.2.x: `set(fn)` is the updater form (`set(prev => next)`);
 * to store a function value use `set(() => fn)`. Equality is `Object.is` (legacy: `!==`).
 */
export const Observer: typeof Signal = Signal;
export type Observer<T> = Signal<T>;
