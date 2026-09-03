import { R2 } from '@convex-dev/r2';

import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { requireUser } from './model/auth';

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
 * What is left is the metadata sync the client must run after its upload, and
 * `checkUpload` puts the same authentication in front of it as everything else.
 */
export const { syncMetadata } = r2.clientApi<DataModel>({
  checkUpload: async (ctx) => {
    await requireUser(ctx);
  },
});
