![CozyObserve](https://i.imgur.com/RkamfP6.png)

# CozyObserve — Super Fast, Lightweight, Simple Observer

![npm](https://img.shields.io/npm/v/cozyobserve)
[![Build Size](https://img.shields.io/bundlephobia/minzip/cozyobserve?label=bundle%20size)](https://bundlephobia.com/result?p=cozyobserve)
![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
![License](https://img.shields.io/github/license/RecursiveVoid/cozyobserve)
[![Downloads](https://img.shields.io/npm/dt/cozyobserve.svg?style=flat-square)](https://www.npmjs.com/package/cozyobserve)
[![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)]()
[![withlove](https://img.shields.io/badge/made_with-love_<3-ff69b4.svg?style=flat-square)]()
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

**Currently in preview version**

CozyObserve is a lightweight and efficient library for observing changes in objects and primitive values. It provides a simple API to listen to changes and execute callbacks accordingly. **It supports both Vanilla JavaScript and React** with built-in hooks for seamless integration.

## What COZY Stands For

COZY stands for **Compact, On-point, Zero-overhead, Yet-powerful**.

A **fine-tailored** ecosystem of TypeScript libraries designed for your everyday needs—lightweight, efficient, and built to get the job done. No bloat, just pure performance. 🚀

## Installation

You can install CozyObserve using npm:

```sh
npm install cozyobserve
```

Or using yarn:

```sh
yarn add cozyobserve
```

---

# Vanilla JavaScript / TypeScript Usage

### Importing the Library

```ts
import {
  Observer,
  ComputeObserver,
  AsyncObserver,
  deepObserver,
} from 'cozyobserve';
```

### Observing a Primitive Value

```ts
const observer = new Observer(10);
const unsubscribe = observer.subscribe((newValue, oldValue) => {
  console.log(`Value changed from ${oldValue} to ${newValue}`);
});
observer.set(20); // Triggers the callback

// Unsubscribe when no longer needed
unsubscribe();
```

### Observing Computed Values

```ts
const computeObserver = new ComputeObserver(() => Math.random());
const unsubscribeCompute = computeObserver.subscribe((newValue, oldValue) => {
  console.log(`Computed value changed from ${oldValue} to ${newValue}`);
});
computeObserver.update(); // Triggers the callback if value changed
unsubscribeCompute();
```

### Observing an Async Value

```ts
const asyncObserver = new AsyncObserver(
  fetch('/api/data').then((res) => res.json())
);
asyncObserver
  .promise()
  .then((value) => console.log('Async value resolved:', value));
```

### Deep Observing an Object

```ts
const person = { name: 'Alice', age: 25 };
const { observer, unsubscribe } = deepObserver(person, (newValue, oldValue) => {
  console.log('Object changed:', newValue, oldValue);
});

observer.age = 26; // Triggers the callback
unsubscribe(); // Stop observing
```

---

# React Usage

CozyObserve provides built-in React hooks to make state management seamless.

### Importing React Hooks

```tsx
import {
  useObserver,
  useComputeObserver,
  useAsyncObserver,
  useDeepObserver,
  Observe,
} from 'cozyobserve';
```

### Using the <Observe> Component

```tsx
import { Observe, Observer } from 'cozyobserve';

const count = new Observer(0);

function Counter() {
  return (
    <Observe observer={count}>
      {(value) => (
        <div>
          <p>Count: {value}</p>
          <button onClick={() => count.set(value + 1)}>Increment</button>
        </div>
      )}
    </Observe>
  );
}
```

Observe is a React component that listens to an Observer and re-renders its child function when the value changes.

It makes it easy to work with observers declaratively inside React components.

### Observing a Value with `useObserver`

```tsx
import { Observer, useObserver } from 'cozyobserve';

const counter = new Observer(0);

function Counter() {
  const count = useObserver(counter);
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => counter.set(count + 1)}>Increment</button>
    </div>
  );
}
```

### Observing Computed Values with `useComputeObserver`

```tsx
import { ComputeObserver, useComputeObserver } from 'cozyobserve';

const randomValue = new ComputeObserver(() => Math.random());

function RandomDisplay() {
  const value = useComputeObserver(randomValue);
  return (
    <div>
      <p>Random Value: {value}</p>
      <button onClick={() => randomValue.update()}>Recalculate</button>
    </div>
  );
}
```

### Observing Async Data with `useAsyncObserver`

```tsx
import { AsyncObserver, useAsyncObserver } from 'cozyobserve';

const asyncData = new AsyncObserver(
  fetch('/api/data').then((res) => res.json())
);

function AsyncComponent() {
  const data = useAsyncObserver(asyncData);
  return <div>{data ? JSON.stringify(data) : 'Loading...'}</div>;
}
```

### Observing Deep Objects with `useDeepObserver`

```tsx
import { deepObserver, useDeepObserver } from 'cozyobserve';

const person = { name: 'Alice', age: 25 };
const deepObservedPerson = deepObserver(person, (newValue) => {
  console.log('Person updated:', newValue);
});

function PersonComponent() {
  const observedPerson = useDeepObserver(deepObservedPerson);
  return (
    <div>
      <p>Name: {observedPerson.name}</p>
      <p>Age: {observedPerson.age}</p>
      <button onClick={() => (observedPerson.age += 1)}>Increase Age</button>
    </div>
  );
}
```

---

## API Reference

Refer to the API reference in the Vanilla section for method details.

## License

MIT License. See the [LICENSE](LICENSE) file for details.

(Twitter/X: [**@papa_alpha_papa**](https://x.com/papa_alpha_papa)),
(Mastodon: [**@papa_alpha_papa**](https://mastodon.social/@papa_alpha_papa))
(Bluesky: [**@erginturk.bsky.social**](https://bsky.app/profile/erginturk.bsky.social))

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

---

Developed with ❤️ by M. Ergin Turk

Happy coding with CozyObserve! 🚀
