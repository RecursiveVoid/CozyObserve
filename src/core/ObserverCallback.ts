/**
 * @template T
 * A callback function used for observing value changes.
 * @callback ObserverCallback
 * @param {T} newValue - The new value.
 * @param {T} oldValue - The previous value.
 */
export type ObserverCallback<T> = (newValue: T, oldValue: T) => void;
