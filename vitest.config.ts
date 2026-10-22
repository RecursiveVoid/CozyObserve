import { defineConfig } from 'vitest/config';

// React tests opt into jsdom with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: { include: ['src/**'], reporter: ['text', 'html'] },
  },
});
