/*
 * Deep reactive store (§2).
 *
 * One `Meta` per raw target (WeakMap target → Meta). The Meta object doubles as the Proxy
 * handler (traps are prototype methods; `this` inside a trap is the handler), so there is no
 * per-object closure and no WeakMap lookup on the hot path.
 *
 * Tracking: per-property `Signal`s are created lazily, and ONLY when a property is read inside
 * a tracking context (effect/computed/tracker). Untracked reads allocate nothing.
 * A `keys` signal covers `in` / ownKeys / for-in / Object.keys (and array length changes).
 *
 * Versions: every write stamps the object's `v` with a fresh global epoch and bubbles the stamp
 * up through *parent links*. Parent links are created only by `snapshot()` (the only thing that
 * caches data derived from children), and reconciled every time a snapshot is rebuilt, so
 * shared subtrees (one raw object under several parents / several stores) invalidate every
 * parent whose snapshot contains them. A cached snapshot is valid iff `sv === v`.
 * `subscribeStore` listens to a lazily created per-object version signal (`vs`).
 */
import {
  Computed,
  Signal,
  endBatch,
  getCurrentObserver,
  setCurrentObserver,
  startBatch,
} from '../core/internal';
import type { Unsubscribe } from '../core/types';

type Primitive = string | number | boolean | bigint | symbol | undefined | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Builtin =
  | Primitive
  | ((...a: any[]) => unknown)
  | Date
  | RegExp
  | Error
  | Map<any, any>
  | Set<any>
  | WeakMap<any, any>
  | WeakSet<any>
  | Promise<any>;

/** Deeply readonly view of `T` (what `snapshot()` returns). Non-plain objects are left as-is. */
export type DeepReadonly<T> = T extends Builtin
  ? T
  : { readonly [K in keyof T]: DeepReadonly<T[K]> };

const metas = new WeakMap<object, Meta>();
const proxies = new WeakMap<object, Meta>();
const hasOwn = Object.prototype.hasOwnProperty;
const AP = Array.prototype as unknown as Record<
  string,
  (...a: unknown[]) => unknown
>;
let epoch = 0;

function isPlain(v: object): boolean {
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null || p === Array.prototype;
}

/** Meta for a raw plain object/array (created on demand), or undefined if not proxyable. */
function metaOf(v: unknown): Meta | undefined {
  if (typeof v !== 'object' || v === null) return;
  let m = metas.get(v) || proxies.get(v);
  if (!m && v !== Object.prototype && isPlain(v) && !Object.isFrozen(v))
    metas.set(v, (m = new Meta(v)));
  return m;
}

const raw = <T>(v: T): T => {
  const m = typeof v === 'object' && v !== null ? proxies.get(v) : undefined;
  return m ? (m.t as T) : v;
};

const assertWritable = (): void => {
  if (getCurrentObserver() instanceof Computed)
    throw new Error('Cannot write inside computed');
};

const counter = (): Signal<number> => new Signal(0);
const tick = (s: Signal<number> | undefined): void => {
  if (s) s._set(s._value + 1);
};

/** Stamp `m` and all linked ancestors with the current epoch (cycle-safe). */
function bump(m: Meta): void {
  if (m.v === epoch) return;
  m.v = epoch;
  if (m.vs) m.vs._set(epoch);
  // parent links are weak: a short-lived store that contained a shared child must stay collectable
  if (m.p1) {
    const p = m.p1.deref();
    if (p) bump(p);
    else m.p1 = undefined;
  }
  if (m.ps)
    for (const w of m.ps) {
      const p = w.deref();
      if (p) bump(p);
      else m.ps.delete(w);
    }
}

function link(c: Meta, p: Meta): void {
  const w = p.w || (p.w = new WeakRef(p));
  if (c.p1 === w || c === p) return;
  if (!c.p1) c.p1 = w;
  else (c.ps || (c.ps = new Set())).add(w);
}
function unlink(c: Meta, p: Meta): void {
  const w = p.w;
  if (c.p1 === w) c.p1 = undefined;
  else if (c.ps && w) c.ps.delete(w);
}

/** Drop a property signal nobody depends on (deleted key / truncated index). Safe: its version
 * was just bumped, so any unsubscribed dependent sees the change and re-reads a fresh signal. */
function dropIdle(
  sg: Map<PropertyKey, Signal>,
  k: PropertyKey,
  s: Signal
): void {
  if (!s._targets) sg.delete(k);
}

