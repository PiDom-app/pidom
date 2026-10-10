import { ConvexError, v } from 'convex/values';

import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireUser } from './model/auth';
import { EDITOR_COMMIT_ID_MAX, EDITOR_CONTENT_MAX, EDITOR_HISTORY_LIMIT } from './model/limits';

const formatValidator = v.union(v.literal('txt'), v.literal('md'), v.literal('csv'));
const versionValidator = v.object({
  id: v.id('editorVersions'),
  documentId: v.id('documents'),
  version: v.number(),
  parentVersion: v.union(v.number(), v.null()),
  format: formatValidator,
  content: v.string(),
  contentHash: v.string(),
  clientCommitId: v.string(),
  createdAt: v.number(),
});

type EditorContext = Parameters<typeof requireUser>[0];
type EditorFormat = 'txt' | 'md' | 'csv';

function publicVersion(row: {
  _id: Id<'editorVersions'>;
  documentId: Id<'documents'>;
  version: number;
  parentVersion?: number;
  format: EditorFormat;
  content: string;
  contentHash: string;
  clientCommitId: string;
  createdAt: number;
}) {
  return {
    id: row._id,
    documentId: row.documentId,
    version: row.version,
    parentVersion: row.parentVersion ?? null,
    format: row.format,
    content: row.content,
    contentHash: row.contentHash,
    clientCommitId: row.clientCommitId,
    createdAt: row.createdAt,
  };
}

function invalid(message: string): never {
  throw new ConvexError({ code: 'INVALID', message });
}

async function requireDocument(ctx: EditorContext, documentId: Id<'documents'>) {
  const user = await requireUser(ctx);
  const document = await ctx.db.get('documents', documentId);
  if (document === null || document.ownerId !== user._id) {
    throw new ConvexError({ code: 'FORBIDDEN' });
  }
  return { user, document };
}

async function latestVersion(ctx: EditorContext, documentId: Id<'documents'>) {
  const rows = await ctx.db
    .query('editorVersions')
    .withIndex('by_document_and_version', (q) => q.eq('documentId', documentId))
    .order('desc')
    .take(1);
  return rows[0];
}

function validateCommit(content: string, contentHash: string, clientCommitId: string) {
  if (content.length > EDITOR_CONTENT_MAX) invalid('Editor content is too large');
  if (clientCommitId.length > EDITOR_COMMIT_ID_MAX || !/^[a-z0-9_-]+$/i.test(clientCommitId)) {
    invalid('Commit id has an invalid shape');
  }
  if (!/^[a-f0-9]{64}$/i.test(contentHash)) invalid('Content hash has an invalid shape');
}

export const history = query({
  args: { documentId: v.id('documents') },
  returns: v.array(versionValidator),
  handler: async (ctx, args) => {
    const { user } = await requireDocument(ctx, args.documentId);
    const rows = await ctx.db
      .query('editorVersions')
      .withIndex('by_owner_and_document', (q) =>
        q.eq('ownerId', user._id).eq('documentId', args.documentId),
      )
      .order('desc')
      .take(EDITOR_HISTORY_LIMIT);
    return rows.map(publicVersion);
  },
});

export const commit = mutation({
  args: {
    documentId: v.id('documents'),
    expectedBaseVersion: v.optional(v.number()),
    format: formatValidator,
    content: v.string(),
    contentHash: v.string(),
    clientCommitId: v.string(),
  },
  returns: v.object({
    status: v.union(v.literal('committed'), v.literal('duplicate')),
    version: versionValidator,
  }),
  handler: async (ctx, args) => {
    const { user } = await requireDocument(ctx, args.documentId);
    validateCommit(args.content, args.contentHash, args.clientCommitId);

    const duplicate = await ctx.db
      .query('editorVersions')
      .withIndex('by_owner_and_commit', (q) =>
        q.eq('ownerId', user._id).eq('clientCommitId', args.clientCommitId),
      )
      .unique();
    if (duplicate !== null) {
      return { status: 'duplicate' as const, version: publicVersion(duplicate) };
    }

    const current = await latestVersion(ctx, args.documentId);
    const currentVersion = current?.version ?? 0;
    if (args.expectedBaseVersion !== undefined && args.expectedBaseVersion !== currentVersion) {
      throw new ConvexError({
        code: 'EDITOR_CONFLICT',
        currentVersion,
        expectedBaseVersion: args.expectedBaseVersion,
      });
    }

    const now = Date.now();
    const version = currentVersion + 1;
    const id = await ctx.db.insert('editorVersions', {
      ownerId: user._id,
      documentId: args.documentId,
      version,
      parentVersion: current?.version,
      format: args.format,
      content: args.content,
      contentHash: args.contentHash,
      clientCommitId: args.clientCommitId,
      createdAt: now,
    });
    return {
      status: 'committed' as const,
      version: publicVersion({
        _id: id,
        documentId: args.documentId,
        version,
        parentVersion: current?.version,
        format: args.format,
        content: args.content,
        contentHash: args.contentHash,
        clientCommitId: args.clientCommitId,
        createdAt: now,
      }),
    };
  },
});

export const restore = mutation({
  args: {
    documentId: v.id('documents'),
    sourceVersion: v.number(),
    expectedBaseVersion: v.optional(v.number()),
    clientCommitId: v.string(),
  },
  returns: v.object({
    status: v.literal('committed'),
    version: versionValidator,
  }),
  handler: async (ctx, args) => {
    const { user } = await requireDocument(ctx, args.documentId);
    const source = await ctx.db
      .query('editorVersions')
      .withIndex('by_document_and_version', (q) =>
        q.eq('documentId', args.documentId).eq('version', args.sourceVersion),
      )
      .unique();
    if (source === null || source.ownerId !== user._id) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }

    const current = await latestVersion(ctx, args.documentId);
    const currentVersion = current?.version ?? 0;
    if (args.expectedBaseVersion !== undefined && args.expectedBaseVersion !== currentVersion) {
      throw new ConvexError({
        code: 'EDITOR_CONFLICT',
        currentVersion,
        expectedBaseVersion: args.expectedBaseVersion,
      });
    }
    validateCommit(source.content, source.contentHash, args.clientCommitId);

    const now = Date.now();
    const version = currentVersion + 1;
    const id = await ctx.db.insert('editorVersions', {
      ownerId: user._id,
      documentId: args.documentId,
      version,
      parentVersion: current?.version,
      format: source.format,
      content: source.content,
      contentHash: source.contentHash,
      clientCommitId: args.clientCommitId,
      createdAt: now,
    });
    return {
      status: 'committed' as const,
      version: publicVersion({
        _id: id,
        documentId: args.documentId,
        version,
        parentVersion: current?.version,
        format: source.format,
        content: source.content,
        contentHash: source.contentHash,
        clientCommitId: args.clientCommitId,
        createdAt: now,
      }),
    };
  },
});
