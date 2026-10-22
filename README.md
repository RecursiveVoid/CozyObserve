![CozyObserve](https://i.imgur.com/RkamfP6.png)

# CozyObserve

![npm](https://img.shields.io/npm/v/cozyobserve)
[![Build Size](https://img.shields.io/bundlephobia/minzip/cozyobserve?label=bundle%20size)](https://bundlephobia.com/result?p=cozyobserve)
![License](https://img.shields.io/github/license/RecursiveVoid/cozyobserve)
[![Downloads](https://img.shields.io/npm/dt/cozyobserve.svg?style=flat-square)](https://www.npmjs.com/package/cozyobserve)
[![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)]()
[![withlove](https://img.shields.io/badge/made_with-love_<3-ff69b4.svg?style=flat-square)]()
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

Fine-grained reactive signals for TypeScript and React. Computed values and effects track
their dependencies automatically, so there are no dependency arrays to maintain and no
manual `update()` calls. On top of the core you get deep reactive stores with immutable
snapshots, async resources that refetch, abort and ignore stale responses on their own, and
React hooks built on `useSyncExternalStore`. It is small (about 1.7 kB for the core
primitives) and has zero dependencies.

> **v1 is in beta** (`1.0.0-beta.0`). Coming from 0.2.x? See [MIGRATION.md](MIGRATION.md).

## What COZY Stands For

COZY stands for **Compact, On-point, Zero-overhead, Yet-powerful**.

A **fine-tailored** ecosystem of TypeScript libraries designed for your everyday needs—lightweight, efficient, and built to get the job done. No bloat, just pure performance. 🚀

## Contents

- [Install](#install)
- [30-second example](#30-second-example)
- [React in 30 seconds](#react-in-30-seconds)
- [Why not `useEffect`?](#why-not-useeffect)
- [Core API](#core-api)
- [Store](#store)
- [Async resources](#async-resources)
- [React](#react)
- [Compat / 0.2.x API](#compat--02x-api)
- [Bundle size](#bundle-size)
- [Benchmarks](#benchmarks)
- [TypeScript notes](#typescript-notes)
- [License](#license)

## Install

```sh
npm install cozyobserve
# or
yarn add cozyobserve
# or
pnpm add cozyobserve
```

React bindings live in `cozyobserve/react` and need `react >= 18` (an optional peer dependency).
The main `cozyobserve` entry never imports React.

## 30-second example

```ts
import { observable, computed, effect, batch } from 'cozyobserve';

const first = observable('Ada');
const last = observable('Lovelace');
const full = computed(() => `${first.value} ${last.value}`);

const stop = effect(() => {
  console.log(full.value);
}); // logs "Ada Lovelace"

first.value = 'Grace'; // logs "Grace Lovelace"

batch(() => {
  first.set('Alan');
  last.set('Turing');
}); // logs "Alan Turing" once

stop(); // no more logs
```

`full` knows it depends on `first` and `last` because it read them. Nothing was declared.

## React in 30 seconds

```tsx
import { observable, computed } from 'cozyobserve';
import { useObserver, tracked } from 'cozyobserve/react';

const count = observable(0);
const doubled = computed(() => count.value * 2);

function Counter() {
  const n = useObserver(count);
  return <button onClick={() => count.update((c) => c + 1)}>Clicked {n} times</button>;
}

// tracked(): every observable read during render is a dependency
const Doubled = tracked(() => <p>Doubled: {doubled.value}</p>);
```

State lives outside components, so any component (or plain code) can read and write it.
Only the components that read a value re-render when it changes.

## Why not `useEffect`?

`useEffect` is a sync-with-the-outside-world tool, but it often gets used for data fetching,
derived state and subscriptions. Each of those needs a hand-written dependency array, and
each has a bug you have to remember to avoid. Here is what the same three jobs look like with
CozyObserve.

### Fetching data

**Before:** `useState` + `useEffect`.

```tsx
function Profile({ id }: { id: number }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchUser(id).then((u) => {
      setUser(u); // 🐛 if `id` changed meanwhile, a slow response for the OLD id can land last
      setLoading(false);
    });
  }, [id]); // 🐛 forget `id` here and the component shows stale data

  if (!user) return <p>Loading…</p>;
  return <h1 style={{ opacity: loading ? 0.5 : 1 }}>{user.name}</h1>;
}
```

Fixing it properly means an `AbortController` or an `ignore` flag in a cleanup function,
plus an error state, in every component that fetches.

**After:** `resource` + `useResource`.

```tsx
import { observable, resource } from 'cozyobserve';
import { useResource } from 'cozyobserve/react';

const userId = observable(1);

const user = resource(async ({ signal }) => {
  const id = userId.value; // tracked: read before the first `await`
  return fetchUser(id, signal);
});

function Profile() {
  const { value, loading, error } = useResource(user);
  if (error) return <p>Failed to load</p>;
  if (!value) return <p>Loading…</p>;
  return <h1 style={{ opacity: loading ? 0.5 : 1 }}>{value.name}</h1>;
}

userId.set(2); // aborts the request for 1, fetches 2; a late answer for 1 is ignored
```

The resource refetches when `userId` changes because the fetcher read it. Starting a new
fetch aborts the previous `signal`, and only the latest request can set the value.

### Derived state

**Before:** `useMemo` with a dependency array.

```tsx
const visible = useMemo(
  () => todos.filter((t) => filter === 'all' || t.done === (filter === 'done')),
  [todos, filter], // must list every input by hand
);
```

**After:** a getter passed to `useObserver`.

```tsx
const todos = observable<Todo[]>([]);
const filter = observable<'all' | 'done' | 'open'>('all');

function TodoList() {
  const visible = useObserver(() =>
    todos.value.filter((t) => filter.value === 'all' || t.done === (filter.value === 'done')),
  );
  return <ul>{visible.map((t) => <li key={t.title}>{t.title}</li>)}</ul>;
}
```

The getter tracks what it reads. It re-renders the component only when the result changes.

### Subscriptions

**Before:** subscribe in an effect, copy into state, unsubscribe in cleanup.

```tsx
function Status() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return <span>{online ? 'Online' : 'Offline'}</span>;
}
```

**After:** keep the value in an observable once; components just read it.

```tsx
const online = observable(navigator.onLine);
window.addEventListener('online', () => online.set(true));
window.addEventListener('offline', () => online.set(false));

const Status = tracked(() => <span>{online.value ? 'Online' : 'Offline'}</span>);
```

No state copy, no cleanup, and no window between render and subscribe where an update can
be missed (the hooks use `useSyncExternalStore`).

## Core API

```ts
import {
  observable, computed, effect, batch, untracked, watch, onCleanup, isObservable,
} from 'cozyobserve';
```

### `observable(initial, options?)`

```ts
const count = observable(0);

count.value; // 0, tracked read
count.get(); // 0, same as .value
count.peek(); // 0, untracked read (never registers a dependency)

count.value = 1;
count.set(2);
count.set((n) => n + 1); // a function is an updater → 3
count.update((n) => n * 2); // explicit updater → 6

// To store a function as the value, wrap it:
const handler = observable<() => void>(() => {});
handler.set(() => () => console.log('hi'));
```

Setting an equal value is a no-op. Equality is `Object.is` by default; pass your own, or
`false` to notify on every write:

```ts
const pos = observable({ x: 0, y: 0 }, { equals: (a, b) => a.x === b.x && a.y === b.y });
pos.set({ x: 0, y: 0 }); // no-op

const tick = observable(0, { equals: false });
tick.set(0); // notifies anyway
```

### `subscribe(cb, { immediate? })` and `peek()`

Every observable and computed has `subscribe`. The callback gets `(value, prev)` after each
change (after the outermost batch). It returns an `Unsubscribe` function.

```ts
const off = count.subscribe((value, prev) => console.log(prev, '→', value));
count.set(7); // logs "6 → 7"
off();

count.subscribe((v) => console.log('now', v), { immediate: true }); // logs "now 7" right away
```

Unsubscribing from inside a callback is safe. Subscribing to a computed keeps it live
(eagerly updated) until its last subscriber leaves.

### `computed(fn, options?)`

```ts
const price = observable(10);
const qty = observable(3);
const total = computed(() => price.value * qty.value);

total.value; // 30
```

- **Lazy and cached.** `fn` does not run until the first read, and reading again without
  changes does not re-run it. An unobserved computed holds no subscriptions, so it can be
  garbage-collected.
- **Dynamic dependencies.** Dependencies are re-collected on every run; a branch that was not
  taken is not a dependency.
- **Glitch-free.** In a diamond (`a → b`, `a → c`, `b + c → d`), setting `a` runs `d` once
  with consistent values.
- **Equality cutoff.** If a computed recomputes to an equal value, nothing downstream runs.
- **Previous value.** `fn` receives the previous value: `computed<number>((prev) => Math.max(prev ?? 0, price.value))`.
- **Errors** thrown in `fn` are cached and re-thrown on read until a dependency changes.
- Writing to an observable inside a computed throws `Cannot write inside computed`
  (use `untracked()` if you really need to). Reading itself throws a `Cycle detected` error.

### `effect(fn)`

Runs `fn` now, then again whenever something it read changes. Returns a dispose function.

```ts
const intervalMs = observable(1000);

const stop = effect(() => {
  const id = setInterval(() => console.log('tick'), intervalMs.value);
  return () => clearInterval(id); // cleanup: before the next run and on dispose
});

intervalMs.set(500); // clears the old interval, starts a new one
stop();
```

- Re-runs are synchronous, after the outermost `batch` ends.
- An effect created inside another effect is owned by it: it is disposed when the parent
  re-runs or is disposed. (`subscribe`, `watch` and `resource` created inside an effect are
  **not** owned; keep their dispose functions yourself.)
- An error in one effect does not stop other effects in the same flush; the first error is
  re-thrown afterwards. An effect that throws keeps its dependencies and re-runs on the next
  change.
- An effect that keeps writing a value it reads throws `Cycle detected` after 100 re-runs
  in one flush instead of hanging.

### `onCleanup(fn)`

Registers a cleanup for the effect that is currently running. Useful from helper functions
called inside an effect. Outside an effect it does nothing. Order: `onCleanup` callbacks in
registration order, then the function returned by the effect.

```ts
effect(() => {
  const ws = new WebSocket(url.value);
  onCleanup(() => ws.close());
});
```

### `batch(fn)`

Groups writes so effects and subscribers run once, at the end. Batches nest; `batch`
returns whatever `fn` returns. Reads inside the batch already see the new values.

```ts
const total = batch(() => {
  a.set(10);
  b.set(20);
  return a.value + b.value; // 30
}); // effects that read a and b run once, here
```

### `untracked(fn)`

Reads inside `fn` do not become dependencies.

```ts
effect(() => {
  // re-runs when `user` changes, not when `theme` changes
  console.log(user.value, untracked(() => theme.value));
});
```

### `watch(source, cb, options?)`

Like `subscribe`, but the source can be a getter (auto-tracked selector), and `cb` gets an
`onCleanup` for per-call cleanup. `cb` only fires when the selected value changes.

```ts
const user = observable({ id: 1, name: 'Ada' });

const off = watch(
  () => user.value.id,
  (id, prevId, onCleanup) => {
    const ctrl = new AbortController();
    loadPermissions(id, ctrl.signal);
    onCleanup(() => ctrl.abort()); // runs before the next call and on unsubscribe
  },
);

user.set({ id: 1, name: 'Ada L.' }); // id unchanged → no call
user.set({ id: 2, name: 'Grace' }); // cb(2, 1, onCleanup)
```

Options: `immediate` (call now; `prev` is `undefined` the first time), `equals` (custom
comparison for the selected value), `once` (unsubscribe after the first call; the immediate
call counts).

### `isObservable(x)`

`true` for anything created by `observable`, `computed` or the compat classes.

## Store

Deep reactive objects, tracked per property.

```ts
import { store, snapshot, subscribeStore, toRaw, isStore, effect } from 'cozyobserve';

const state = store({
  user: { name: 'Ada', tags: ['math'] },
  todos: [{ title: 'Write docs', done: false }],
});

effect(() => {
  console.log(state.user.name); // re-runs only when user.name (or user) changes
});

state.todos[0].done = true; // the effect above does not re-run
state.user.name = 'Grace'; // logs "Grace"
state.todos.push({ title: 'Ship', done: false }); // one notification per array method call
state.user = { name: 'Alan', tags: [] }; // replacing a parent re-runs readers of user.name → logs "Alan"
```

- Reads of `in`, `Object.keys`, `for...in` and array iteration/`length` are tracked too, so
  adding or removing keys re-runs them.
- Proxies are created lazily and cached: `state.user === state.user`.
- Assigning the same value is a no-op. Assigning a store proxy stores its raw object.

### `snapshot(s)`

A frozen plain copy of the current state, with structural sharing: unchanged subtrees keep
the same reference, and calling it twice with no changes returns the identical object. This
is what the React hooks render from.

```ts
const a = snapshot(state);
state.todos[0].done = false;
const b = snapshot(state);

a === b; // false
a.user === b.user; // true, unchanged subtree
Object.isFrozen(b); // true
```

Inside an effect or computed, `snapshot(s)` tracks the whole tree.

### `subscribeStore(s, cb)`

Deep subscription. `cb(nextSnapshot, prevSnapshot)` runs once per batch.

```ts
const off = subscribeStore(state, (next, prev) => {
  console.log(prev.user.name, '→', next.user.name);
});

batch(() => {
  state.user.name = 'Grace';
  state.todos.push({ title: 'Review', done: false });
}); // one call
```

### `toRaw(s)` and `isStore(x)`

`toRaw` returns the plain object behind a store proxy (non-store values pass through).
`isStore` tells you whether a value is a store proxy.

### Limitations

- **`store()` wraps the object you pass; it does not copy it.** Writes through the proxy
  change the original object. Writing to the raw object directly (`toRaw(s).x = 1`) is not
  reactive.
- **Only plain objects and arrays are deep-reactive.** `Map`, `Set`, `Date`, class instances,
  promises and frozen objects are stored as plain values: `state.tags.add('x')` on a `Set`
  does not notify. Replace the value instead: `state.tags = new Set([...state.tags, 'x'])`.
- Symbol keys are not tracked, and snapshots copy own enumerable string keys only.

## Async resources

`resource` turns an async function into reactive state:
`status` (`'idle' | 'loading' | 'success' | 'error'`), `value`, `error` and `loading`.
All of them are tracked, so effects, computeds and components react to them.

```ts
import { observable, resource } from 'cozyobserve';

const userId = observable(1);

const user = resource(async ({ signal, prev }) => {
  const id = userId.value; // tracked
  const res = await fetch(`/api/users/${id}`, { signal });
  if (!res.ok) throw new Error(res.statusText);
  return (await res.json()) as User;
});

user.status; // 'loading'
await user.promise(); // resolves on the next success, rejects on error
user.value; // the user
```

- **Auto-refetch on dependencies.** Observables read in the synchronous part of the fetcher
  (before the first `await`) are dependencies. Changing `userId` starts a new fetch. Read them
  at the top of the fetcher.
- **Abort.** Each fetch gets an `AbortSignal`. It is aborted when a newer fetch starts, and on
  `abort()`, `mutate()` and `dispose()`. Pass it to `fetch`.
- **Race safety.** Only the latest fetch can write. A stale response is ignored even if it
  resolves after a newer one, and a stale rejection never surfaces as an unhandled rejection.
- **Stale-while-revalidate.** `value` keeps the last successful value while a refetch is
  loading, and `error` is kept until the next success.
- `prev` in the fetcher context is the last successful value.

| Member | What it does |
|---|---|
| `value`, `error`, `status`, `loading` | Tracked reads. |
| `state` | A `ReadonlyObservable<{ status, value, error }>`, with stable identity while nothing changes. |
| `refresh()` | Fetch again now. Returns a promise for this run's value. |
| `mutate(v \| prev => v)` | Set the value locally (optimistic update). Aborts an in-flight fetch; status becomes `'success'`. |
| `abort()` | Abort the in-flight fetch and restore the status it had before loading. |
| `promise()` | Resolves on the next success (now, if already `'success'`); rejects on the next error. |
| `dispose()` | Abort, and stop tracking dependencies. |

Options:

```ts
// lazy: status 'idle', nothing fetched until the first read of .value, refresh() or promise()
const stats = resource(fetchStats, { lazy: true });

// initial: value before the first fetch completes (status is still 'loading' while it runs)
const todos = resource(fetchTodos, { initial: [] as Todo[] });

// a plain promise works too
const config = resource(fetch('/config.json').then((r) => r.json()));
```

## React

```tsx
import {
  useObserver, useObservable, useComputed, useObserverEffect,
  useStore, useResource, tracked, Observe,
} from 'cozyobserve/react';
```

Every hook is built on `useSyncExternalStore`. That means no tearing in concurrent rendering
and no missed updates between render and subscription. They work with React 18 and 19, in
`StrictMode`, and with SSR (the server snapshot is the current value). Tracking scopes from a
render that never commits (StrictMode double render, discarded concurrent renders) are not
subscribed, so they cannot leak.

### `useObserver`: three forms

```tsx
// 1. an observable or computed
const n = useObserver(count);

// 2. a selector: re-render only when the selected slice changes (optional equals)
const name = useObserver(user, (u) => u.name);

// 3. a getter: auto-tracked derived value, no deps array
const full = useObserver(() => `${first.value} ${last.value}`);
```

The getter form without deps always uses the latest closure, so it can read props and state
safely: it is re-evaluated on each render and when what it read changes. If you pass deps
(`useObserver(() => user.value.age * factor, [factor])`), it is memoized per deps like
`useMemo`. Keep the call shape (with or without deps) stable at a call site.

### `useObservable(initial)`

A component-local observable with stable identity. Accepts a lazy initializer like `useState`.

```tsx
function Search() {
  const query = useObservable('');
  return <input value={useObserver(query)} onChange={(e) => query.set(e.target.value)} />;
}
```

### `useComputed(fn, deps?)`

A component-local computed you can pass to children or other hooks. Without deps its identity
is stable for the component's lifetime and it always uses the latest closure. With deps it is
recreated when they change.

```tsx
const shout = useComputed(() => query.value.toUpperCase() + suffix); // `suffix` is a prop
const text = useObserver(shout);
```

### `useObserverEffect(fn)`

An auto-tracked effect with **no deps array**. Runs after mount, re-runs only when observables
it read change (not on every render), always calls the latest `fn`, and cleans up on unmount.

```tsx
useObserverEffect(() => {
  document.title = `${unread.value} unread`;
});

useObserverEffect(() => {
  const ws = new WebSocket(url.value);
  return () => ws.close();
});
```

### `useStore(store, selector?, equals?)`

Renders from a store snapshot. Without a selector it re-renders on any deep change; with one,
only when the selected slice changes. Structural sharing keeps unchanged references stable, so
`memo` children and dependency arrays keep working.

```tsx
const state = store({ user: { name: 'Ada' }, todos: [] as Todo[] });

function Todos() {
  const snap = useStore(state); // DeepReadonly<typeof state>
  return <ul>{snap.todos.map((t) => <li key={t.title}>{t.title}</li>)}</ul>;
}

function UserName() {
  const name = useStore(state, (s) => s.user.name); // re-renders only when the name changes
  return <b>{name}</b>;
}
```

For per-property tracking, read the store directly inside `tracked()` (see below).

### `useResource(resource)`

Returns `{ value, error, status, loading, refresh }`. Counts as a read of `.value`, so it
starts a `lazy` resource on mount.

```tsx
const stats = resource(fetchStats, { lazy: true });

function Stats() {
  const { value, status, refresh } = useResource(stats);
  if (status === 'loading' && !value) return <Spinner />;
  return <button onClick={() => refresh()}>{value?.visits} visits (reload)</button>;
}
```

### `tracked(Component)`

Wraps a component so that every observable, computed, resource or store property read during
render is a dependency. The component re-renders only when one of those changes. The result is
`memo`-wrapped and keeps the original `displayName`.

```tsx
const TodoCount = tracked(function TodoCount() {
  const open = state.todos.filter((t) => !t.done).length; // per-property store tracking
  return <span>{open} open</span>;
});
```

### `<Observe>`

A fine-grained island: only the children function re-renders.

```tsx
<Observe>{() => <span>{count.value}</span>}</Observe>

// 0.2.x form, still supported
<Observe observer={count}>{(value) => <span>{value}</span>}</Observe>
```

## Compat / 0.2.x API

The 0.2.x names still work and are built on the v1 core, so they interoperate with everything
above. React hooks are now imported from `cozyobserve/react`. See [MIGRATION.md](MIGRATION.md)
for the details.

```ts
import { Observer, ComputeObserver, AsyncObserver, deepObserver } from 'cozyobserve';
import { useComputeObserver, useAsyncObserver, useDeepObserver, Observe } from 'cozyobserve/react';

const observer = new Observer(10); // same class as observable(): has .value, peek(), update()...
const off = observer.subscribe((newValue, oldValue) => console.log(oldValue, '→', newValue));
observer.set(20); // logs "10 → 20"
off();

const a = new Observer(2);
const doubled = new ComputeObserver(() => a.get() * 2); // auto-tracks now; update() still works
a.set(5);
doubled.get(); // 10

const data = new AsyncObserver(fetch('/api/data').then((r) => r.json()));
data.get(); // null until resolved
await data.promise(); // resolves now if already resolved, rejects if the promise rejected

const { observer: person, unsubscribe } = deepObserver({ name: 'Alice', age: 25 }, (next, prev) => {
  console.log(prev.age, '→', next.age); // frozen snapshots, once per batch
});
person.age = 26; // logs "25 → 26"
unsubscribe();
```

| 0.2.x | v1 equivalent |
|---|---|
| `new Observer(v)` | `observable(v)` |
| `new ComputeObserver(fn)` + `update()` | `computed(fn)` (auto-tracked) |
| `new AsyncObserver(promise)` | `resource(promise)` or `resource(fetcher)` |
| `deepObserver(obj, cb)` | `store(obj)` + `subscribeStore` / `effect` |
| `useObserver(o)` | `useObserver(o)` from `cozyobserve/react` |
| `useComputeObserver(c)` | `useObserver(c)` |
| `useAsyncObserver(a)` | `useResource(r)` |
| `useDeepObserver(d)` | `useStore(s)` or `tracked()` |

## Bundle size

Measured with `npm run size` ([size-limit](https://github.com/ai/size-limit), minified and
brotlied, with all dependencies; `react` excluded):

| Import | Size |
|---|---|
| `{ observable, computed, effect, batch }` from `cozyobserve` | 1.69 kB |
| everything from `cozyobserve` (core, store, resource, compat) | 4.59 kB |
| `{ useObserver, useObserverEffect, tracked }` from `cozyobserve/react` (incl. core) | 2.23 kB |
| everything from `cozyobserve/react` (incl. the core it uses) | 4 kB |

The package is ESM + CJS, has `sideEffects: false`, and tree-shakes: you pay for what you
import.

## Benchmarks

Node 22, Apple M4, mitata. Average time per operation; lower is better. Numbers move by
±15% between runs, so treat small gaps as ties.

| Scenario | cozyobserve v1 | alien-signals | @preact/signals | MobX | cozyobserve 0.2 |
|---|---|---|---|---|---|
| Batch: 100 writes → 1 effect | **2.26 µs** (fastest) | 2.69 µs | 2.95 µs | 5.67 µs | n/a |
| Create + dispose 1000 signals/effects | 50.9 µs | **48.9 µs** | 63.5 µs | 549 µs | 50.5 µs |
| 1000-deep computed chain, write + read | 38.7 µs | **33.3 µs** | 33.9 µs | 174 µs | 14.8 µs¹ |
| Fan-out: 1 → 1000 computeds → effect | 45.5 µs | 42.4 µs | **39.7 µs** | 143 µs | 14.9 µs¹ |
| Deep object `a.b.count++` + listener | **350 ns** | — | — | 609 ns | 795 ns |
| Same, with 200 sibling items | 384 ns (valtio 369 ns) | — | — | 622 ns | 112 µs |

¹ 0.2.x had no dependency tracking: every derived value had to be recomputed by hand with
`update()`, so it skips the bookkeeping that makes automatic updates possible.

The 7 scenarios and the sanity checks (which confirm every library does the same work) are in
[bench/README.md](bench/README.md).


Run them yourself:

```sh
npm run bench
```

See [bench/README.md](bench/README.md) for the scenarios, the libraries compared and the
sanity checks each case passes before it is measured.

## TypeScript notes

- Written in strict TypeScript; types ship with the package (ESM and CJS `.d.ts`).
  Use TypeScript 5.4 or newer, and a `moduleResolution` that understands `exports`
  (`bundler`, `node16` or `nodenext`) so `cozyobserve/react` resolves.
- Types are inferred from the initial value. Widen when needed:
  `observable<Todo[]>([])`, `observable<string | null>(null)`.
- `Observable<T>` is writable; `ReadonlyObservable<T>` (what `computed` returns) is not.
  Accept `ReadonlyObservable<T>` in functions that only read.
- `computed` with a `prev` argument needs the type spelled out:
  `computed<number>((prev) => (prev ?? 0) + step.value)`.
- `resource` infers `T` from the fetcher's result, but `ctx.prev` is `unknown` unless you
  pass `T` explicitly: `resource<Page>(async ({ prev }) => ...)`.
- `snapshot()` and `useStore()` return `DeepReadonly<T>`, so mutating a snapshot is a type
  error (and snapshots are frozen at runtime).
- Exported types: `Observable`, `ReadonlyObservable`, `Unsubscribe`, `Equals`, `DeepReadonly`,
  `Resource`, `AsyncStatus`, `ResourceState`, `ResourceOptions`, `Fetcher`, `FetcherContext`,
  `ObserverCallback`, `ObserverSubscription`, and `UseResourceResult` from `cozyobserve/react`.
- Runtime needs `Proxy`, `WeakMap` and (for `resource`) `AbortController`. All modern browsers
  and Node 18+ have them.

## License

MIT License. See the [LICENSE](LICENSE) file for details.

(Twitter/X: [**@papa_alpha_papa**](https://x.com/papa_alpha_papa)),
(Mastodon: [**@papa_alpha_papa**](https://mastodon.social/@papa_alpha_papa))
(Bluesky: [**@erginturk.bsky.social**](https://bsky.app/profile/erginturk.bsky.social))

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

```sh
npm test          # vitest
npm run typecheck
npm run size
npm run bench
```

---

Developed with ❤️ by M. Ergin Turk
