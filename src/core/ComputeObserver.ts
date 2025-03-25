import { ObserverCallback } from './ObserverCallback';
/**
 * @template T
 * A class that computes a value and notifies subscribers when it changes.
 */
class ComputeObserver<T> {
  private _computeFn: () => T;
  private _cachedValue: T;
  private _observers = new Set<ObserverCallback<T>>();
  /**
   * @param {() => T} computeFn - A function that computes the observed value.
   */
  constructor(computeFn: () => T) {
    this._computeFn = computeFn;
    this._cachedValue = this._computeFn();
  }
  /**
   * Subscribes to changes in the computed value.
   * @param {ObserverCallback<T>} callback - The function to call when the value changes.
   * @returns {() => void} A function to unsubscribe from updates.
   */
  public subscribe(callback: ObserverCallback<T>): () => void {
    this._observers.add(callback);
    return () => this._observers.delete(callback);
  }
  /**
   * Updates the computed value and notifies subscribers if it changes.
   */
  public update() {
    const newValue = this._computeFn();
    if (newValue !== this._cachedValue) {
      const oldValue = this._cachedValue;
      this._cachedValue = newValue;
      this._observers.forEach((cb) => cb(newValue, oldValue));
    }
  }
  /**
   * Gets the current computed value.
   * @returns {T} The current value.
   */
  public get() {
    return this._cachedValue;
  }
}

export { ComputeObserver };
