import Benchmark from 'benchmark';
import { CozyObserve } from './dist/index.esm.js';

const suite = new Benchmark.Suite();

// Setup test data
const observedObject = { name: 'Alice', age: 25 };
const observedPrimitive = 10;

// Sync Object Observation
const syncObservedObj = CozyObserve.observe(observedObject, () => {});
suite.add('Sync Object Observation', () => {
  syncObservedObj.age++;
});

// Async Object Observation
const asyncObservedObj = CozyObserve.observe(
  { name: 'Alice', age: 25 },
  () => {},
  true
);
suite.add(
  'Async Object Observation',
  (deferred) => {
    asyncObservedObj.age++;
    queueMicrotask(() => deferred.resolve());
  },
  { defer: true }
);

// Sync Primitive Observation
const syncObservedPrim = CozyObserve.observe(observedPrimitive, () => {});
suite.add('Sync Primitive Observation', () => {
  syncObservedPrim.value++;
});

// Async Primitive Observation
const asyncObservedPrim = CozyObserve.observe(10, () => {}, true);
suite.add(
  'Async Primitive Observation',
  (deferred) => {
    asyncObservedPrim.value++;
    queueMicrotask(() => deferred.resolve());
  },
  { defer: true }
);

// Run benchmarks
suite
  .on('cycle', (event) => {
    console.log(String(event.target));
  })
  .on('complete', function () {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
  })
  .run({ async: true });
