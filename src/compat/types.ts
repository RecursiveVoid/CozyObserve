/** Callback for value changes: `(newValue, oldValue)`. */
export type ObserverCallback<T> = (newValue: T, oldValue: T) => void;

/** Result of `deepObserver()`: the observed (proxied) object and an unsubscribe function. */
export interface ObserverSubscription<T> {
  observer: T;
  unsubscribe: () => void;
}
