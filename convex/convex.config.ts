import { defineApp } from 'convex/server';
import r2 from '@convex-dev/r2/convex.config.js';

/**
 * Components this deployment runs alongside its own functions.
 *
 * Just the one. Cloudflare R2 holds the PDFs because Convex's own file storage
 * cannot serve them: an HTTP action response is capped at 20 MiB on every plan
 * and HTTP actions run in the Convex runtime's 64 MiB of memory, so a 100 MB
 * document could be uploaded and then never fetched back. `ctx.storage.getUrl()`
 * would carry any size and hands out a permanent, unauthenticated URL — their
 * docs say the only way to revoke one is to delete the file, which is not a
 * thing to say about somebody's private documents.
 *
 * R2 signs a URL that expires, and its free tier is 10 GB with no egress
 * charges at all, against Convex's 1 GB of each. See `convex/r2.ts`.
 */
const app = defineApp();
app.use(r2);

export default app;
