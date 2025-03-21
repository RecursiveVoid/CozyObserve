/**
 * Function type that gets called when an observed value changes.
 *
 * @template T - The type of the observed value.
 * @param {T} newValue - The new value after the change.
 * @param {T} oldValue - The previous value before the change.
 */
export type Callback<T = unknown> = (newValue: T, oldValue: T) => void;
