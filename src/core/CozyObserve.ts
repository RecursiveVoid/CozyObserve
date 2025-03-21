import { Callback } from './Callback';
import { IOpservable } from './IObservable';
import { ObserveOptions } from './ObserveOptions';

type SupportedTypes = object | Primitives;
type Primitives = string | number | boolean;

class CozyObserve {
  private static _objectWatchers = new WeakMap<object, Callback<any>[]>();
  private static _primitiveWatchers: Record<string, Callback<any>[]> = {};

  /**
   * Observes a target (object or primitive) and calls the callback when it changes.
   * @param target The target to observe.
   * @param callback The function to execute when the target changes.
   * @param async If true, the callback is executed asynchronously.
   * @returns A proxied object or an observable wrapper for primitives.
   */
  public static observe<T extends SupportedTypes>(
    options: ObserveOptions<T>
  ): T {
    const { target, callback, async } = options;
    return typeof target === 'object' && target !== null
      ? this._observeObject(target, callback, async)
      : (this._observePrimitive(
          target as Primitives,
          callback as Callback<Primitives>,
          async
        ) as unknown as T);
  }

  /**
   * Stops observing a target (object or primitive).
   * @param target The target to unobserve.
   * @param callback Optional. The specific callback to remove. If not provided, all callbacks are removed.
   */
  public static unobserve<T extends SupportedTypes>(
    target: T,
    callback?: Callback<T>
  ): void {
    typeof target === 'object' && target !== null
      ? this._unobserveObject(target, callback)
      : this._unobservePrimitive(
          {
            value: target as Primitives,
            __id: Symbol().toString(),
          },
          callback as Callback<Primitives>
        );
  }

  /**
   * Observes an object and notifies listeners on property changes.
   * @param obj The object to observe.
   * @param callback The function to call when a property changes.
   * @param async If true, the callback is executed asynchronously.
   * @returns A proxied object with observation capabilities.
   */
  private static _observeObject<T extends object>(
    obj: T,
    callback: Callback<T>,
    async = false
  ): T {
    this._objectWatchers.set(obj, [
      ...(this._objectWatchers.get(obj) || []),
      callback,
    ]);
    return new Proxy(obj, {
      set: (target, prop, value) => {
        if (target[prop as keyof T] !== value) {
          target[prop as keyof T] = value;
          (async ? queueMicrotask : (fn: () => void) => fn)(() =>
            this._objectWatchers
              .get(target)
              ?.forEach((cb) => cb(target, target))
          );
        }
        return true;
      },
    });
  }

  /**
   * Stops observing an object.
   * @param obj The object to stop observing.
   * @param callback Optional. The specific callback to remove. If not provided, all callbacks are removed.
   */
  private static _unobserveObject<T extends object>(
    obj: T,
    callback?: Callback<T>
  ): void {
    const callbacks = this._objectWatchers.get(obj);
    if (!callbacks) return;
    this._objectWatchers.set(
      obj,
      callback ? callbacks.filter((cb) => cb !== callback) : []
    );
    if (!callback || !this._objectWatchers.get(obj)!.length)
      this._objectWatchers.delete(obj);
  }

  /**
   * Observes a primitive value (string, number, boolean) and notifies listeners on changes.
   * @param value The primitive value to observe.
   * @param callback The function to call when the value changes.
   * @param async If true, the callback is executed asynchronously.
   * @returns An observable wrapper around the primitive value.
   */
  private static _observePrimitive<T extends Primitives>(
    value: T,
    callback: Callback<T>,
    async = false
  ): IOpservable<T> {
    const id = Symbol().toString();
    this._primitiveWatchers[id] = [callback];

    return new Proxy(
      { value, __id: id },
      {
        set: (target, prop, newValue) => {
          if (prop === 'value' && target.value !== newValue) {
            const oldValue = target.value;
            target.value = newValue;
            this._primitiveWatchers[id]?.forEach((cb) =>
              async
                ? queueMicrotask(() => cb(newValue, oldValue))
                : cb(newValue, oldValue)
            );
          }
          return true;
        },
      }
    );
  }

  /**
   * Stops observing a primitive value.
   * @param observed The observed primitive wrapper.
   * @param callback Optional. The specific callback to remove. If not provided, all callbacks are removed.
   */
  private static _unobservePrimitive<T extends Primitives>(
    observed: IOpservable<T>,
    callback?: Callback<T>
  ): void {
    const id = observed.__id;
    if (!this._primitiveWatchers[id]) return;
    this._primitiveWatchers[id] = callback
      ? this._primitiveWatchers[id].filter((cb) => cb !== callback)
      : [];
    if (!callback || !this._primitiveWatchers[id].length)
      delete this._primitiveWatchers[id];
  }

  /**
   * Removes all observers from all objects and primitives.
   */
  public static removeAllObservers(): void {
    this._objectWatchers = new WeakMap();
    this._primitiveWatchers = {};
  }
}

export { CozyObserve };
