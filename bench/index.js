// CozyObserve v1 benchmark suite (mitata).
//
//   npm run bench                 # build + run everything
//   node bench/index.js           # run without rebuilding
//   node bench/index.js fan-out   # only groups/benches whose name matches the regex
//   BENCH_JSON=out.json node bench/index.js   # also dump raw averages as JSON
//
// Every case is sanity-checked before benchmarking: the step function is run a few
// times and we assert that the subscriber/effect actually ran the expected number of
// times and that derived values are correct. Cases that fail the check are skipped
// (and reported) instead of producing a misleading number.

import { bench, group, summary, run, do_not_optimize } from 'mitata';
import { writeFileSync } from 'node:fs';
import * as preact from '@preact/signals-core';
import * as alien from 'alien-signals';
import * as mobx from 'mobx';
import { createStore } from 'zustand/vanilla';
import { BehaviorSubject, map } from 'rxjs';
import * as legacy from 'cozyobserve-legacy';

mobx.configure({ enforceActions: 'never', computedRequiresReaction: false, reactionRequiresObservable: false });

let valtio = null;
try {
  valtio = await import('valtio/vanilla');
} catch {
  /* optional */
}

let cozy = null;
let cozyLoadError = null;
try {
  cozy = await import(new URL('../dist/index.js', import.meta.url).href);
  if (typeof cozy.observable !== 'function' || typeof cozy.effect !== 'function') {
    cozyLoadError = 'dist/index.js lacks observable/effect';
    cozy = null;
  }
} catch (e) {
  cozyLoadError = e && e.message ? e.message.split('\n')[0] : String(e);
}
const hasStore = !!cozy && typeof cozy.store === 'function';

// ---------------------------------------------------------------------------
// helpers

const skipped = [];
const registered = []; // { group, name }

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * Register a bench case.
 * setup() builds the graph and returns { step, check } where:
 *   step()  - the measured operation; must return a value derived from the work.
 *   check() - run after a few warm steps; throws if the library did not do the work.
 * setup is executed eagerly (once for the sanity check, once fresh for the bench).
 */
const filterRe = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
function add(groupName, name, setup) {
  if (filterRe && !filterRe.test(`${groupName} ${name}`)) return;
  try {
    const s = setup();
    s.check();
    if (s.dispose) s.dispose();
  } catch (e) {
    skipped.push({ group: groupName, name, reason: e && e.message ? e.message : String(e) });
    return;
  }
  const s = setup();
  registered.push({ group: groupName, name });
  bench(name, () => do_not_optimize(s.step()));
}

/** Runs step n times and checks the counter moved by exactly n * perStep. */
function expectRuns(step, getCount, n = 5, perStep = 1, label = 'callback') {
  const before = getCount();
  let last;
  for (let i = 0; i < n; i++) last = step();
  const delta = getCount() - before;
  assert(delta === n * perStep, `${label} ran ${delta}x for ${n} steps (expected ${n * perStep})`);
  return last;
}

// ---------------------------------------------------------------------------
// 1. write + 1 subscriber notify (primitive)

