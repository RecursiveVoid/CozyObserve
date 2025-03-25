import { Observer } from '../src/core/Observer';
import { AsyncObserver } from '../src/core/AsyncObserver';
import { ComputeObserver } from '../src/core/ComputeObserver';
import { deepObserver } from '../src/core/DeepObserver';

describe('Observer', () => {
  it('should initialize with the correct value', () => {
    const observer = new Observer<number>(10);
    expect(observer.get()).toBe(10);
  });

  it('should notify observers when value changes', () => {
    const observer = new Observer<number>(10);
    const callback = jest.fn();
    observer.subscribe(callback);
    observer.set(20);
    expect(callback).toHaveBeenCalledWith(20, 10);
  });

  it('should not notify observers when value does not change', () => {
    const observer = new Observer<number>(10);
    const callback = jest.fn();
    observer.subscribe(callback);
    observer.set(10);
    expect(callback).not.toHaveBeenCalled();
  });

  it('should unsubscribe correctly', () => {
    const observer = new Observer<number>(10);
    const callback = jest.fn();
    const unsubscribe = observer.subscribe(callback);
    observer.set(20);
    expect(callback).toHaveBeenCalled();
    unsubscribe();
    observer.set(30);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should handle string values', () => {
    const observer = new Observer<string>('hello');
    const callback = jest.fn();
    observer.subscribe(callback);
    observer.set('world');
    expect(callback).toHaveBeenCalledWith('world', 'hello');
  });

  it('should handle array values', () => {
    const observer = new Observer<number[]>([1, 2, 3]);
    const callback = jest.fn();
    observer.subscribe(callback);
    observer.set([1, 2, 3, 4]);
    expect(callback).toHaveBeenCalledWith([1, 2, 3, 4], [1, 2, 3]);
  });

  it('should handle object values', () => {
    const observer = new Observer<{ name: string }>({ name: 'Alice' });
    const callback = jest.fn();
    observer.subscribe(callback);
    observer.set({ name: 'Bob' });
    expect(callback).toHaveBeenCalledWith({ name: 'Bob' }, { name: 'Alice' });
  });
});

describe('AsyncObserver', () => {
  it('should resolve the promise with the correct value after the promise is fulfilled', async () => {
    const asyncObserver = new AsyncObserver(Promise.resolve(10));
    const result = await asyncObserver.promise();
    expect(result).toBe(10);
  });

  it('should resolve the promise with string value after the promise is fulfilled', async () => {
    const asyncObserver = new AsyncObserver(Promise.resolve('hello'));
    const result = await asyncObserver.promise();
    expect(result).toBe('hello');
  });

  it('should resolve the promise with array value after the promise is fulfilled', async () => {
    const asyncObserver = new AsyncObserver(Promise.resolve([1, 2, 3]));
    const result = await asyncObserver.promise();
    expect(result).toEqual([1, 2, 3]);
  });
});

describe('ComputeObserver', () => {
  it('should initialize with the computed value', () => {
    const computeFn = jest.fn(() => 10);
    const computeObserver = new ComputeObserver(computeFn);
    expect(computeObserver.get()).toBe(10);
  });

  it('should update observers when computed value changes', () => {
    const computeFn = jest.fn(() => 10);
    const computeObserver = new ComputeObserver(computeFn);
    const callback = jest.fn();
    computeObserver.subscribe(callback);
    computeFn.mockReturnValueOnce(20);
    computeObserver.update();
    expect(callback).toHaveBeenCalledWith(20, 10);
  });

  it('should not notify observers if computed value does not change', () => {
    const computeFn = jest.fn(() => 10);
    const computeObserver = new ComputeObserver(computeFn);
    const callback = jest.fn();
    computeObserver.subscribe(callback);
    computeObserver.update();
    expect(callback).not.toHaveBeenCalled();
  });

  it('should compute new value for string', () => {
    const computeFn = jest.fn(() => 'hello');
    const computeObserver = new ComputeObserver(computeFn);
    const callback = jest.fn();
    computeObserver.subscribe(callback);
    computeFn.mockReturnValueOnce('world');
    computeObserver.update();
    expect(callback).toHaveBeenCalledWith('world', 'hello');
  });

  it('should compute new value for array', () => {
    const computeFn = jest.fn(() => [1, 2, 3]);
    const computeObserver = new ComputeObserver(computeFn);
    const callback = jest.fn();
    computeObserver.subscribe(callback);
    computeFn.mockReturnValueOnce([4, 5, 6]);
    computeObserver.update();
    expect(callback).toHaveBeenCalledWith([4, 5, 6], [1, 2, 3]);
  });
});

describe('deepObserver', () => {
  it('should track changes to object properties', () => {
    const obj = { name: 'John', age: 30 };
    const callback = jest.fn();
    const { observer, unsubscribe } = deepObserver(obj, callback);
    observer.name = 'Doe';
    expect(callback).toHaveBeenCalledWith(
      { name: 'Doe', age: 30 },
      { name: 'John', age: 30 }
    );
  });

  it('Should Unsubscribe', () => {
    const obj = { name: 'John', age: 30 };
    const callback = jest.fn();
    const { observer, unsubscribe } = deepObserver(obj, callback);
    unsubscribe();
    observer.age = 31;
    expect(callback).toHaveBeenCalledTimes(0);
  });

  it('should track changes to array elements', () => {
    const arr = [1, 2, 3];
    const callback = jest.fn();

    const { observer, unsubscribe } = deepObserver(arr, callback);
    observer[0] = 4;
    expect(callback).toHaveBeenCalledWith([4, 2, 3], [1, 2, 3]);
  });

  it('should track changes to nested object properties', () => {
    const deepObj = { level1: { level2: { count: 0 } } };
    const callback = jest.fn();
    const { observer, unsubscribe } = deepObserver(deepObj, callback);
    observer.level1.level2.count = 1;
    expect(callback).toHaveBeenCalledWith({ count: 1 }, { count: 0 });
  });
});
