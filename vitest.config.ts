import { defineConfig } from 'vitest/config';

/**
 * The backend's tests, and only the backend's.
 *
 * `convex-test` runs the real functions against an in-memory implementation of
 * the database, which is the only way to exercise what this app most needs
 * exercised: an operation delivered twice. The client's outbox retries — that
 * is what makes a change survive a tunnel — so "does the second delivery make a
 * second row" is a question with a real answer that nothing else can ask.
 *
 * The edge runtime is `convex-test`'s own requirement: Convex functions run in a
 * V8 isolate rather than in Node, and testing them under Node would test a
 * different set of globals from the one they will meet.
 */
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.test.ts'],
    server: { deps: { inline: ['convex-test'] } },
  },
});