const G1 = '1. write + 1 subscriber (primitive)';
group(G1, () => {
  summary(() => {
    if (cozy) {
      add(G1, 'cozy observable.set + subscribe', () => {
        const o = cozy.observable(0);
        let n = 0, seen = 0;
        o.subscribe((v) => { n++; seen = v; });
        let i = 0;
        const step = () => { o.set(++i); return seen; };
        return { step, check: () => { const v = expectRuns(step, () => n); assert(v === i, 'wrong value'); } };
      });
      add(G1, 'cozy observable.value= + effect', () => {
        const o = cozy.observable(0);
        let n = 0, seen = 0;
        cozy.effect(() => { seen = o.value; n++; });
        let i = 0;
        const step = () => { o.value = ++i; return seen; };
        return { step, check: () => { const v = expectRuns(step, () => n); assert(v === i, 'wrong value'); } };
      });
    }
    if (cozy && typeof cozy.Observer === 'function') {
      add(G1, 'cozy compat Observer.set + subscribe', () => {
        const o = new cozy.Observer(0);
        let n = 0, seen = 0;
        o.subscribe((v) => { n++; seen = v; });
        let i = 0;
        const step = () => { o.set(++i); return seen; };
        return { step, check: () => { const v = expectRuns(step, () => n); assert(v === i, 'wrong value'); } };
      });
    }
    add(G1, 'legacy Observer.set + subscribe', () => {
      const o = new legacy.Observer(0);
      let n = 0, seen = 0;
      o.subscribe((v) => { n++; seen = v; });
      let i = 0;
      const step = () => { o.set(++i); return seen; };
      return { step, check: () => { const v = expectRuns(step, () => n); assert(v === i, 'wrong value'); } };
    });
    add(G1, 'preact signal + effect', () => {
      const s = preact.signal(0);
      let n = 0, seen = 0;
      preact.effect(() => { seen = s.value; n++; });
      let i = 0;
      const step = () => { s.value = ++i; return seen; };
      return { step, check: () => { const v = expectRuns(step, () => n); assert(v === i, 'wrong value'); } };
    });
    add(G1, 'alien signal + effect', () => {
      const s = alien.signal(0);
      let n = 0, seen = 0;
      alien.effect(() => { seen = s(); n++; });
      let i = 0;
      const step = () => { s(++i); return seen; };
      return { step, check: () => { const v = expectRuns(step, () => n); assert(v === i, 'wrong value'); } };
    });
    add(G1, 'mobx box + autorun', () => {
      const b = mobx.observable.box(0);
      let n = 0, seen = 0;
      mobx.autorun(() => { seen = b.get(); n++; });
      let i = 0;
      const step = () => { b.set(++i); return seen; };
      return { step, check: () => { const v = expectRuns(step, () => n); assert(v === i, 'wrong value'); } };
    });
    add(G1, 'zustand setState + subscribe', () => {
      const st = createStore(() => ({ count: 0 }));
      let n = 0, seen = 0;
      st.subscribe((s) => { n++; seen = s.count; });
      let i = 0;
      const step = () => { st.setState({ count: ++i }); return seen; };
      return { step, check: () => { const v = expectRuns(step, () => n); assert(v === i, 'wrong value'); } };
    });
    add(G1, 'rxjs BehaviorSubject.next + subscribe', () => {
      const sub = new BehaviorSubject(0);
      let n = 0, seen = 0;
      sub.subscribe((v) => { n++; seen = v; });
      let i = 0;
      const step = () => { sub.next(++i); return seen; };
      return { step, check: () => { const v = expectRuns(step, () => n); assert(v === i, 'wrong value'); } };
    });
  });
});

// ---------------------------------------------------------------------------
// 2. computed chain: write source, read derived (source -> a -> b -> c, no effect, pull)

const G2 = '2. computed chain (3 levels): write + read';
group(G2, () => {
  summary(() => {
    const expect = (v) => (v * 2 + 1) * 3;
    if (cozy) {
      add(G2, 'cozy computed', () => {
        const s = cozy.observable(0);
        const a = cozy.computed(() => s.value * 2);
        const b = cozy.computed(() => a.value + 1);
        const c = cozy.computed(() => b.value * 3);
        let i = 0;
        const step = () => { s.value = ++i; return c.value; };
        return { step, check: () => { for (let k = 0; k < 5; k++) assert(step() === expect(i), 'wrong derived'); } };
      });
    }
    add(G2, 'legacy ComputeObserver (manual update)', () => {
      const s = new legacy.Observer(0);
      const a = new legacy.ComputeObserver(() => s.get() * 2);
      const b = new legacy.ComputeObserver(() => a.get() + 1);
      const c = new legacy.ComputeObserver(() => b.get() * 3);
      let i = 0;
      const step = () => { s.set(++i); a.update(); b.update(); c.update(); return c.get(); };
      return { step, check: () => { for (let k = 0; k < 5; k++) assert(step() === expect(i), 'wrong derived'); } };
    });
    add(G2, 'preact computed', () => {
      const s = preact.signal(0);
      const a = preact.computed(() => s.value * 2);
      const b = preact.computed(() => a.value + 1);
      const c = preact.computed(() => b.value * 3);
      let i = 0;
      const step = () => { s.value = ++i; return c.value; };
      return { step, check: () => { for (let k = 0; k < 5; k++) assert(step() === expect(i), 'wrong derived'); } };
    });
    add(G2, 'alien computed', () => {
      const s = alien.signal(0);
      const a = alien.computed(() => s() * 2);
      const b = alien.computed(() => a() + 1);
      const c = alien.computed(() => b() * 3);
      let i = 0;
      const step = () => { s(++i); return c(); };
      return { step, check: () => { for (let k = 0; k < 5; k++) assert(step() === expect(i), 'wrong derived'); } };
    });
    add(G2, 'mobx computed (unobserved)', () => {
      const s = mobx.observable.box(0);
      const a = mobx.computed(() => s.get() * 2);
      const b = mobx.computed(() => a.get() + 1);
      const c = mobx.computed(() => b.get() * 3);
      let i = 0;
      const step = () => { s.set(++i); return c.get(); };
      return { step, check: () => { for (let k = 0; k < 5; k++) assert(step() === expect(i), 'wrong derived'); } };
    });
    add(G2, 'rxjs BehaviorSubject.pipe(map) (push)', () => {
      const s = new BehaviorSubject(0);
      let last = 0;
      s.pipe(map((v) => v * 2), map((v) => v + 1), map((v) => v * 3)).subscribe((v) => { last = v; });
      let i = 0;
      const step = () => { s.next(++i); return last; };
      return { step, check: () => { for (let k = 0; k < 5; k++) assert(step() === expect(i), 'wrong derived'); } };
    });
  });
});

