/**
 * Whether a collection id is still a local placeholder — a `col_<32hex>` id worn
 * by a collection created offline until its create syncs and the outbox re-keys
 * it to the real Convex id. The renderer half of `isLocalCollectionId` in
 * `main/storage/paths.ts`; kept in step with it (the `col_` prefix is the wire
 * contract in `shared/ipc.ts`). A local id must never reach a Convex query typed
 * `v.id('collections')` — the arg validator rejects it and the query throws.
 */
export function isLocalCollectionId(value: string): boolean {
  return /^col_[a-f0-9]{32}$/.test(value);
}
