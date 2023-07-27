import { ulid } from "ulid";
import { Pool } from "./pool";
import { debounce } from "lodash";
import { Settings } from "./settings";
import { transcribeChunks, transcribeChunk } from "./transcriptions";
import { Database, logger } from ".";

export type JobHandler = (args: any, jobInfo: Job) => Promise<any>;
// Register JobHandlers here in this map.
const jobHandlers: Record<string, JobHandler> = {
  transcribeChunks,
  transcribeChunk,
};

export type JobStatus = "scheduled" | "running" | "completed" | "failed";
// Job is a row in the job database table.
export interface Job {
  job_id: string;
  created_at: Date;
  updated_at: Date;
  type: string;
  status: JobStatus;
  args: any;
  result: any;
  user_id: string;
  attempts: number;
}

// Create a job in the database and schedule it to run immediately.
export const createJob = async (jobType: string, userId: string, jobArgs: any) => {
  const jobId = ulid();
  await Database.query(
    `INSERT INTO job (
        job_id, user_id, created_at, updated_at, status, attempts, run_at, type, args
      ) VALUES (
        $1, $2, NOW(), NOW(), $3, $4, NOW(), $5, $6
      )`,
    [jobId, userId, "scheduled", 0, jobType, jobArgs]
  );
  scheduleJobs();
  return jobId;
};

const jobWorkerPool = new Pool(Settings.jobServiceConcurrency);
let lastJobCount = 1;

// Look for jobs in the database and request workers to run them.
export const scheduleJobs = debounce(async () => {
  let dbQueueSize: number;
  try {
    dbQueueSize = await countScheduledJobs();
  } catch (err) {
    logger.error(err);
    return;
  }

  const totalToWaitOn = Math.min(dbQueueSize, Settings.jobServiceQueueSize); // max number of jobs we should be waiting on
  const numToQueue = totalToWaitOn - jobWorkerPool.numQueued(); // subtract the actual amount we are waiting on

  if (lastJobCount > 0) {
    if (dbQueueSize === 0 && jobWorkerPool.numActive() === 0) {
      logger.info("No jobs to run");
    } else {
      logger.info(
        {
          running: jobWorkerPool.numActive(),
          dbQueueSize,
          serverQueueSize: jobWorkerPool.numQueued(),
          numToQueue,
        },
        `There are ${dbQueueSize} scheduled jobs.  This node is actively running ${jobWorkerPool.numActive()} with ${jobWorkerPool.numQueued()} queued; ${numToQueue} more will be added.`
      );
    }
  }
  lastJobCount = dbQueueSize + jobWorkerPool.numActive();

  if (numToQueue > 0) {
    for (let i = 0; i < numToQueue; i++) {
      jobWorkerPool.run(runJob);
    }
  }
}, 50);
setInterval(scheduleJobs, Settings.jobSchedulingIntervalSeconds * 1000);

// Attempt to run a single available job if one exists.
const runJob = async () => {
  let jobId: string = "";
  try {
    const job = await acquireJob();
    if (!job) {
      return;
    }
    jobId = job.job_id;

    const jobHandler = jobHandlers[job.type];
    if (!jobHandler) {
      console.error(`No job handler registered for ${job.type}`);
      await failJob(job.job_id, { error: "No job handler registered" });
      return;
    }

    const jobResult = await jobHandler(job.args, job);

    await completeJob(jobId, jobResult);
  } catch (err: any) {
    if (jobId) {
      const error = err?.message || JSON.stringify(err);
      await failJob(jobId, { error });
    } else {
      console.error(err);
    }
    return;
  }
};

// Count the number of rows in the job table that are in the 'scheduled' state
export const countScheduledJobs = async () => {
  const result = await Database.query(`SELECT COUNT(*) FROM "job" WHERE "status" = 'scheduled'`);
  return parseInt(result.rows[0].count);
};

// Look for jobs which have timed out and reschedule or fail them
const refreshStaleJobs = async () => {
  const result = await Database.query(
    `WITH stale AS (
    SELECT * FROM "job" WHERE "status" = 'running' AND updated_at < NOW() - INTERVAL '1 second' * $3
    LIMIT 100 FOR UPDATE SKIP LOCKED
  )
  UPDATE "job" j SET 
      "status" = CASE WHEN j.attempts >= $2 THEN 'failed' ELSE 'scheduled' END,
      "updated_at" = NOW(),
      "result" = $1
  FROM stale WHERE j.job_id = stale.job_id RETURNING j.*;`,
    [{ error: "timed out" }, Settings.jobAttempts, Settings.jobStaleTimeoutSeconds]
  );

  if (result.rows.length > 0) {
    logger.info({ staleJobs: result.rows.length }, `Refreshed or failed ${result.rows.length} stale jobs`);
  }
};
setInterval(refreshStaleJobs, Settings.jobStaleCheckIntervalSeconds * 1000);

const acquireJob = async () => {
  const result = await Database.query(`WITH to_run AS (
    SELECT * from "job" WHERE "status" = 'scheduled' AND "run_at" < NOW()
    LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  UPDATE "job" j SET 
      "status" = 'running',
      "updated_at" = NOW(),
      "attempts" = j.attempts + 1
  FROM to_run WHERE j.job_id = to_run.job_id RETURNING j.*;`);

  if (result.rows.length === 0) {
    return null;
  }
  const job: Job = result.rows[0];
  return job;
};

const completeJob = async (jobId: string, jobResult: any) => {
  await Database.query(
    `UPDATE "job" SET
      "status" = 'completed',
      "updated_at" = NOW(),
      "result" = $2
    WHERE "job_id" = $1 and "status" = 'running'`,
    [jobId, jobResult]
  );
};

const failJob = async (jobId: string, error: any) => {
  await Database.query(
    `UPDATE "job" SET
      "status" = CASE WHEN "attempts" >= $3 THEN 'failed' ELSE 'scheduled' END,
      "updated_at" = NOW(),
      "result" = $2
    WHERE "job_id" = $1 AND "status" = 'running'`,
    [jobId, error, Settings.jobAttempts]
  );
};
