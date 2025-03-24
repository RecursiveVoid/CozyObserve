![](https://i.imgur.com/RkamfP6.png)

# CozyObserve — Fast, Lightweight, Simple Observer

![npm](https://img.shields.io/npm/v/cozyobserve)
[![Build Size](https://img.shields.io/bundlephobia/minzip/cozyobserve?label=bundle%20size)](https://bundlephobia.com/result?p=cozyobserve)
![Coverage](https://img.shields.io/badge/coverage-74%25-yellow)
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
import { CozyObserve } from 'CozyObserve';
```

### Observing an Object

```ts
const person = { name: 'John', age: 30 };
const observedPerson = CozyObserve.observe({
  target: person,
  callback: (newValue, oldValue) => {
    console.log('Person changed:', newValue, oldValue);
  },
  async: true, // Optional
});

observedPerson.age = 31; // Triggers the callback
```

### Observing a Primitive Value

```ts
const observedNumber = CozyObserve.observe({
  target: 10,
  callback: (newValue, oldValue) => {
    console.log('Value changed from', oldValue, 'to', newValue);
  },
});

observedNumber.value = 20; // Triggers the callback
```

### Removing Observers

#### Stop Observing a Specific Object

```ts
CozyObserve.unobserve(observedPerson);
```

#### Stop Observing a Specific Primitive

```ts
CozyObserve.unobserve(observedNumber);
```

You can also remove a certain callback instead the while object/primitive.

```ts
CozyObserve.unobserve(observedThingy, specificCallback); // Will only remove that specificCallback instead the whole observable
```

#### Remove All Observers

```ts
CozyObserve.removeAllObservers();
```

## API Reference

### `observe<T>(options: ObserveOptions<T>): T`

Observes an object or primitive and executes the callback when changes occur.

#### Parameters:

- `target`: The object or primitive to observe.
- `callback`: Function executed when the value changes.
- `async` (optional): If `true`, executes the callback asynchronously.

#### Returns:

- A proxy object (for objects) or an observable wrapper (for primitives).

### `unobserve<T>(target: T, callback?: Callback<T>): void`

Stops observing an object or primitive.

### `removeAllObservers(): void`

Removes all observers from all objects and primitives.

## License

Copyright (c) 2025 Mehmet Ergin Turk

Licensed under the MIT license. See the [LICENSE](LICENSE) file for details.

(Twitter/x: [**@papa_alpha_papa**](https://x.com/papa_alpha_papa)),

(Mastodon: [**@papa_alpha_papa**](https://mastodon.social/@papa_alpha_papa))

(Bluesky: [**@erginturk.bsky.social**](https://bsky.app/profile/erginturk.bsky.social))

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

---

Developed with ❤️ by M.Ergin Turk

Happy coding with CozyObserve! 🚀
