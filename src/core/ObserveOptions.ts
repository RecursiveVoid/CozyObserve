import { Callback } from './Callback';

/**
 * Options for observing a target value.
 *
 * @template T - The type of the target being observed.
 */
interface ObserveOptions<T> {
  /**
   * The target object or primitive to observe.
   */
  target: T;

  /**
   * The callback function to execute when the target changes.
   */
  callback: Callback<T>;

  /**
   * Whether the callback should be executed asynchronously (Optional).
   */
  async?: boolean;
}

export { ObserveOptions };
