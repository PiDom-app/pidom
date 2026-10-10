/**
 * Desktop imports use a 32-character lowercase hexadecimal id until Convex
 * registration completes. Convex document ids have a different opaque shape.
 * Keeping this check at the renderer boundary prevents local-only ids from
 * being sent to validators that require v.id("documents").
 */
export function isLocalDocumentId(documentId: string): boolean {
  return /^[0-9a-f]{32}$/.test(documentId);
}
