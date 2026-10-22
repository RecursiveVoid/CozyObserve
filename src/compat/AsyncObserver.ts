import { Observer } from './Observer';
import { guard } from '../async/report';

/**
 * 0.2.x `AsyncObserver`: value is `null` until the promise resolves.
 * Fixes vs 0.2.x: a rejected promise does not cause an unhandled rejection (value stays null,
 * `promise()` rejects); `promise()` resolves immediately when already resolved.
 */
export class AsyncObserver<T> extends Observer<T | null> {
  /** @internal */ _source: Promise<T>;
  /** @internal */ _rejected: boolean;
  /** Rejection reason (untracked), `undefined` unless the promise rejected. */
  error: unknown;

  constructor(initialPromise: Promise<T>) {
    super(null);
    this._rejected = false;
    this.error = undefined;
    this._source = Promise.resolve(initialPromise);
    this._source.then(
      // a throwing subscriber/effect has no caller here → reportError, not an unhandled rejection
      (v) => guard(() => this._set(v)),
      (e) => {
        this._rejected = true;
        this.error = e;
      },
    );
  }

  /**
   * Resolves with the value: immediately if it is already non-null, otherwise on the
   * first non-null value (promise resolution or a manual `set`). Rejects if the source rejected.
   */
  promise(): Promise<T> {
    const v = this.peek();
    if (v !== null) return Promise.resolve(v);
    if (this._rejected) return Promise.reject(this.error);
    return new Promise<T>((resolve, reject) => {
      const off = this.subscribe((value) => {
        if (value !== null) {
          off();
          resolve(value);
        }
      });
      this._source.then(
        () => {
          // source resolved with `null` itself: settle anyway so callers don't hang
          if (this.peek() === null) {
            off();
            resolve(null as T);
          }
        },
        (e) => {
          off();
          reject(e);
        },
      );
    });
  }
}
