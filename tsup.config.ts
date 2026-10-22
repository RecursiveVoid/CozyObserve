import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', react: 'src/react/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: true,
  treeshake: true,
  target: 'es2020',
  external: ['react'],
  // react.js must import the core from the shared chunk/entry, never inline a second copy
  splitting: true,
  esbuildOptions(o) {
    // Core-internal fields/methods (src/core/signal.ts) are renamed in the bundle to save bytes.
    // Explicit list (not /^_/) so other modules' `_foo` names are untouched. Keep in sync with signal.ts.
    o.mangleProps =
      /^_(value|version|node|targets|equals|refresh|subscribe|unsubscribe|set|fn|sources|globalVersion|flags|notify|cleanup|next|callback|dispose|prev|source|target|prevSource|nextSource|prevTarget|nextTarget|rollback|seen|tail)$/;
  },
});
