# Migrating from 0.2.x to 1.0

v1 keeps the 0.2.x names (`Observer`, `ComputeObserver`, `AsyncObserver`, `deepObserver`,
`useObserver`, `Observe`, `useComputeObserver`, `useAsyncObserver`, `useDeepObserver`,
`ObserverCallback`, `ObserverSubscription`). Most code keeps working after you change the
React imports. This guide lists everything that behaves differently, then shows the
recommended v1 API for each old one.

## Checklist

1. Import React hooks and `<Observe>` from `cozyobserve/react`.
2. Find `set(someFunction)` calls that store a function value and wrap them: `set(() => someFunction)`.
3. Update `deepObserver` callbacks: they now get root snapshots, once per batch.
4. Don't rely on the return value of the unsubscribe function.
5. Check code that depends on `NaN` or `-0` notifications.
6. Handle rejections from `AsyncObserver.promise()`.

## Breaking changes

### 1. React imports move to `cozyobserve/react`

The main entry no longer imports React, so non-React projects don't pull it in.

```diff
- import { Observer, useObserver, Observe } from 'cozyobserve';
+ import { Observer } from 'cozyobserve';
+ import { useObserver, Observe } from 'cozyobserve/react';
```

Your TypeScript `moduleResolution` must understand `exports` (`bundler`, `node16` or
`nodenext`) for the subpath to resolve.

### 2. `set(fn)` is an updater

A function passed to `set` is now called with the previous value, and its result is stored.

```ts
const count = new Observer(1);
count.set((n) => n + 1); // 2 (in 0.2.x this stored the function itself)
```

To store a function as the value, wrap it:

```diff
  const onSave = new Observer<() => void>(() => {});
- onSave.set(handleSave);
+ onSave.set(() => handleSave);
```

### 3. `deepObserver` callbacks get `(nextSnapshot, prevSnapshot)` once per batch

In 0.2.x the callback ran on **every property write** with `(target, structuredClone(target before the write))`,
where `target` was the nested object that was written to (not the root), and it was the live,
mutable object.

In 1.0 the callback gets **frozen snapshots of the root object**: the new state and the
previous one. Writes inside `batch()`, and each array method call such as `push` or `splice`,
produce a single call.

```ts
const { observer, unsubscribe } = deepObserver(
  { user: { name: 'Alice', age: 25 }, tags: [] as string[] },
  (next, prev) => {
    // 0.2.x: (user object, clone of user object) on each write
    // 1.0:   root snapshots
    console.log(prev.user.age, '→', next.user.age);
  },
);

observer.user.age = 26; // logs "25 → 26"
observer.tags.push('a', 'b'); // one call
```

- Snapshots are frozen. Mutate `observer`, not the snapshot.
- Unchanged subtrees keep their identity: `next.tags === prev.tags` when only `user` changed.
  You can compare branches by reference to see what changed.
- `observer.user === observer.user` now holds (proxies are cached). In 0.2.x every read
  created a new proxy.
- `unsubscribe()` really unsubscribes (0.2.x replaced the callback with a no-op).

### 4. `subscribe` returns a `void` unsubscribe

`subscribe()` returns `() => void`. In 0.2.x the returned function returned the `boolean`
from `Set.delete`. If you checked that result, drop the check. Calling unsubscribe more than
once is harmless.

Subscribing the same function twice now creates two independent subscriptions (0.2.x used a
`Set`, so the second one was ignored).

### 5. Equality is `Object.is`

0.2.x compared with `!==`. v1 uses `Object.is`, which differs in two cases:

| Write | 0.2.x | 1.0 |
|---|---|---|
| `NaN` → `NaN` | notified on every write | no-op |
| `0` → `-0` | no-op | notifies |

For custom equality, use the core API: `observable(v, { equals })`, or `{ equals: false }` to
notify on every write.

### 6. `AsyncObserver.promise()` settles reliably

- It resolves **immediately** if the value has already resolved (0.2.x hung forever).
- It **rejects** when the source promise rejects (0.2.x never settled and also caused an
  unhandled rejection). Add a `catch` or `try/await` where you call it.
- The rejection reason is also available as `asyncObserver.error`.
- The return type is `Promise<T>` instead of `Promise<T | null>`.

## Other behaviour changes (usually no action needed)

- `Observer` is the core observable class, so `observable(x) instanceof Observer` is true
  and every `Observer` also has `.value`, `peek()`, `update()`, and is auto-tracked by
  `computed`, `effect` and `tracked()`.
- `ComputeObserver` now auto-tracks observables its function reads and updates by itself.
  `update()` still works, for inputs that are not observables. It still evaluates eagerly on
  construction like 0.2.x.
- `useObserver` and the other hooks use `useSyncExternalStore`: no tearing, no missed
  updates between render and subscription. `useObserver` accepts any observable or computed.
- `useDeepObserver(sub)` works now (it threw in 0.2.x) and returns a frozen snapshot. Write
  through `sub.observer`, not through the returned snapshot.
- `<Observe observer={o}>` also tracks other observables read inside its children.

## Recommended v1 equivalents

The compat API is fine to keep. For new code, these are the v1 primitives:

| 0.2.x | v1 |
|---|---|
| `new Observer(v)` | `observable(v)` |
| `o.get()` / `o.set(v)` | `o.value` / `o.value = v` (or keep `get`/`set`) |
| `new ComputeObserver(fn)` + `update()` | `computed(fn)`, no `update()` needed |
| `o.subscribe(cb)` | `o.subscribe(cb)`, or `effect(() => …)` / `watch(getter, cb)` |
| `new AsyncObserver(promise)` | `resource(promise)` or `resource(async ({ signal }) => …)` |
| `asyncObserver.promise()` | `res.promise()` |
| `deepObserver(obj, cb)` | `const s = store(obj)` + `subscribeStore(s, cb)`, or an `effect` reading the fields you need |
| `useObserver(o)` | `useObserver(o)`, `useObserver(o, selector)` or `useObserver(() => …)` |
| `useComputeObserver(c)` | `useObserver(c)` or `useObserver(() => …)` |
| `useAsyncObserver(a)` | `useResource(res)`: `{ value, error, status, loading, refresh }` |
| `useDeepObserver(d)` | `useStore(s)`, `useStore(s, selector)`, or read the store in a `tracked()` component |
| `<Observe observer={o}>{(v) => …}</Observe>` | `<Observe>{() => … o.value …}</Observe>` |

### Before / after

```tsx
// 0.2.x
import { Observer, ComputeObserver, AsyncObserver, useObserver, useAsyncObserver } from 'cozyobserve';

const items = new Observer<Item[]>([]);
const total = new ComputeObserver(() => items.get().reduce((s, i) => s + i.price, 0));
items.subscribe(() => total.update()); // manual wiring

const profile = new AsyncObserver(fetch('/api/me').then((r) => r.json()));

function Cart() {
  const sum = useObserver(total);
  const me = useAsyncObserver(profile);
  return <p>{me ? me.name : 'Loading…'}: {sum}</p>;
}
```

```tsx
// 1.0
import { observable, computed, resource } from 'cozyobserve';
import { useObserver, useResource } from 'cozyobserve/react';

const items = observable<Item[]>([]);
const total = computed(() => items.value.reduce((s, i) => s + i.price, 0)); // auto-tracked

const profile = resource(async ({ signal }) => (await fetch('/api/me', { signal })).json());

function Cart() {
  const sum = useObserver(total);
  const { value: me, error } = useResource(profile);
  if (error) return <p>Could not load profile</p>;
  return <p>{me ? me.name : 'Loading…'}: {sum}</p>;
}
```
