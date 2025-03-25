export interface ObserverSubscription<T> {
  observer: T;
  unsubscribe: () => void;
}
