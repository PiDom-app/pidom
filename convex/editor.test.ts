/// <reference types="vite/client" />
import rateLimiter from '@convex-dev/rate-limiter/test';
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';

import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const OWNER = {
  subject: 'google-oauth2|editor-owner',
  issuer: 'https://accounts.google.com',
  email: 'editor-owner@example.com',
  emailVerified: true,
  name: 'Editor Owner',
};
const OTHER = {
  subject: 'google-oauth2|editor-other',
  issuer: 'https://accounts.google.com',
  email: 'editor-other@example.com',
  emailVerified: true,
  name: 'Editor Other',
};

function harness() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  return t;
}

async function signedIn(t: ReturnType<typeof harness>, identity = OWNER) {
  const client = t.withIdentity(identity);
  await client.mutation(api.users.ensureProfile, {});
  return client;
}

async function documentFor(
  t: ReturnType<typeof harness>,
  client: Awaited<ReturnType<typeof signedIn>>,
) {
  return await client.mutation(api.library.importDocument, {
    title: 'Notes.txt',
    byteSize: 12,
    localId: 'ed1d0c00000000000000000000000000',
    documentKind: 'txt',
  });
}

describe('editor versions', () => {
  test('commits immutable versions and deduplicates retries', async () => {
    const t = harness();
    const client = await signedIn(t);
    const documentId = await documentFor(t, client);
    const first = await client.mutation(api.editor.commit, {
      documentId,
      format: 'txt',
      content: 'one',
      contentHash: 'a'.repeat(64),
      clientCommitId: 'commit-one',
    });
    const duplicate = await client.mutation(api.editor.commit, {
      documentId,
      format: 'txt',
      content: 'one',
      contentHash: 'a'.repeat(64),
      clientCommitId: 'commit-one',
    });

    expect(first.status).toBe('committed');
    expect(first.version.version).toBe(1);
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.version.id).toBe(first.version.id);
    expect(await client.query(api.editor.history, { documentId })).toHaveLength(1);
  });

  test('rejects stale bases and cross-account access', async () => {
    const t = harness();
    const owner = await signedIn(t);
    const documentId = await documentFor(t, owner);
    await owner.mutation(api.editor.commit, {
      documentId,
      format: 'txt',
      content: 'one',
      contentHash: 'b'.repeat(64),
      clientCommitId: 'commit-base',
    });

    await expect(
      owner.mutation(api.editor.commit, {
        documentId,
        expectedBaseVersion: 0,
        format: 'txt',
        content: 'stale',
        contentHash: 'c'.repeat(64),
        clientCommitId: 'commit-stale',
      }),
    ).rejects.toThrow(/EDITOR_CONFLICT/);

    const other = await signedIn(t, OTHER);
    await expect(other.query(api.editor.history, { documentId })).rejects.toThrow(/FORBIDDEN/);
  });

  test('restores a bounded historical snapshot as a new version', async () => {
    const t = harness();
    const client = await signedIn(t);
    const documentId = await documentFor(t, client);
    await client.mutation(api.editor.commit, {
      documentId,
      format: 'txt',
      content: 'one',
      contentHash: 'd'.repeat(64),
      clientCommitId: 'restore-one',
    });
    await client.mutation(api.editor.commit, {
      documentId,
      expectedBaseVersion: 1,
      format: 'txt',
      content: 'two',
      contentHash: 'e'.repeat(64),
      clientCommitId: 'restore-two',
    });
    const restored = await client.mutation(api.editor.restore, {
      documentId,
      sourceVersion: 1,
      expectedBaseVersion: 2,
      clientCommitId: 'restore-three',
    });
    expect(restored.version.version).toBe(3);
    expect(restored.version.content).toBe('one');
  });
});
