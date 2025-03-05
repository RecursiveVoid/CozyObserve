/**
 * Defines the options for observing an object using CozyObserver.
 * This interface allows you to track changes in an object and trigger a callback when modifications occur.
 *
 * @template T - The type of the target object to be observed.
 */
interface ObservableOptions<T> {
  /**
   * The object to be observed.
   * Any modifications to this object or its nested properties will trigger the callback.
   */
  target: T;

  /**
   * The function to be executed whenever a change is detected in the observed object.
   */
  callback: () => void;

  /**
   * Determines whether the callback should be executed asynchronously.
   * - `true`: Uses microtasks (`queueMicrotask`) to defer execution.
   * - `false` or `undefined`: Executes the callback synchronously after a change.
   *
   * @default false
   */
  async?: boolean;
}

export { ObservableOptions };
