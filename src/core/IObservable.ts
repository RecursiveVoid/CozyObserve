/**
 * Interface representing an observable primitive value.
 * @template T The type of the value being observed.
 */
interface IOpservable<T> {
  /**
   * The current value of the observable.
   */
  value: T;

  /**
   * Unique identifier for the observable instance.
   */
  __id: string;
}

export { IOpservable };
