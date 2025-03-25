import { JSX, useEffect, useState } from 'react';
import { AsyncObserver } from '../AsyncObserver';
import { ComputeObserver } from '../ComputeObserver';
import { Observer } from '../Observer';
import { ObserverSubscription } from '../ObserverSubscription';

/**
 * Custom hook to observe an Observer instance and re-render on value change.
 * @param {Observer<T> | ComputeObserver<T>} observer - The observer instance to subscribe to.
 * @returns {T} The current observed value.
 */
export function useObserver<T extends Observer<any> | ComputeObserver<any>>(
  observer: T
): any {
  const [value, setValue] = useState(observer.get());

  useEffect(() => {
    return observer.subscribe(setValue);
  }, [observer]);

  return value;
}
/**
 * A component that automatically re-renders when the observed value changes.
 * It works similarly to MobX's `<Observer>` component.
 *
 * @param {Object} props - The component props.
 * @param {Observer<T>} props.observer - The observer instance to watch.
 * @param {(value: T) => React.ReactNode} props.children - A render function that receives the observed value.
 *
 * @returns {React.ReactNode} The component that re-renders when the observer value changes.
 */
export function Observe<T>({
  observer,
  children,
}: {
  observer: Observer<T>;
  children: (value: T) => React.ReactNode;
}): React.ReactNode {
  const value = useObserver(observer);
  return children(value);
}

/**
 * Custom hook to observe an AsyncObserver instance and re-render on value change.
 * @param {AsyncObserver<T>} asyncObserver - The AsyncObserver instance to subscribe to.
 * @returns {T | null} The current observed value (may be null initially).
 */
export function useAsyncObserver<T>(asyncObserver: AsyncObserver<T>): T | null {
  return useObserver(asyncObserver);
}

/**
 * Custom hook to observe a ComputeObserver instance and re-render on value change.
 * @param {ComputeObserver<T>} computeObserver - The ComputeObserver instance to subscribe to.
 * @returns {T} The current computed value.
 */
export function useComputeObserver<T>(computeObserver: ComputeObserver<T>): T {
  return useObserver(computeObserver);
}

/**
 * Custom hook to observe a deep observer instance and re-render on value change.
 * @param {ObserverSubscription<T>} deepObserver - The deepObserver subscription object containing the observer and unsubscribe function.
 * @returns {T} The current deep-observed value.
 */
export function useDeepObserver<T extends Observer<any> | ComputeObserver<any>>(
  deepObserver: ObserverSubscription<T>
): T['get'] {
  return useObserver(deepObserver.observer);
}
