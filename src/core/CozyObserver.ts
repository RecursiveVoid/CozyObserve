import { ObservableOptions } from './types/ObservableOptions';

class CozyObserver {
  private _observedObjects: WeakMap<object, object>;

  constructor() {
    // TODO test performance / memory with weakMap vs record
    this._observedObjects = new WeakMap<object, object>();
  }

  /**
   * Observes an object for changes and triggers the callback whenever it is modified.
   *
   * @param options - The options for observation.
   * @returns A proxy-wrapped object that reacts to changes.
   */
  public observe<T extends object>(options: ObservableOptions<T>): T {
    if (this._observedObjects.has(options.target)) {
      return this._observedObjects.get(options.target) as T;
    }

    const proxy = this._createReactive(options);
    this._observedObjects.set(options.target, proxy);
    return proxy;
  }

  private _createReactive<T extends object>(options: ObservableOptions<T>): T {
    const { target, callback, async } = options;
    const observerInstance = this;

    const triggerCallback = () => {
      if (async) {
        queueMicrotask(callback);
      } else {
        callback();
      }
    };

    return new Proxy(target, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'object' && value !== null) {
          return (
            observerInstance._observedObjects.get(value) ??
            observerInstance.observe({ target: value, callback, async })
          );
        }
        return value;
      },
      set(
        target: Record<string | symbol, any>,
        prop: string | symbol,
        value: any
      ) {
        if (Reflect.get(target, prop) !== value) {
          Reflect.set(target, prop, value);
          triggerCallback();
        }
        return true;
      },
    });
  }

  /**
   * Stops observing an object and restores its original functionality.
   *
   * @param target - The observed object to unobserve.
   */
  public unobserve<T extends object>(target: T): void {
    if (this._observedObjects.has(target)) {
      this._observedObjects.delete(target);
      Object.values(target).forEach((value) => {
        if (typeof value === 'object' && value !== null) {
          this.unobserve(value);
        }
      });
    }
  }
}

export { CozyObserver };
