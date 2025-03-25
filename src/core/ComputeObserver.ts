import { ObserverCallback } from './ObserverCallback';

class ComputeObserver<T> {
  private _computeFn: () => T;
  private _cachedValue: T;
  private _observers = new Set<ObserverCallback<T>>();

  constructor(computeFn: () => T) {
    this._computeFn = computeFn;
    this._cachedValue = this._computeFn();
  }

  public subscribe(callback: ObserverCallback<T>): () => void {
    this._observers.add(callback);
    return () => this._observers.delete(callback);
  }

  public update() {
    const newValue = this._computeFn();
    if (newValue !== this._cachedValue) {
      const oldValue = this._cachedValue;
      this._cachedValue = newValue;
      this._observers.forEach((cb) => cb(newValue, oldValue));
    }
  }

  public get() {
    return this._cachedValue;
  }
}

export { ComputeObserver };
