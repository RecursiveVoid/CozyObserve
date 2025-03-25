import { ObserverCallback } from './ObserverCallback';

class Observer<T> {
  private _value: T;
  private _observers = new Set<ObserverCallback<T>>();

  constructor(initialValue: T) {
    this._value = initialValue;
  }

  public subscribe(callback: ObserverCallback<T>): () => void {
    this._observers.add(callback);
    return () => this._observers.delete(callback);
  }

  public set(newValue: T) {
    if (this._value !== newValue) {
      const oldValue = this._value;
      this._value = newValue;
      this._observers.forEach((cb) => cb(newValue, oldValue));
    }
  }

  public get() {
    return this._value;
  }
}

export { Observer };
