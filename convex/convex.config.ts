import { defineApp } from 'convex/server';
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
 * **Workpool**, named `notifications`, fans a share out to the people it
 * reaches. A group share is one row, so nothing here inserts permissions — but
 * it does write an event per member and POST to Expo's push service in batches,
 * and neither belongs inside the mutation that grants the share. A reader
 * tapping Share should not wait on a third party, and one unreachable device
 * should not take the rest of a group down with it. See `./push.ts`.
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
 * three here are set to 4, 2 and 4 in the files that construct them.
 */
const app = defineApp();
app.use(r2);
app.use(workflow);
app.use(workpool, { name: 'maintenance' });
app.use(workpool, { name: 'notifications' });
app.use(rateLimiter);
app.use(presence);

export default app;
