import Benchmark from 'benchmark';
import { makeAutoObservable } from 'mobx';
import { BehaviorSubject } from 'rxjs';
import { create } from 'zustand';

import {
  Observer,
  AsyncObserver,
  ComputeObserver,
  deepObserver,
} from '../dist/index.esm.js';

const suite = new Benchmark.Suite();

const observer = new Observer(1);
const unsubscribeObserver = observer.subscribe(() => {});
suite.add('CozyObserve - Observer (Primitive)', () => {
  observer.set(observer.get() + 1);
});

const observerObject = new Observer({ count: 1 });
observerObject.subscribe(() => {});
suite.add('CozyObserve - Observer (Object)', () => {
  observerObject.set({ count: observerObject.get().count + 1 });
});

let baseValue = 10;
const computeObserver = new ComputeObserver(() => baseValue * 2);
suite.add('CozyObserve - ComputeObserver', () => {
  baseValue += 1;
  computeObserver.update();
});

const asyncObs = new AsyncObserver(Promise.resolve(0));
const callback4 = (newValue, oldValue) => {};
suite.add('CozyObserve - AsyncObserver', async () => {
  await asyncObs.promise().then((value) => callback4(value + 1, value));
});

const deep = { level1: { level2: { count: 1 } } };
let { observer: proxy, unsubscribe: unsubscribeDeep } = deepObserver(
  deep,
  () => {}
);
suite.add('CozyObserve - deepObserver', () => {
  proxy.level1.level2.count += 1;
});

class MobxStore {
  count = 1;
  constructor() {
    makeAutoObservable(this);
  }
  increment() {
    this.count++;
  }
}
const mobxStore = new MobxStore();
suite.add('MobX', () => {
  mobxStore.increment();
});

const rxjsSubject = new BehaviorSubject(1);
suite.add('RxJS', () => {
  rxjsSubject.next(rxjsSubject.getValue() + 1);
});

const useStore = create((set) => ({
  count: 1,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));
const zustandStore = useStore.getState();
suite.add('Zustand', () => {
  zustandStore.increment();
});

const subscription = rxjsSubject.subscribe(() => {});
suite.add('RxJS', () => {
  rxjsSubject.next(rxjsSubject.getValue() + 1);
});

suite
  .on('cycle', (event) => {
    console.log(String(event.target.name + ' 🟢🔵🔴'));
  })
  .on('complete', function () {
    console.log('\n');
    const results = this.sort((a, b) => a.stats.mean - b.stats.mean);
    console.log('Benchmark results (fastest to slowest):\n');
    results.forEach((result) => {
      console.log(`${result}`);
    });
  })
  .run({ async: true });

unsubscribeDeep();
unsubscribeObserver();
subscription.unsubscribe();
