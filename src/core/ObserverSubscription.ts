/**
 * @template T
 * Represents an observer subscription that includes the observed object and an unsubscribe method.
 * @typedef {Object} ObserverSubscription
 * @property {T} observer - The observed object.
 * @property {() => void} unsubscribe - Function to stop observing changes.
 */
export interface ObserverSubscription<T> {
  observer: T;
  unsubscribe: () => void;
}
