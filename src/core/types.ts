export type Unsubscribe = () => void;
export type Equals<T> = (a: T, b: T) => boolean;

export interface ReadonlyObservable<T> {
  /** Tracked read. */
  readonly value: T;
  /** Tracked read (same as `.value`). */
  get(): T;
  /** Untracked read. */
  peek(): T;
  subscribe(cb: (value: T, prev: T) => void, options?: { immediate?: boolean }): Unsubscribe;
}

export interface Observable<T> extends ReadonlyObservable<T> {
  value: T;
  /** Function form is an updater. To store a function value, wrap: `set(() => fn)`. */
  set(next: T | ((prev: T) => T)): void;
  update(fn: (prev: T) => T): void;
}
