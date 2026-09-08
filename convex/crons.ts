import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

/**
 * The two scheduled jobs.
 *
 * Everything it repairs is the same shape of failure: a flow that died between
 * its requests. An R2 object whose `attachUpload` never arrived is referenced by
 * nothing, visible in no screen, and billed forever. An extraction whose process
 * went away leaves a document `extracting` for good. Page text belonging to a
 * document that is no longer synced is the reader's own content outliving their
 * decision to remove it. Neither R2 nor Convex collects any of it, and nothing
 * else in the system will ever find it, which is why this exists at all.
 *
 * Nightly rather than hourly: the worst any of it costs in a day is some
 * storage and one document's search being late, and neither is worth a job that
 * runs twenty-four times as often.
 *
 * It queues rather than runs. A cron calls one function with one mutation's
 * one-second budget; `maintenance.nightly` hands the three to a workpool that
 * gives each its own retry. See `convex/maintenance.ts`.
 */
const crons = cronJobs();

// `crons.cron` rather than `crons.daily`: the helpers are the one scheduling
// API the Convex guidelines rule out, and a cron expression says the same thing
// without the indirection.
crons.cron('nightly maintenance', '0 3 * * *', internal.maintenance.nightly, {});

/**
 * The second job, and the one that is not maintenance.
 *
 * Everything the nightly run repairs is waste. This ends somebody's access, so
 * it runs every fifteen minutes.
 *
 * It is not the enforcement. `Access.grants` compares the clock on every
 * resolution, so anybody who asks after a share has lapsed is refused there and
 * then. What this adds is the write — a Convex query is not re-run because time
 * advanced, so a screen that subscribed while a share was live goes on
 * rendering it until something it read changes, and `status` is that something.
 *
 * Fifteen minutes is the width of that window, and the reason it is not an
 * hour. It cannot be zero: the refusing mutation cannot mark the row on its way
 * past, because a mutation that throws rolls back its own writes.
 */
crons.cron('expire shares', '*/15 * * * *', internal.maintenance.expireShares, {});

export default crons;
