import Benchmark from 'benchmark';

import { Observer, AsyncObserver, ComputeObserver, deepObserver } from '../dist/index.esm.js';

const suite = new Benchmark.Suite();

const observer = new Observer(0);
const unsubscribeObserver = observer.subscribe(()=>{});
suite.add('Observer (Primitive)', () => {
  observer.set(observer.get() + 1);
});


const observerObject = new Observer({ count: 0});
observerObject.subscribe(() => {});
suite.add('Observer (Object)', () => {
  observerObject.set({count: observerObject.get().count + 1});
});


let baseValue = 10;
const computeObserver = new ComputeObserver(() => baseValue * 2);
const callback3 = (newValue, oldValue) => {};
suite.add('ComputeObserver', () => {
  baseValue += 1;
  computeObserver.update();
});


const asyncObs = new AsyncObserver(Promise.resolve(0));
const callback4 = (newValue, oldValue) => {};
suite.add('AsyncObserver', async () => {
  await asyncObs.promise().then((value) => callback4(value + 1, value));
});


const deep = { level1: { level2: { count: 0 } } };
const callback5 = (newValue, oldValue) => {};
const { unsubscribe: unsubscribeDeep } = deepObserver(deep, callback5);
suite.add('deepObserver', () => {
  deep.level1.level2.count += 1;
  // callback5(deep, { level1: { level2: { count: deep.level1.level2.count - 1 } } });
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