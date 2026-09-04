import { R2 } from '@convex-dev/r2';

import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { assertOwner, requireUser } from './model/auth';
import { coverKey, documentIdOf, pdfKey } from './model/library';

/**
 * The bucket, and the one function the client is allowed to call on it.
 *
 * Credentials come from the deployment's environment — `R2_BUCKET`,
 * `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — and never from an
 * argument.
 */
export const r2 = new R2(components.r2);

/**
 * `syncMetadata` only. The component's `clientApi` also offers
 * `generateUploadUrl`, `getMetadata` and `deleteObject`, and none of those
 * belong on the public surface here:
 *
 * - **`generateUploadUrl`** cannot take a custom key by design — the
 *   component's own docs say you do not want the client naming your objects.
 *   Pidom's keys carry ownership, so `library.uploadUrl` mints them from ids
 *   the server already holds.
 * - **`getMetadata`** and **`deleteObject`** take a bare key. A key is a
 *   guessable string in a way a Convex id is not, so anything reachable by key
 *   goes through a document id and `assertOwner` instead.
 *
 * What is left is the metadata sync the client must run after its upload — and
 * that one *does* take a bare key, which `checkUpload` alone did not cover.
 * `checkUpload` is handed the bucket and never the key, so authentication was
 * the only thing standing between any signed-in account and a scheduled R2 HEAD
 * plus a component write against any key it cared to name, including another
 * reader's. `onUpload` runs before that job is scheduled and is the only
 * callback the component gives the key to, so the binding goes here: the key
 * has to be one this caller's own document would have produced.
 */
export const { syncMetadata } = r2.clientApi<DataModel>({
  checkUpload: async (ctx) => {
    await requireUser(ctx);
  },
  onUpload: async (ctx, _bucket, key) => {
    const user = await requireUser(ctx);
    const claimed = documentIdOf(key);
    if (claimed === null) {
      // Not a shape this backend mints. Refused the same way a foreign key is,
      // so a caller cannot tell a malformed key from somebody else's.
      assertOwner(null, user);
      return;
    }
    // `normalizeId` rather than a cast: `ctx.db.get` on a string that is not an
    // id of this table throws, and a thrown validator is a different answer
    // than `FORBIDDEN`.
    const documentId = ctx.db.normalizeId('documents', claimed);
    const doc = documentId === null ? null : await ctx.db.get('documents', documentId);
    assertOwner(doc, user);
    if (key !== pdfKey(user._id, doc._id) && key !== coverKey(user._id, doc._id)) {
      assertOwner(null, user);
    }
  },
});
