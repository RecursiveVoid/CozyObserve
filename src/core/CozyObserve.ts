import { ObserverCallback } from './ObserverCallback';
import { ObserverSubscription } from './ObserverSubscription';

export function deepObserver<T extends object>(
  obj: T,
  callback: ObserverCallback<T>
): ObserverSubscription<T> {
  function createProxy(target: any): any {
    if (typeof target !== 'object' || target === null) return target;
    return new Proxy(target, {
      set(target, prop, value) {
        if (target[prop] !== value) {
          const oldValue = structuredClone(target);
          target[prop] = createProxy(value);
          callback(target, oldValue);
        }
        return true;
      },
      get(target, prop) {
        return createProxy(target[prop]);
      },
    });
  }
  const proxyObj = createProxy(obj);
  return {
    observer: proxyObj,
    unsubscribe: () => {
      callback = () => {};
    },
  };
}
