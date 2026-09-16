import { defineConfig } from 'vitest/config';

/**
 * Two projects, because two very different things are worth testing.
 *
 * **`backend`** is what this file used to be, and the reasoning has not changed.
 * `convex-test` runs the real functions against an in-memory implementation of
 * the database, which is the only way to exercise what this app most needs
 * exercised: an operation delivered twice. The client's outbox retries — that
 * is what makes a change survive a tunnel — so "does the second delivery make a
 * second row" is a question with a real answer that nothing else can ask. The
 * edge runtime is `convex-test`'s own requirement: Convex functions run in a V8
 * isolate rather than in Node, and testing them under Node would test a
 * different set of globals from the one they will meet.
 *
 * **`decisions`** is new, and narrow on purpose. The outbox's behaviour when
 * the account refuses something is a pure function of the error — no database,
 * no network, no native module — and it was the one piece of this application
 * that could stall every queued change on one bad argument without anybody
 * noticing. It is worth a test, and it costs nothing to run under Node.
 *
 * The line it must not cross is native code. Anything reaching `expo-sqlite`,
 * `expo-file-system` or a React Native module belongs on a device rather than
 * in a harness that would have to fake all three; `include` is therefore a list
 * of files rather than a glob over `src/`, so adding one is a decision.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'decisions',
          environment: 'node',
          include: [
            'src/features/library/sync/outcome.test.ts',
            'src/features/intelligence/index/chunker.test.ts',
            'src/features/intelligence/retrieve/vectors.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'backend',
          environment: 'edge-runtime',
          include: ['convex/**/*.test.ts'],
          server: { deps: { inline: ['convex-test'] } },
        },
      },
    ],
    /**
     * Credentials that authorise nothing, and one that is only ever compared.
     *
     * The R2 component refuses to construct without a bucket and a key pair,
     * and `sharing.test.ts` asserts on both halves of the download rule — that
     * a permitted recipient gets a URL and a refused one does not. Signing is
     * local arithmetic, so these produce a well-formed URL against a bucket
     * that does not exist.
     *
     * `GOOGLE_WEB_CLIENT_ID` is here because `convex/auth.config.ts` refuses to
     * load without it, which is correct — pinning the accepted audience is the
     * whole boundary between this deployment and a token minted for some other
     * application — and `import.meta.glob` hands convex-test that file along
     * with every other.
     */
    env: {
      R2_BUCKET: 'pidom-test',
      R2_ENDPOINT: 'https://test.r2.cloudflarestorage.com',
      R2_ACCESS_KEY_ID: 'test-access-key-id',
      R2_SECRET_ACCESS_KEY: 'test-secret-access-key',
      GOOGLE_WEB_CLIENT_ID: 'test.apps.googleusercontent.com',
    },
  },
});
