import { ObserverCallback } from './ObserverCallback';
/**
 * @template T
 * A basic observer class that tracks a value and notifies subscribers when it changes.
 */
class Observer<T> {
  private _value: T;
  private _observers = new Set<ObserverCallback<T>>();
  /**
   * @param {T} initialValue - The initial value to observe.
   */
  constructor(initialValue: T) {
    this._value = initialValue;
  }
  /**
   * Subscribes to changes in the value.
   * @param {ObserverCallback<T>} callback - The function to call when the value changes.
   * @returns {() => void} A function to unsubscribe.
   */
  public subscribe(callback: ObserverCallback<T>): () => void {
    this._observers.add(callback);
    return () => this._observers.delete(callback);
  }
  /**
   * Sets a new value and notifies subscribers if it changes.
   * @param {T} newValue - The new value to set.
   */
  public set(newValue: T) {
    if (this._value !== newValue) {
      const oldValue = this._value;
      this._value = newValue;
      this._observers.forEach((cb) => cb(newValue, oldValue));
    }
  }
  /**
   * Gets the current value.
   * @returns {T} The current observed value.
   */
  public get() {
    return this._value;
  }
}

export { Observer };
