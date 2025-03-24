/**
 * CozyObserve provides reactive observation for objects and primitive values.
 * It enables tracking changes and notifying registered callbacks.
 */
import { Callback } from './Callback';
import { IOpservable } from './IObservable';
import { ObserveOptions } from './ObserveOptions';

type Primitives = string | number | boolean;
type SupportedTypes = object | Primitives;

class CozyObserve {
  private static _proxyMap = new Map<
    object,
    { original: object; callbacks: Set<Callback<any>> }
  >();

  /**
   * Observes an object or primitive value and registers a callback for changes.
   * @param {ObserveOptions<T>} options - The observe options containing target, callback, and async flag.
   * @returns {T} The proxy of the observed object or primitive wrapper.
   */
  public static observe<T extends SupportedTypes>({
    target,
    callback,
    async,
  }: ObserveOptions<T>): T {
    if (!target) {
      return;
    }
    return typeof target === 'object'
      ? this._observeObject(target, callback, async)
      : (this._observePrimitive(
          target as Primitives,
          callback as Callback<Primitives>,
          async
        ) as unknown as T);
  }

  /**
   * Stops observing an object or primitive value.
   * @param {T} target - The target to unobserve.
   * @param {Callback<T>} [callback] - The specific callback to remove, or all if undefined.
   */
  public static unobserve<T extends SupportedTypes>(
    target: T,
    callback?: Callback<T>
  ): void {
    if (!target) return;
    for (const proxy of this._findAllProxies(target)) {
      const entry = this._proxyMap.get(proxy);
      if (!entry) continue;
      callback ? entry.callbacks.delete(callback) : entry.callbacks.clear();
      if (!entry.callbacks.size) this._cleanupProxy(proxy);
    }
  }

  private static *_findAllProxies(target: any): Iterable<object> {
    for (const [proxy, entry] of this._proxyMap.entries()) {
      if (
        proxy === target ||
        entry.original === target ||
        (typeof entry.original === 'object' &&
          'value' in entry.original &&
          entry.original.value === target)
      ) {
        yield proxy;
      }
    }
  }

  private static _cleanupProxy(proxy: object): void {
    const entry = this._proxyMap.get(proxy);
    if (!entry) return;
    entry.callbacks.clear();
    this._proxyMap.delete(proxy);
    if (typeof entry.original === 'object' && 'value' in entry.original) {
      (entry.original as any).value = undefined;
    }
  }

  private static _observeObject<T extends object>(
    obj: T,
    callback: Callback<T>,
    async = false
  ): T {
    for (const [proxy, entry] of this._proxyMap.entries()) {
      if (entry.original === obj) {
        entry.callbacks.add(callback);
        return proxy as T;
      }
    }
    const callbacks = new Set([callback]);
    const proxy = new Proxy(obj, {
      set: (target, prop, value) => {
        if (target[prop as keyof T] !== value) {
          const oldValue = target[prop as keyof T];
          target[prop as keyof T] = value;
          const notify = () =>
            callbacks.forEach((cb) =>
              cb(target, { ...target, [prop]: oldValue })
            );
          async ? queueMicrotask(notify) : notify();
        }
        return true;
      },
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver);
        if (Array.isArray(target) && typeof value === 'function') {
          return (...args: any[]) => {
            const result = value.apply(target, args);
            const notify = () =>
              callbacks.forEach((cb) =>
                cb(target, [...target] as unknown as T)
              );
            async ? queueMicrotask(notify) : notify();
            return result;
          };
        }
        return value;
      },
    });
    this._proxyMap.set(proxy, { original: obj, callbacks });
    return proxy as T;
  }

  private static _observePrimitive<T extends Primitives>(
    value: T,
    callback: Callback<T>,
    async = false
  ): IOpservable<T> {
    const observable = { value, __id: crypto.randomUUID() };
    const callbacks = new Set([callback]);
    const proxy = new Proxy(observable, {
      set: (target, prop, newValue) => {
        if (prop === 'value' && target.value !== newValue) {
          const oldValue = target.value;
          target.value = newValue;
          const notify = () =>
            callbacks.forEach((cb) => cb(newValue, oldValue));
          async ? queueMicrotask(notify) : notify();
        }
        return true;
      },
    });
    this._proxyMap.set(proxy, { original: observable, callbacks });
    return proxy;
  }

  /**
   * Removes all active observers.
   */
  public static removeAllObservers(): void {
    this._proxyMap.forEach((entry, proxy) => {
      entry.callbacks.clear();
      this._cleanupProxy(proxy);
    });
  }
}

export { CozyObserve };
