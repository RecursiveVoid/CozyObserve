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

CozyObserve is a lightweight and efficient library for observing changes in objects and primitive values. It provides a simple API to listen to changes and execute callbacks accordingly.

## Installation

You can install CozyObserve using npm:

```sh
npm install cozyobserve
```

Or using yarn:

```sh
yarn add cozyobserve
```

## Usage

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

## Benchmark Results

| Library                                |     ops/sec | Variability (%) | Runs Sampled |
| -------------------------------------- | ----------: | --------------: | -----------: |
| **CozyObserve - Observer (Primitive)** | 116,142,307 |          ±1.61% |           86 |
| **CozyObserve - ComputeObserver**      |  88,936,510 |          ±3.11% |           84 |
| **CozyObserve - Observer (Object)**    |  43,478,915 |          ±2.79% |           93 |
| **Zustand**                            |   8,175,686 |          ±6.36% |           72 |
| **RxJS**                               |   7,215,093 |         ±10.18% |           61 |
| **MobX**                               |   1,019,549 |         ±53.11% |           36 |

## API Reference

### `Observer<T>`

- `new Observer(initialValue: T)`: Creates a new observer instance.
- `.subscribe(callback: (newValue, oldValue) => void): () => void`: Subscribes to changes and returns an unsubscribe function.
- `.set(newValue: T)`: Updates the value and notifies subscribers.
- `.get(): T`: Returns the current value.

### `ComputeObserver<T>`

- `new ComputeObserver(() => T)`: Observes a computed value.
- `.subscribe(callback: (newValue, oldValue) => void): () => void`: Subscribes to changes and returns an unsubscribe function.
- `.update()`: Forces recomputation and notifies if value changed.
- `.get(): T`: Returns the last computed value.

### `AsyncObserver<T>`

- `new AsyncObserver(promise: Promise<T>)`: Observes an async value.
- `.promise(): Promise<T | null>`: Resolves when the async value is available.

### `deepObserver<T>(obj: T, callback: (newValue, oldValue) => void)`

- Observes deep changes in an object.
- Returns `{ observer: T, unsubscribe: () => void }`.

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
