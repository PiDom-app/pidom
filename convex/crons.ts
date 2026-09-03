import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

/**
 * The one scheduled job.
 *
 * Neither R2 nor Convex garbage-collects storage. An object whose `attachUpload`
 * never arrived — the app was killed between the PUT and the mutation — is
 * referenced by nothing, visible in no screen, and billed forever. Nothing else
 * in the system will ever find it, which is why this exists at all.
 *
 * Nightly rather than hourly: the only thing it recovers is storage, and a
 * failed upload costing a few megabytes for a day is not worth a job that runs
 * twenty-four times as often.
 */
const crons = cronJobs();

crons.daily(
  'sweep orphaned objects',
  { hourUTC: 3, minuteUTC: 0 },
  internal.library.sweepOrphanedObjects,
  {},
);

export default crons;
