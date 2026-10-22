import { describe, it, expect } from 'vitest';
import { observable, computed, effect, batch } from '../../src/index';

describe('spec §1: large fan-out', () => {
  it('10k subscribers each get exactly one call with the right args', () => {
    const s = observable(0);
    const counts = new Int32Array(10_000);
    let bad = 0;
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < 10_000; i++) {
      unsubs.push(
        s.subscribe((v, p) => {
          counts[i]++;
          if (v !== 1 || p !== 0) bad++;
        }),
      );
    }
    s.set(1);
    expect(bad).toBe(0);
    expect(counts.every((c) => c === 1)).toBe(true);

    // unsubscribe every even one
    for (let i = 0; i < 10_000; i += 2) unsubs[i]();
    s.set(2);
    let odd = 0;
    let even = 0;
    for (let i = 0; i < 10_000; i++) {
      if (i % 2) odd += counts[i];
      else even += counts[i];
    }
    expect(even).toBe(5_000);
    expect(odd).toBe(10_000);
  });

  it('10k effects on one signal each re-run once', () => {
    const s = observable(0);
    let total = 0;
    const disposers: Array<() => void> = [];
    for (let i = 0; i < 10_000; i++) {
      disposers.push(
        effect(() => {
          s.value;
          total++;
        }),
      );
    }
    expect(total).toBe(10_000);
    s.set(1);
    expect(total).toBe(20_000);
    for (const d of disposers) d();
    s.set(2);
    expect(total).toBe(20_000);
  });

  it('10k computeds from one signal, summed by one computed', () => {
    const s = observable(1);
    const cs = Array.from({ length: 10_000 }, (_, i) => computed(() => s.value + i));
    let runs = 0;
    const sum = computed(() => {
      runs++;
      let t = 0;
      for (const c of cs) t += c.value;
      return t;
    });
    let seen = 0;
    effect(() => {
      seen = sum.value;
    });
    const expected = (v: number) => 10_000 * v + (9_999 * 10_000) / 2;
    expect(seen).toBe(expected(1));
    s.set(2);
    expect(seen).toBe(expected(2));
    expect(runs).toBe(2);
  });

  it('batched update of 10k signals triggers one run of an effect reading them all', () => {
    const sigs = Array.from({ length: 10_000 }, () => observable(0));
    let runs = 0;
    effect(() => {
      runs++;
      for (const s of sigs) s.value;
    });
    batch(() => {
      for (const s of sigs) s.set(1);
    });
    expect(runs).toBe(2);
  });
});