// ---------------------------------------------------------------------------
// 3. diamond / wide fan-out: 1 source -> 1000 computeds -> 1 effect (sum)

const W = 1000;
const G3 = `3. fan-out: 1 source -> ${W} computeds -> 1 effect`;
group(G3, () => {
  summary(() => {
    const expectSum = (v) => W * v + (W * (W - 1)) / 2;
    const mk = (step, getN, getSum, getI) => ({
      step,
      check: () => { expectRuns(step, getN, 3, 1, 'effect'); assert(getSum() === expectSum(getI()), 'wrong sum'); },
    });
    if (cozy) {
      add(G3, 'cozy', () => {
        const s = cozy.observable(0);
        const cs = [];
        for (let j = 0; j < W; j++) cs.push(cozy.computed(() => s.value + j));
        let n = 0, sum = 0;
        cozy.effect(() => { let t = 0; for (let j = 0; j < W; j++) t += cs[j].value; sum = t; n++; });
        let i = 0;
        return mk(() => { s.value = ++i; return sum; }, () => n, () => sum, () => i);
      });
    }
    add(G3, 'legacy (manual update of each ComputeObserver)', () => {
      const s = new legacy.Observer(0);
      const cs = [];
      for (let j = 0; j < W; j++) cs.push(new legacy.ComputeObserver(() => s.get() + j));
      let n = 0, sum = 0;
      s.subscribe(() => { let t = 0; for (let j = 0; j < W; j++) { cs[j].update(); t += cs[j].get(); } sum = t; n++; });
      let i = 0;
      return mk(() => { s.set(++i); return sum; }, () => n, () => sum, () => i);
    });
    add(G3, 'preact', () => {
      const s = preact.signal(0);
      const cs = [];
      for (let j = 0; j < W; j++) cs.push(preact.computed(() => s.value + j));
      let n = 0, sum = 0;
      preact.effect(() => { let t = 0; for (let j = 0; j < W; j++) t += cs[j].value; sum = t; n++; });
      let i = 0;
      return mk(() => { s.value = ++i; return sum; }, () => n, () => sum, () => i);
    });
    add(G3, 'alien', () => {
      const s = alien.signal(0);
      const cs = [];
      for (let j = 0; j < W; j++) cs.push(alien.computed(() => s() + j));
      let n = 0, sum = 0;
      alien.effect(() => { let t = 0; for (let j = 0; j < W; j++) t += cs[j](); sum = t; n++; });
      let i = 0;
      return mk(() => { s(++i); return sum; }, () => n, () => sum, () => i);
    });
    add(G3, 'mobx', () => {
      const s = mobx.observable.box(0);
      const cs = [];
      for (let j = 0; j < W; j++) cs.push(mobx.computed(() => s.get() + j));
      let n = 0, sum = 0;
      mobx.autorun(() => { let t = 0; for (let j = 0; j < W; j++) t += cs[j].get(); sum = t; n++; });
      let i = 0;
      return mk(() => { s.set(++i); return sum; }, () => n, () => sum, () => i);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. deep chain: 1000-long computed chain, write source then read tail

const D = 1000;
const G4 = `4. deep chain: ${D} computeds, write + read tail (unobserved)`;
const G4b = `4b. deep chain: ${D} computeds, write -> effect at tail`;
function chainCases(observed) {
  const G = observed ? G4b : G4;
  const mk = (step, getI, getN) => ({
    step,
    check: () => {
      if (observed) expectRuns(step, getN, 3, 1, 'effect');
      for (let k = 0; k < 3; k++) assert(step() === getI() + D, 'wrong tail value');
    },
  });
  if (cozy) {
    add(G, 'cozy', () => {
      const s = cozy.observable(0);
      let c = s;
      for (let j = 0; j < D; j++) { const p = c; c = cozy.computed(() => p.value + 1); }
      const tail = c;
      let i = 0, n = 0, seen = 0;
      if (observed) cozy.effect(() => { seen = tail.value; n++; });
      const step = observed ? () => { s.value = ++i; return seen; } : () => { s.value = ++i; return tail.value; };
      return mk(step, () => i, () => n);
    });
  }
  add(G, 'legacy (manual update x1000)', () => {
    const s = new legacy.Observer(0);
    const cs = [];
    let prev = s;
    for (let j = 0; j < D; j++) { const p = prev; prev = new legacy.ComputeObserver(() => p.get() + 1); cs.push(prev); }
    const tail = prev;
    let i = 0, n = 0, seen = 0;
    if (observed) tail.subscribe((v) => { seen = v; n++; });
    const step = () => {
      s.set(++i);
      for (let j = 0; j < D; j++) cs[j].update();
      return observed ? seen : tail.get();
    };
    return mk(step, () => i, () => n);
  });
  add(G, 'preact', () => {
    const s = preact.signal(0);
    let c = s;
    for (let j = 0; j < D; j++) { const p = c; c = preact.computed(() => p.value + 1); }
    const tail = c;
    let i = 0, n = 0, seen = 0;
    if (observed) preact.effect(() => { seen = tail.value; n++; });
    const step = observed ? () => { s.value = ++i; return seen; } : () => { s.value = ++i; return tail.value; };
    return mk(step, () => i, () => n);
  });
  add(G, 'alien', () => {
    const s = alien.signal(0);
    let c = s;
    for (let j = 0; j < D; j++) { const p = c; c = alien.computed(() => p() + 1); }
    const tail = c;
    let i = 0, n = 0, seen = 0;
    if (observed) alien.effect(() => { seen = tail(); n++; });
    const step = observed ? () => { s(++i); return seen; } : () => { s(++i); return tail(); };
    return mk(step, () => i, () => n);
  });
  add(G, 'mobx', () => {
    const s = mobx.observable.box(0);
    let get = () => s.get();
    for (let j = 0; j < D; j++) { const p = get; const c = mobx.computed(() => p() + 1); get = () => c.get(); }
    const tail = get;
    let i = 0, n = 0, seen = 0;
    if (observed) mobx.autorun(() => { seen = tail(); n++; });
    const step = observed ? () => { s.set(++i); return seen; } : () => { s.set(++i); return tail(); };
    return mk(step, () => i, () => n);
  });
}
group(G4, () => summary(() => chainCases(false)));
group(G4b, () => summary(() => chainCases(true)));

// ---------------------------------------------------------------------------
// 5. batch: 100 writes (to 100 different sources) then 1 effect run

const B = 100;
const G5 = `5. batch: ${B} writes -> 1 effect run`;
group(G5, () => {
  summary(() => {
    const expectSum = (i) => B * i + (B * (B - 1)) / 2;
    const mk = (step, getN, getSum, getI) => ({
      step,
      check: () => { expectRuns(step, getN, 3, 1, 'effect'); assert(getSum() === expectSum(getI()), 'wrong sum'); },
    });
    if (cozy) {
      add(G5, 'cozy batch', () => {
        const ss = Array.from({ length: B }, () => cozy.observable(0));
        let n = 0, sum = 0;
        cozy.effect(() => { let t = 0; for (let k = 0; k < B; k++) t += ss[k].value; sum = t; n++; });
        let i = 0;
        const step = () => { i++; cozy.batch(() => { for (let k = 0; k < B; k++) ss[k].value = i + k; }); return sum; };
        return mk(step, () => n, () => sum, () => i);
      });
    }
    add(G5, 'preact batch', () => {
      const ss = Array.from({ length: B }, () => preact.signal(0));
      let n = 0, sum = 0;
      preact.effect(() => { let t = 0; for (let k = 0; k < B; k++) t += ss[k].value; sum = t; n++; });
      let i = 0;
      const step = () => { i++; preact.batch(() => { for (let k = 0; k < B; k++) ss[k].value = i + k; }); return sum; };
      return mk(step, () => n, () => sum, () => i);
    });
    add(G5, 'alien startBatch/endBatch', () => {
      const ss = Array.from({ length: B }, () => alien.signal(0));
      let n = 0, sum = 0;
      alien.effect(() => { let t = 0; for (let k = 0; k < B; k++) t += ss[k](); sum = t; n++; });
      let i = 0;
      const step = () => {
        i++;
        alien.startBatch();
        try { for (let k = 0; k < B; k++) ss[k](i + k); } finally { alien.endBatch(); }
        return sum;
      };
      return mk(step, () => n, () => sum, () => i);
    });
    add(G5, 'mobx runInAction', () => {
      const ss = Array.from({ length: B }, () => mobx.observable.box(0));
      let n = 0, sum = 0;
      mobx.autorun(() => { let t = 0; for (let k = 0; k < B; k++) t += ss[k].get(); sum = t; n++; });
      let i = 0;
      const step = () => { i++; mobx.runInAction(() => { for (let k = 0; k < B; k++) ss[k].set(i + k); }); return sum; };
      return mk(step, () => n, () => sum, () => i);
    });
    add(G5, 'zustand (1 setState of 100 keys)', () => {
      // zustand has no batching; the idiomatic equivalent is one setState with all keys.
      const init = {};
      for (let k = 0; k < B; k++) init['k' + k] = 0;
      const st = createStore(() => init);
      let n = 0, sum = 0;
      st.subscribe((s) => { let t = 0; for (let k = 0; k < B; k++) t += s['k' + k]; sum = t; n++; });
      let i = 0;
      const step = () => { i++; const patch = {}; for (let k = 0; k < B; k++) patch['k' + k] = i + k; st.setState(patch); return sum; };
      return mk(step, () => n, () => sum, () => i);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. deep object mutation: obj.level1.level2.count++ with a subscriber

const G6 = '6. deep mutation: obj.level1.level2.count++ + subscriber';
const G6b = '6b. deep mutation, level2 also holds 200 sibling items';
function deepCases(G6, fresh) {
  {
    const mk = (step, getN, getVal) => ({
      step,
      check: () => { const before = getVal(); expectRuns(step, getN, 5, 1, 'subscriber'); assert(getVal() === before + 5, 'count not incremented'); },
    });
    if (hasStore) {
      add(G6, 'cozy store + effect (fine-grained)', () => {
        const s = cozy.store(fresh());
        let n = 0, seen = 0;
        cozy.effect(() => { seen = s.level1.level2.count; n++; });
        return mk(() => { s.level1.level2.count++; return seen; }, () => n, () => s.level1.level2.count);
      });
      if (typeof cozy.subscribeStore === 'function') {
        add(G6, 'cozy store + subscribeStore (snapshots)', () => {
          const s = cozy.store(fresh());
          let n = 0, seen = 0;
          cozy.subscribeStore(s, (snap) => { seen = snap.level1.level2.count; n++; });
          return mk(() => { s.level1.level2.count++; return seen; }, () => n, () => s.level1.level2.count);
        });
      }
    }
    if (cozy && typeof cozy.deepObserver === 'function') {
      add(G6, 'cozy compat deepObserver', () => {
        let n = 0, seen = 0;
        const { observer } = cozy.deepObserver(fresh(), () => { n++; seen = n; });
        return mk(() => { observer.level1.level2.count++; return seen; }, () => n, () => observer.level1.level2.count);
      });
    }
    add(G6, 'legacy deepObserver', () => {
      let n = 0, seen = 0;
      const { observer } = legacy.deepObserver(fresh(), (o) => { seen = o.count; n++; });
      return mk(() => { observer.level1.level2.count++; return seen; }, () => n, () => observer.level1.level2.count);
    });
    add(G6, 'mobx observable (deep) + autorun', () => {
      const o = mobx.observable(fresh());
      let n = 0, seen = 0;
      mobx.autorun(() => { seen = o.level1.level2.count; n++; });
      return mk(() => { o.level1.level2.count++; return seen; }, () => n, () => o.level1.level2.count);
    });
    if (valtio) {
      add(G6, 'valtio proxy + subscribe (sync)', () => {
        const p = valtio.proxy(fresh());
        let n = 0, seen = 0;
        valtio.subscribe(p, () => { seen = p.level1.level2.count; n++; }, true);
        return mk(() => { p.level1.level2.count++; return seen; }, () => n, () => p.level1.level2.count);
      });
      add(G6, 'valtio proxy + subscribe (sync) + snapshot', () => {
        const p = valtio.proxy(fresh());
        let n = 0, seen = 0;
        valtio.subscribe(p, () => { seen = valtio.snapshot(p).level1.level2.count; n++; }, true);
        return mk(() => { p.level1.level2.count++; return seen; }, () => n, () => p.level1.level2.count);
      });
    }
  }
}
group(G6, () =>
  summary(() =>
    deepCases(G6, () => ({ level1: { level2: { count: 0 }, other: { list: [1, 2, 3], name: 'x' } }, top: 'y' })),
  ),
);
group(G6b, () =>
  summary(() =>
    deepCases(G6b, () => ({
      level1: {
        level2: { count: 0, items: Array.from({ length: 200 }, (_, k) => ({ id: k, label: 'item' + k, tags: ['a', 'b'] })) },
      },
    })),
  ),
);

// ---------------------------------------------------------------------------
// 7. create / dispose: 1000 signals + 1000 effects (each reads its signal), then dispose all

const C = 1000;
const G7 = `7. create ${C} signals + ${C} effects, then dispose`;
group(G7, () => {
  summary(() => {
    // perStep: effects run once on creation (C runs per step). Plain subscribe APIs
    // (legacy, zustand) don't call back on subscribe, so we verify via a write instead.
    const mkEffect = (step, getN) => ({ step, check: () => expectRuns(step, getN, 2, C, 'initial effect') });
    if (cozy) {
      add(G7, 'cozy observable + effect', () => {
        let n = 0;
        const step = () => {
          const ds = new Array(C);
          for (let k = 0; k < C; k++) { const s = cozy.observable(k); ds[k] = cozy.effect(() => { s.value; n++; }); }
          for (let k = 0; k < C; k++) ds[k]();
          return n;
        };
        return mkEffect(step, () => n);
      });
      add(G7, 'cozy observable + subscribe', () => {
        let n = 0;
        const cb = () => { n++; };
        const step = () => {
          const ds = new Array(C);
          for (let k = 0; k < C; k++) { const s = cozy.observable(k); ds[k] = s.subscribe(cb); }
          for (let k = 0; k < C; k++) ds[k]();
          return ds.length;
        };
        return { step, check: () => {
          const s = cozy.observable(0); const u = s.subscribe(cb); s.set(1); u(); s.set(2);
          assert(n === 1, 'subscribe/unsubscribe misbehaves'); step();
        } };
      });
    }
    add(G7, 'legacy Observer + subscribe', () => {
      let n = 0;
      const cb = () => { n++; };
      const step = () => {
        const ds = new Array(C);
        for (let k = 0; k < C; k++) { const s = new legacy.Observer(k); ds[k] = s.subscribe(cb); }
        for (let k = 0; k < C; k++) ds[k]();
        return ds.length;
      };
      return { step, check: () => {
        const s = new legacy.Observer(0); const u = s.subscribe(cb); s.set(1); u(); s.set(2);
        assert(n === 1, 'subscribe/unsubscribe misbehaves'); step();
      } };
    });
    add(G7, 'preact signal + effect', () => {
      let n = 0;
      const step = () => {
        const ds = new Array(C);
        for (let k = 0; k < C; k++) { const s = preact.signal(k); ds[k] = preact.effect(() => { s.value; n++; }); }
        for (let k = 0; k < C; k++) ds[k]();
        return n;
      };
      return mkEffect(step, () => n);
    });
    add(G7, 'alien signal + effect', () => {
      let n = 0;
      const step = () => {
        const ds = new Array(C);
        for (let k = 0; k < C; k++) { const s = alien.signal(k); ds[k] = alien.effect(() => { s(); n++; }); }
        for (let k = 0; k < C; k++) ds[k]();
        return n;
      };
      return mkEffect(step, () => n);
    });
    add(G7, 'mobx box + autorun', () => {
      let n = 0;
      const step = () => {
        const ds = new Array(C);
        for (let k = 0; k < C; k++) { const s = mobx.observable.box(k); ds[k] = mobx.autorun(() => { s.get(); n++; }); }
        for (let k = 0; k < C; k++) ds[k]();
        return n;
      };
      return mkEffect(step, () => n);
    });
    add(G7, 'zustand createStore + subscribe', () => {
      let n = 0;
      const cb = () => { n++; };
      const step = () => {
        const ds = new Array(C);
        for (let k = 0; k < C; k++) { const s = createStore(() => ({ v: k })); ds[k] = s.subscribe(cb); }
        for (let k = 0; k < C; k++) ds[k]();
        return ds.length;
      };
      return { step, check: () => {
        const s = createStore(() => ({ v: 0 })); const u = s.subscribe(cb); s.setState({ v: 1 }); u(); s.setState({ v: 2 });
        assert(n === 1, 'subscribe/unsubscribe misbehaves'); step();
      } };
    });
    add(G7, 'rxjs BehaviorSubject + subscribe', () => {
      let n = 0;
      const cb = () => { n++; };
      const step = () => {
        const ds = new Array(C);
        for (let k = 0; k < C; k++) { const s = new BehaviorSubject(k); ds[k] = s.subscribe(cb); }
        for (let k = 0; k < C; k++) ds[k].unsubscribe();
        return n;
      };
      return mkEffect(step, () => n); // BehaviorSubject emits on subscribe -> C calls per step
    });
  });
});

// ---------------------------------------------------------------------------
// run + report

console.log(`node ${process.version}`);
console.log(cozy ? `new cozyobserve: loaded dist/index.js (store: ${hasStore ? 'yes' : 'no'})` : `new cozyobserve: NOT loaded (${cozyLoadError})`);
console.log(`valtio: ${valtio ? 'yes' : 'not installed'}`);
if (skipped.length) {
  console.log('\nSkipped cases (failed sanity check):');
  for (const s of skipped) console.log(`  - [${s.group}] ${s.name}: ${s.reason}`);
}
console.log('');

const result = await run();

// compact ranking table per group
const fmt = (ns) => (ns >= 1e6 ? `${(ns / 1e6).toFixed(2)} ms` : ns >= 1e3 ? `${(ns / 1e3).toFixed(2)} µs` : `${ns.toFixed(1)} ns`);
const byGroup = new Map();
let ptr = 0; // trials come back in registration order (filtered ones missing)
for (const t of result.benchmarks) {
  const r = t.runs[0];
  while (ptr < registered.length && registered[ptr].name !== t.alias) ptr++;
  const g = ptr < registered.length ? registered[ptr++].group : '?';
  if (!r || !r.stats) continue;
  if (!byGroup.has(g)) byGroup.set(g, []);
  byGroup.get(g).push({ name: t.alias, avg: r.stats.avg });
}
const json = {};
console.log('\n================ SUMMARY (avg time / op, ranked) ================');
for (const [g, rows] of byGroup) {
  rows.sort((a, b) => a.avg - b.avg);
  const best = rows[0].avg;
  console.log(`\n${g}`);
  rows.forEach((r, i) => {
    const ops = 1e9 / r.avg;
    console.log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(48)} ${fmt(r.avg).padStart(10)}  ${(ops >= 1e6 ? (ops / 1e6).toFixed(2) + 'M' : ops >= 1e3 ? (ops / 1e3).toFixed(1) + 'k' : ops.toFixed(0)).padStart(8)} ops/s  ${i === 0 ? '(fastest)' : `${(r.avg / best).toFixed(2)}x slower`}`);
  });
  json[g] = rows;
}
if (process.env.BENCH_JSON) writeFileSync(process.env.BENCH_JSON, JSON.stringify({ node: process.version, skipped, results: json }, null, 2));
