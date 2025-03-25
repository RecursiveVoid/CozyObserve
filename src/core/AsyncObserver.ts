import { Observer } from './Observer';
/**
 * @template T
 * @extends {Observer<T | null>}
 * A class that observes the resolution of an initial promise and updates its value accordingly.
 */
class AsyncObserver<T> extends Observer<T | null> {
  /**
   * @param {Promise<T>} initialPromise - The initial promise whose resolution will be observed.
   */
  constructor(initialPromise: Promise<T>) {
    super(null);
    initialPromise.then((value) => this.set(value));
  }
  /**
   * Returns a promise that resolves when the observer's value is updated.
   * @returns {Promise<T | null>} A promise that resolves to the observed value.
   */
  public async promise(): Promise<T | null> {
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe((value) => {
        if (value !== null) {
          unsubscribe();
          resolve(value);
        }
      });
    });
  }
}
export { AsyncObserver };
