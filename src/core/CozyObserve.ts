import { IOpservable } from './IObservable';

type Callback<T = unknown> = (newValue: T, oldValue: T) => void;

class CozyObserve {
  private static objectWatchers = new WeakMap<object, Callback<any>[]>();
  private static primitiveWatchers: Record<string, Callback<any>[]> = {};

  public static observe<T extends object | string | number | boolean>(
    target: T,
    callback: Callback<T>,
    async = false
  ): T {
    return typeof target === 'object' && target !== null
      ? this.observeObject(target, callback, async)
      : (this.observePrimitive(
          target as string | number | boolean,
          callback as Callback<string | number | boolean>,
          async
        ) as unknown as T);
  }

  public static unobserve<T extends object | string | number | boolean>(
    target: T,
    callback?: Callback<T>
  ): void {
    typeof target === 'object' && target !== null
      ? this.unobserveObject(target, callback)
      : this.unobservePrimitive(
          {
            value: target as string | number | boolean,
            __id: Symbol().toString(),
          },
          callback as Callback<string | number | boolean>
        );
  }

  private static observeObject<T extends object>(
    obj: T,
    callback: Callback<T>,
    async: boolean
  ): T {
    this.objectWatchers.set(obj, [
      ...(this.objectWatchers.get(obj) || []),
      callback,
    ]);

    return new Proxy(obj, {
      set: (target, prop, value) => {
        if (target[prop as keyof T] !== value) {
          target[prop as keyof T] = value;
          (async ? queueMicrotask : (fn: () => void) => fn)(() =>
            this.objectWatchers.get(target)?.forEach((cb) => cb(target, target))
          );
        }
        return true;
      },
    });
  }

  private static unobserveObject<T extends object>(
    obj: T,
    callback?: Callback<T>
  ): void {
    const callbacks = this.objectWatchers.get(obj);
    if (!callbacks) return;

    this.objectWatchers.set(
      obj,
      callback ? callbacks.filter((cb) => cb !== callback) : []
    );
    if (!callback || !this.objectWatchers.get(obj)!.length)
      this.objectWatchers.delete(obj);
  }

  private static observePrimitive<T extends string | number | boolean>(
    value: T,
    callback: Callback<T>,
    async: boolean
  ): IOpservable<T> {
    const id = Symbol().toString();
    this.primitiveWatchers[id] = [callback];

    return new Proxy(
      { value, __id: id },
      {
        set: (target, prop, newValue) => {
          if (prop === 'value' && target.value !== newValue) {
            const oldValue = target.value;
            target.value = newValue;
            this.primitiveWatchers[id]?.forEach((cb) =>
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

  private static unobservePrimitive<T extends string | number | boolean>(
    observed: IOpservable<T>,
    callback?: Callback<T>
  ): void {
    const id = observed.__id;
    if (!this.primitiveWatchers[id]) return;

    this.primitiveWatchers[id] = callback
      ? this.primitiveWatchers[id].filter((cb) => cb !== callback)
      : [];
    if (!callback || !this.primitiveWatchers[id].length)
      delete this.primitiveWatchers[id];
  }

  public static removeAllObservers(): void {
    this.objectWatchers = new WeakMap();
    this.primitiveWatchers = {};
  }
}

export { CozyObserve };
