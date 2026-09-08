import { defineApp } from 'convex/server';
import pushNotifications from '@convex-dev/expo-push-notifications/convex.config.js';
import presence from '@convex-dev/presence/convex.config.js';
import r2 from '@convex-dev/r2/convex.config.js';
import rateLimiter from '@convex-dev/rate-limiter/convex.config.js';
import workflow from '@convex-dev/workflow/convex.config.js';
import workpool from '@convex-dev/workpool/convex.config.js';

/**
 * Components this deployment runs alongside its own functions.
 *
 * **R2** holds the PDFs because Convex's own file storage cannot serve them: an
 * HTTP action response is capped at 20 MiB on every plan and HTTP actions run in
 * the Convex runtime's 64 MiB of memory, so a 100 MB document could be uploaded
 * and then never fetched back. `ctx.storage.getUrl()` would carry any size and
 * hands out a permanent, unauthenticated URL — their docs say the only way to
 * revoke one is to delete the file, which is not a thing to say about somebody's
 * private documents. R2 signs a URL that expires, and its free tier is 10 GB
 * with no egress charges at all, against Convex's 1 GB of each. See `./r2.ts`.
 *
 * **Workflow** runs the text extraction over a synced document — four ordered
 * steps against a file the server can finally see, each separately retryable and
 * resumable across a server restart. See `./workflows/document.ts`.
 *
 * **Workpool**, named `maintenance`, runs the nightly cron's work: the sweep for
 * R2 objects nothing points at, and re-driving extraction jobs that died
 * mid-flight. Those are independent, unordered, idempotent actions with backoff,
 * which is a pool rather than a flow. Keeping them off the workflow's own pool
 * is what stops a night of maintenance delaying a reader's import.
 *
 * **Rate limiter** puts a per-account bound on the four writes that cost real
 * money or real work. `SECURITY.md` named this as the one thing not covered.
 *
 * **Push notifications** talks to Expo. It replaced about two hundred lines of
 * hand-written batching, backoff and workpool bookkeeping in `./push.ts` — with
 * one adaptation, because the component is one-token-per-account: `recordToken`
 * patches the existing row and `sendPushNotification` reads it back with
 * `.unique()`. Pidom supports up to ten devices per reader, so the id recorded
 * with it is the **device's**, not the account's. The class is generic over a
 * plain string for exactly this. See `./push.ts`.
 *
 * What did *not* come with it is receipts: the component reads the immediate
 * ticket from `/push/send`, treats only `MessageRateExceeded` as retryable, and
 * never calls `getReceipts` — so nothing in it ever retires a dead token. That
 * half is still Pidom's, and is the only thing that notices a handset has been
 * wiped. It runs on the **`receipts`** workpool: fetching them is an
 * independent, unordered, idempotent action against a third party, which is a
 * pool rather than a flow, and a group share can leave a hundred of them due at
 * once.
 *
 * **Presence** tracks who is in a document or group room right now. It is
 * ephemeral by construction — heartbeats and a timeout, run by one
 * deployment-wide worker rather than by every client polling — which is exactly
 * what "is Amina reading this" is and exactly what a `lastSeen` column is not.
 * Its own component tables are the only place that state lives. See
 * `./presence.ts`, which wraps every entry point in an access check.
 *
 * Parallelism is the number to watch: the free plan allows 20 across every pool
 * in the deployment, and the workflow component carries a pool of its own. The
 * three written here are 4, 2 and 2; the push component brings one of its own.
 */
const app = defineApp();
app.use(r2);
app.use(workflow);
app.use(workpool, { name: 'maintenance' });
app.use(workpool, { name: 'receipts' });
app.use(rateLimiter);
app.use(presence);
app.use(pushNotifications, { env: {} });

export default app;
