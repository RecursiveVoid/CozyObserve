import { Computed, Signal } from '../core/internal';
import type { Equals } from '../core';

/**
 * 0.2.x `ComputeObserver` on the v1 core: a computed that auto-tracks observables read by `fn`,
 * and additionally supports the legacy manual `update()` for non-reactive inputs.
 *
 * Unlike a plain `computed()`, it evaluates eagerly on construction (legacy behaviour), so
 * `get()` returns the value as of construction/last `update()` even if non-reactive inputs moved.
 */
export class ComputeObserver<T> extends Computed<T> {
  /** @internal bumped by `update()` to force a re-run */
  _tick: Signal<number>;

  constructor(computeFn: () => T, equals?: Equals<T>) {
    const tick = new Signal(0, false);
    super(() => {
      tick.value;
      return computeFn();
    }, equals);
    this._tick = tick;
    this._refresh(); // eager initial evaluation; errors are cached and rethrown by get()
  }

  /** Re-run the compute function now; subscribers are notified only if the result changed. */
  override update(): void {
    this._tick._set(this._tick.peek() + 1);
  }
}
