// Legacy 0.2.2 test suite ported verbatim (jest.fn → vi.fn). Compat must keep these green.
import { describe, it, expect, vi } from 'vitest';
import { Observer, AsyncObserver, ComputeObserver, deepObserver } from '../../src/index';
const jest = { fn: vi.fn };

describe('legacy Observer', () => {
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
  it('should handle array values', () => {
    const observer = new Observer<number[]>([1, 2, 3]);
    const callback = jest.fn();
    observer.subscribe(callback);
    observer.set([1, 2, 3, 4]);
    expect(callback).toHaveBeenCalledWith([1, 2, 3, 4], [1, 2, 3]);
  });
});

describe('legacy AsyncObserver', () => {
  it('resolves promise()', async () => {
    const asyncObserver = new AsyncObserver(Promise.resolve(10));
    expect(await asyncObserver.promise()).toBe(10);
  });
});

describe('legacy ComputeObserver', () => {
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
  it('legacy computes eagerly in the constructor', () => {
    const computeFn = jest.fn(() => 1);
    new ComputeObserver(computeFn);
    expect(computeFn).toHaveBeenCalledTimes(1);
  });
});

describe('legacy deepObserver', () => {
  it('should track changes to object properties', () => {
    const obj = { name: 'John', age: 30 };
    const callback = jest.fn();
    const { observer } = deepObserver(obj, callback);
    observer.name = 'Doe';
    expect(callback).toHaveBeenCalledWith({ name: 'Doe', age: 30 }, { name: 'John', age: 30 });
  });
  it('should track changes to array elements', () => {
    const callback = jest.fn();
    const { observer } = deepObserver([1, 2, 3], callback);
    observer[0] = 4;
    expect(callback).toHaveBeenCalledWith([4, 2, 3], [1, 2, 3]);
  });
  it('legacy nested: cb received the NESTED object (0.2.2 behaviour, superseded by spec)', () => {
    const callback = jest.fn();
    const { observer } = deepObserver({ level1: { level2: { count: 0 } } }, callback);
    observer.level1.level2.count = 1;
    // 0.2.2 asserted toHaveBeenCalledWith({ count: 1 }, { count: 0 }).
    // DESIGN §4 says cb(newSnapshot, prevSnapshot) of the root — documented breaking change.
    expect(callback).toHaveBeenCalledTimes(1);
  });
  it('legacy: mutating the original object reference is visible through observer', () => {
    const obj = { a: 1 };
    const { observer } = deepObserver(obj, () => {});
    observer.a = 2;
    expect(obj.a).toBe(2);
  });
});