/** `o[k] = v` without the `__proto__` setter (own "__proto__" keys from JSON.parse etc.) */
function put(o: any, k: PropertyKey, v: unknown): void {
  if (k === '__proto__')
    Object.defineProperty(o, k, {
      value: v,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  else o[k] = v;
}

/** Replace store proxies found in a raw object's own data properties by their raw targets. */
function unwrapChildren(t: any, isArr: boolean): void {
  if (isArr) {
    for (let i = 0; i < t.length; i++) {
      const m = proxies.get(t[i]);
      if (m) t[i] = m.t;
    }
  } else
    for (const k in t) {
      if (!hasOwn.call(t, k)) continue;
      const d = Object.getOwnPropertyDescriptor(t, k)!;
      const m = d.writable ? proxies.get(d.value) : undefined;
      if (m) t[k] = m.t;
    }
}

class Meta implements ProxyHandler<any> {
  /** raw target */ t: any;
  /** proxy */ p: any;
  /** per-property signals (lazy) */ sg: Map<PropertyKey, Signal> | undefined;
  /** keys / iteration signal (lazy) */ ks: Signal<number> | undefined;
  /** version: epoch of the last deep change */ v: number;
  /** deep version signal (lazy; subscribeStore / snapshot() in effects) */ vs:
    Signal<number> | undefined;
  /** weak parent links (first one inline, rest in a Set) */ p1:
    WeakRef<Meta> | undefined;
  ps: Set<WeakRef<Meta>> | undefined;
  /** this Meta's own WeakRef (shared by all its children's links) */ w:
    WeakRef<Meta> | undefined;
  /** cached snapshot + the version it was built at + child metas it contains */
  s: any;
  sv: number;
  kids: Meta[] | undefined;
  /** is array */ a: boolean;

  constructor(t: object) {
    this.t = t;
    this.a = Array.isArray(t);
    this.p = new Proxy(t, this);
    proxies.set(this.p, this);
    this.sg =
      this.ks =
      this.vs =
      this.p1 =
      this.w =
      this.ps =
      this.s =
      this.kids =
        undefined;
    this.v = 0;
    this.sv = -1;
    unwrapChildren(t as any, this.a);
  }

  /** tracked read of property `k` */
  tr(k: PropertyKey, v: unknown): void {
    let s = (this.sg || (this.sg = new Map())).get(k);
    if (!s) this.sg.set(k, (s = new Signal(v)));
    s.value;
  }

  trk(): void {
    (this.ks || (this.ks = counter())).value;
  }

  get(t: any, k: PropertyKey, r: any): any {
    if (this.a && typeof k === 'string') {
      const am = arrayMethods || (arrayMethods = makeArrayMethods());
      if (hasOwn.call(am, k)) return am[k];
    }
    const v = Reflect.get(t, k, r);
    if (getCurrentObserver() && typeof k !== 'symbol') this.tr(k, v);
    if (typeof v === 'object' && v !== null) {
      const m = metaOf(v);
      if (m) {
        // a store proxy stored inside raw data (e.g. nested in an initial value): unwrap lazily
        if (v === m.p && hasOwn.call(t, k)) t[k] = m.t;
        return m.p;
      }
    }
    return v;
  }

  set(t: any, k: PropertyKey, nv: any, r: any): boolean {
    if (r !== this.p) return Reflect.set(t, k, nv, r);
    assertWritable();
    nv = raw(nv);
    const had = hasOwn.call(t, k);
    const old = t[k];
    if (had && Object.is(old, nv)) return true;
    const a = this.a;
    const len = a ? t.length : 0;
    put(t, k, nv);
    startBatch();
    try {
      epoch++;
      const sg = this.sg;
      if (sg) {
        const s = sg.get(k);
        if (s) s._set(nv);
      }
      if (!had) tick(this.ks);
      if (a && t.length !== len) {
        if (sg) {
          const s = sg.get('length');
          if (s) s._set(t.length);
          if (t.length < len)
            for (const [key, s] of sg)
              if (+(key as string) >= t.length) {
                s._set(undefined);
                dropIdle(sg, key, s);
              }
        }
        if (had) tick(this.ks);
      }
      bump(this);
    } finally {
      endBatch();
    }
    return true;
  }

  deleteProperty(t: any, k: PropertyKey): boolean {
    if (!hasOwn.call(t, k)) return true;
    assertWritable();
    delete t[k];
    startBatch();
    try {
      epoch++;
      const s = this.sg && this.sg.get(k);
      if (s) {
        s._set(undefined);
        dropIdle(this.sg!, k, s);
      }
      tick(this.ks);
      bump(this);
    } finally {
      endBatch();
    }
    return true;
  }

  has(t: any, k: PropertyKey): boolean {
    if (getCurrentObserver()) this.trk();
    return k in t;
  }

  ownKeys(t: any): ArrayLike<string | symbol> {
    if (getCurrentObserver()) {
      this.trk();
      if (this.a) this.tr('length', t.length);
    }
    return Reflect.ownKeys(t);
  }
}

// ---------------------------------------------------------------------------
// arrays

type ArrayFn = (this: unknown[], ...a: unknown[]) => unknown;
/** built lazily (no module-level side effects → tree-shakeable) */
let arrayMethods: Record<string, ArrayFn> | undefined;

function makeArrayMethods(): Record<string, ArrayFn> {
  const am: Record<string, ArrayFn> = Object.create(null);
  // mutators: one batch per call, untracked (so `push` inside an effect doesn't depend on length)
  for (const name of [
    'push',
    'pop',
    'shift',
    'unshift',
    'splice',
    'sort',
    'reverse',
    'fill',
    'copyWithin',
  ]) {
    am[name] = function (...args) {
      const m = proxies.get(this);
      if (!m) return AP[name].apply(this, args);
      assertWritable();
      const prev = setCurrentObserver(undefined);
      startBatch();
      try {
        return AP[name].apply(this, args);
      } finally {
        setCurrentObserver(prev);
        endBatch();
      }
    };
  }
  // identity searches: retry on raw values so both proxies and raw objects are found
  for (const name of ['includes', 'indexOf', 'lastIndexOf']) {
    am[name] = function (...args) {
      const r = AP[name].apply(this, args);
      return r === -1 || r === false
        ? AP[name].apply(raw(this), args.map(raw))
        : r;
    };
  }
  return am;
}

// ---------------------------------------------------------------------------
// snapshot

/** true if every element of `old` is at the same index in `kids` (common case: nothing removed) */
function samePrefix(old: Meta[], kids: Meta[]): boolean {
  if (old.length > kids.length) return false;
  for (let i = 0; i < old.length; i++) if (old[i] !== kids[i]) return false;
  return true;
}

function snap(m: Meta): any {
  if (m.sv === m.v) return m.s;
  const t = m.t;
  const out: any = m.a
    ? new Array(t.length)
    : Object.getPrototypeOf(t)
      ? {}
      : Object.create(null);
  const old = m.kids;
  const kids: Meta[] = [];
  // publish before recursing so cyclic graphs terminate (the cycle points at this object)
  m.s = out;
  m.sv = m.v;
  const keys = m.a ? undefined : Object.keys(t);
  const n = keys ? keys.length : t.length;
  for (let i = 0, j = 0; i < n; i++) {
    const k = keys ? keys[i] : i;
    const v = t[k];
    if (typeof v !== 'object' || v === null) {
      put(out, k, v);
      continue;
    }
    // fast path: same child as in the previous snapshot, in the same order (already linked)
    let c = old && j < old.length && old[j].t === v ? old[j++] : undefined;
    if (!c && (c = metaOf(v))) {
      if (v === c.p) t[k] = c.t;
      link(c, m);
    }
    if (c) {
      kids.push(c);
      put(out, k, snap(c));
    } else put(out, k, v);
  }
  if (old && old.length && !samePrefix(old, kids)) {
    const now = new Set(kids);
    for (let i = 0; i < old.length; i++)
      if (!now.has(old[i])) unlink(old[i], m);
  }
  m.kids = kids;
  return Object.freeze(out);
}

function metaFor(s: object, fn: string): Meta {
  const m = proxies.get(s) || metaOf(s);
  if (!m)
    throw new TypeError(fn + '() expects a store or a plain object/array');
  return m;
}

// ---------------------------------------------------------------------------
// public API

/**
 * Deep reactive proxy over a plain object/array (mutates `initial` in place).
 * Proxies are cached: `store(o) === store(o)`, `s.a === s.a`. Only plain objects / arrays are
 * proxied; Date, Map, Set, class instances, frozen objects... are stored as plain values.
 */
export function store<T extends object>(initial: T): T {
  return metaFor(initial, 'store').p;
}

/**
 * Immutable (frozen) plain copy of the store's current state. Unchanged subtrees keep the same
 * reference between calls (structural sharing); with no changes the identical object is returned.
 * Inside an effect/computed it tracks the whole tree (deep).
 */
export function snapshot<T extends object>(s: T): DeepReadonly<T> {
  const m = metaFor(s, 'snapshot');
  if (getCurrentObserver()) (m.vs || (m.vs = new Signal(m.v))).value;
  return snap(m);
}

/** Calls `cb(next, prev)` with snapshots once per batch after any deep change. */
export function subscribeStore<T extends object>(
  s: T,
  cb: (snap: T, prev: T) => void
): Unsubscribe {
  const m = metaFor(s, 'subscribeStore');
  let prev = snap(m);
  return (m.vs || (m.vs = new Signal(m.v))).subscribe(() => {
    const next = snap(m);
    if (next !== prev) {
      const p = prev;
      prev = next;
      cb(next, p);
    }
  });
}

/** The raw object behind a store proxy (non-store values are returned unchanged). */
export const toRaw: <T>(s: T) => T = raw;

export function isStore(x: unknown): boolean {
  return typeof x === 'object' && x !== null && proxies.has(x);
}
