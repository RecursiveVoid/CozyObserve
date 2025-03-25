import { Observer } from './Observer';

class AsyncObserver<T> extends Observer<T | null> {
  constructor(initialPromise: Promise<T>) {
    super(null);
    initialPromise.then((value) => this.set(value));
  }

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
