import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

/**
 * Local cache schema (skeleton). This mirrors a subset of the cloud document
 * model (convex/schema.ts `documents`) so the desktop app can list a library
 * offline. It is a CACHE, not a source of truth — Convex owns the data and
 * every field here is filled from an owner-checked query.
 *
 * No product features are wired yet; this establishes the drizzle + better-
 * sqlite3 pipeline (migrations via drizzle-kit, queries in the main process).
 */
export const documentsCache = sqliteTable('documents_cache', {
  id: text('id').primaryKey(), // Convex document id
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  author: text('author'),
  pageCount: integer('page_count'),
  currentPage: integer('current_page').notNull().default(1),
  progress: real('progress').notNull().default(0),
  isFinished: integer('is_finished', { mode: 'boolean' }).notNull().default(false),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at').notNull().default(0),
});

export type DocumentCacheRow = typeof documentsCache.$inferSelect;
