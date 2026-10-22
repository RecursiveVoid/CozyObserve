# Benchmarks

```sh
npm run bench                         # tsup build, then run every scenario
node bench/index.js                   # run without rebuilding (uses existing dist/)
node bench/index.js "fan-out|batch"   # only cases whose "<group> <name>" matches the regex
BENCH_JSON=bench.json node bench/index.js   # also write ranked averages as JSON
```

Runner: [mitata](https://github.com/evanwashere/mitata). Each case's step returns a value derived from
the work done and it goes through `do_not_optimize`, so V8 cannot remove the work as dead code. The script prints
mitata's normal output and then a ranked table per scenario (average time per op, ops/s, how much slower than the fastest).

The new `cozyobserve` is loaded from `dist/index.js` with a dynamic import. If the build is missing, only legacy and
competitor cases run. Store cases run only when `store` is exported.

## Sanity checks (equal work)

Before a case is benchmarked, its `setup()` runs once and `check()` runs the step a few times and asserts that:

- the subscriber or effect ran **exactly once per write** (or N times where N is the intended amount of work),
- derived values (computed tail, fan-out sum, batch sum, deep counter) are **correct**.

A case that fails is **skipped** and listed under "Skipped cases" with the reason. It never shows up as a fake
fast number. The measured graph is then built again from scratch.

## Libraries

| id | package | primitives used |
|---|---|---|
| cozy | `dist/index.js` (v1) | `observable`, `computed`, `effect`, `batch`, `store`, `subscribeStore` |
| legacy | `cozyobserve-legacy` (0.2.2) | `Observer`, `ComputeObserver` (manual `update()`), `deepObserver` |
| preact | `@preact/signals-core` | `signal`, `computed`, `effect`, `batch` |
| alien | `alien-signals` v3 | `signal()`/`computed()`/`effect()` callables, `startBatch`/`endBatch` |
| mobx | `mobx` | `observable.box`, `computed`, `autorun`, `runInAction`, deep `observable` |
| zustand | `zustand/vanilla` | `createStore`, `setState`, `subscribe` |
| rxjs | `rxjs` | `BehaviorSubject`, `pipe(map)` |
| valtio | `valtio/vanilla` (devDep) | `proxy`, `subscribe(…, notifyInSync=true)`, `snapshot` |

## Scenarios

1. **write + 1 subscriber (primitive).** One source and one listener. Each op writes a new number and the
   listener records it. cozy is measured two ways: `subscribe` (plain callback) and `effect` (auto-tracked, the same
   as preact and alien). This measures the base cost of a write plus a notify.
2. **computed chain (3 levels): write + read.** The graph is `s → a=s*2 → b=a+1 → c=b*3`. Each op writes `s` and
   reads `c`, and nothing observes `c` (lazy pull). legacy has to call `update()` on every ComputeObserver by hand.
   rxjs is push-based through `pipe(map,map,map)`. mobx recomputes unobserved computeds on every read, which is how
   mobx is designed.
3. **fan-out: 1 source → 1000 computeds → 1 effect.** `c_j = s + j`, and one effect sums all 1000. Each op writes `s`
   once, and the effect must run once and see the correct sum. This tests marking and propagation across a wide
   graph and the cost of re-reading many dependencies. legacy emulates it with one subscriber that `update()`s every
   ComputeObserver.
4. **deep chain: 1000 computeds, write + read tail.** `c_0 = s`, `c_k = c_{k-1} + 1`. Each op writes `s` and reads
   the tail (unobserved, lazy re-validation through 1000 levels).
   **4b** is the same chain with an effect on the tail, so the graph is live and propagates eagerly.
5. **batch: 100 writes → 1 effect run.** There are 100 independent sources and one effect reads them all. Each op
   writes all 100 inside a single batch, and the effect must run exactly once. zustand has no batching, so its
   idiomatic equivalent is one `setState` with 100 keys. legacy and rxjs have no batching and are left out.
6. **deep mutation: `obj.level1.level2.count++` + subscriber.** This is a nested plain object. cozy is measured with
   a fine-grained `effect` reading the path and with `subscribeStore` (whole-store snapshots, which the React hooks
   use). legacy `deepObserver` `structuredClone`s the mutated object on every write. valtio is measured with and
   without taking a `snapshot` in the listener.
   **6b** is the same, except `level2` also holds 200 sibling items. This shows the cost of whole-object cloning or
   copying as state grows.
7. **create + dispose: 1000 signals + 1000 effects.** Each op creates 1000 sources, attaches one effect or
   subscription to each, then disposes them all. Effects run once on creation (checked: 1000 runs per op). legacy
   and zustand do not call back on subscribe, so their check uses a write and an unsubscribe instead. rxjs
   `BehaviorSubject` emits on subscribe. cozy is measured both with `effect` and with `subscribe`.

## Caveats

- These are microbenchmarks on one machine and one Node version (printed at the top). Use them for relative ranking
  and to catch regressions, not as absolute numbers.
- legacy often "wins" the primitive and manual-compute scenarios because it does far less: no dependency tracking,
  no glitch-freedom, no laziness, and the user calls `update()` by hand. It is included as the migration baseline.
