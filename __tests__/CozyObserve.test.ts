import { CozyObserve } from '../src/core/CozyObserve';
import { Callback } from '../src/core/Callback';

describe('CozyObserve', () => {
  let mockCallback: jest.Mock<Callback<any>>;

  beforeEach(() => {
    mockCallback = jest.fn();
  });

  afterEach(() => {
    CozyObserve.removeAllObservers();
  });

  describe('observe', () => {
    it('should observe changes in an object and call the callback', () => {
      const person = { name: 'John', age: 30 };
      const observedPerson = CozyObserve.observe({
        target: person,
        callback: mockCallback,
      });

      observedPerson.age = 31;
      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback).toHaveBeenCalledWith(
        { name: 'John', age: 31 },
        { name: 'John', age: 30 }
      );
    });

    it('should observe changes in a primitive value and call the callback', () => {
      const observedValue = CozyObserve.observe({
        target: 10,
        callback: mockCallback,
      });
      //@ts-ignore
      observedValue.value = 20;
      expect(mockCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback).toHaveBeenCalledWith(20, 10);
    });
  });

  describe('unobserve', () => {
    it('should stop observing changes in an object', () => {
      const person = { name: 'John' };
      const observedPerson = CozyObserve.observe({
        target: person,
        callback: mockCallback,
      });

      observedPerson.name = 'Jane';
      expect(mockCallback).toHaveBeenCalledTimes(1);

      CozyObserve.unobserve(observedPerson);
      observedPerson.name = 'Bob';
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should stop observing changes in a primitive', () => {
      const observedValue = CozyObserve.observe({
        target: 10,
        callback: mockCallback,
      });
      //@ts-ignore
      observedValue.value = 20;
      expect(mockCallback).toHaveBeenCalledTimes(1);

      CozyObserve.unobserve(observedValue);
      //@ts-ignore
      observedValue.value = 30;
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should remove specific callback when provided', () => {
      const person = { name: 'John' };
      const observedPerson = CozyObserve.observe({
        target: person,
        callback: mockCallback,
      });

      observedPerson.name = 'Jane';
      expect(mockCallback).toHaveBeenCalledTimes(1);

      CozyObserve.unobserve(observedPerson, mockCallback);
      observedPerson.name = 'Bob';
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeAllObservers', () => {
    it('should remove all active observers', () => {
      const person = { name: 'John' };
      const observedPerson = CozyObserve.observe({
        target: person,
        callback: mockCallback,
      });

      observedPerson.name = 'Jane';
      expect(mockCallback).toHaveBeenCalledTimes(1);

      CozyObserve.removeAllObservers();
      observedPerson.name = 'Bob';
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('_findAllProxies', () => {
    it('should correctly find proxies for an observed object', () => {
      const person = { name: 'John' };
      const observedPerson = CozyObserve.observe({
        target: person,
        callback: mockCallback,
      });

      const proxies = [...(CozyObserve as any)._findAllProxies(person)];
      expect(proxies.length).toBe(1);
      expect(proxies[0]).toBe(observedPerson);
    });
  });
});
