import { Database } from ".";
import { Job, JobHandler, createJob } from "./jobs";
import { Pool } from "./pool";
import { Settings } from "./settings";

// transcribeChunks is a job to take a list of audio chunks and create a transcribeChunk job for each one
export const transcribeChunks: JobHandler = async (args: { audioChunkPaths: string[] }, jobInfo: Job) => {
  for (let idx = 0; idx < args.audioChunkPaths.length; idx++) {
    const audioChunkPath = args.audioChunkPaths[idx];
    // Todo - use unique key to avoid duplicate jobs if this job fails and is retried
    createJob("transcribeChunk", jobInfo.user_id, { audioChunkPath, idx, parentJob: jobInfo.job_id });
  }
  return { okay: true };
};

const asrServicePool = new Pool(Settings.asrServiceConcurrency);

// transcribeChunk is a job to take an audio chunk and send it to the ASR service.  This function uses a Pool to limit concurrency to the remote resource.
export const transcribeChunk: JobHandler = async (args: { audioChunkPath: string }) => {
  return await asrServicePool.run(async () => {
    const a = new URLSearchParams();
    a.set("path", args.audioChunkPath);
    const result = await fetch("http://localhost:3000/get-asr-output?" + a.toString());
    const json = await result.json();
    if (result.status !== 200) {
      if (json.error) {
        throw new Error(json.error);
      }
      throw new Error(`Error ${result.status} ${result.statusText}`);
    }
    return json;
  });
};

export interface TranscriptResult {
  jobId: string;
  transcriptText?: string;
  chunkStatuses: Record<string, any>;
  jobStatus: TranscriptStatus;
  completedAt?: Date;
}
export type TranscriptStatus = "in-progress" | "completed" | "failed";

export const getTranscriptResult = async (jobId: string) => {
  const childJobs = await getTranscribeChunkJobs(jobId);
  if (childJobs.length === 0) {
    const job = await getTranscribeChunksJob(jobId);
    if (job) {
      // job is created but no child jobs are found.  Perhaps they are not scheduled yet, the job failed, or the list was empty.
      const status = jobStatusToTranscriptStatus[job.status];
      return {
        jobStatus: jobStatusToTranscriptStatus[job.status],
        completedAt: status === "in-progress" ? undefined : job.updated_at,
        chunkStatuses: {},
      };
    }
    // job not found
    return null;
  }

  // Use the child jobs to determine the status of the parent job
  const chunkData = childJobs
    .sort((a, b) => a.args.idx - b.args.idx)
    .map((job) => ({
      path: job.args.audioChunkPath,
      status: jobStatusToTranscriptStatus[job.status],
      updatedAt: job.updated_at,
      result: job.status === "completed" ? job.result.transcript : undefined,
    }));

  const result = chunkData.reduce(
    (acc: TranscriptResult, chunk) => {
      if (!acc.completedAt || acc.completedAt < chunk.updatedAt) {
        acc.completedAt = chunk.updatedAt;
      }
      if (chunk.status === "completed") {
        acc.transcriptText += "\n" + chunk.result;
      }
      acc.chunkStatuses[chunk.path] = chunk.status;

      if (acc.jobStatus === "failed" || chunk.status === "failed") {
        acc.jobStatus = "failed";
      } else if (acc.jobStatus === "in-progress" || chunk.status === "in-progress") {
        acc.jobStatus = "in-progress";
      }
      return acc;
    },
    {
      jobId,
      transcriptText: "",
      jobStatus: "completed",
      chunkStatuses: {},
    }
  );

  if (result.jobStatus === "in-progress") {
    delete result.transcriptText;
    delete result.completedAt;
  } else if (result.jobStatus === "failed") {
    delete result.transcriptText;
  }

  return result;
};

const jobStatusToTranscriptStatus = {
  scheduled: "in-progress",
  running: "in-progress",
  completed: "completed",
  failed: "failed",
} as const;

export const getTranscriptSearchResults = async (jobStatuses?: string[], userId?: string) => {
  const jobs = await findTranscriptions(jobStatuses, userId);
  const jobIds = new Set<string>();
  for (const job of jobs) {
    if (job.type === "transcribeChunk") {
      jobIds.add(job.args.parentJob);
    } else if (job.type === "transcribeChunks") {
      jobIds.add(job.job_id);
    }
  }

  const promises = [];
  for (const jobId of jobIds) {
    promises.push(getTranscriptResult(jobId));
  }
  const results = (await Promise.all(promises)).filter((r) => r !== null) as TranscriptResult[];
  return results;
};

const getTranscribeChunksJob = async (jobId: string) => {
  const result = await Database.query(`SELECT * FROM "job" WHERE "job_id" = $1 AND "type" = 'transcribeChunks'`, [jobId]);
  const job = result.rows as Job[];
  return job.length > 0 ? job[0] : null;
};

const getTranscribeChunkJobs = async (parentJobId: string) => {
  const result = await Database.query(`SELECT * FROM "job" WHERE "args"->>'parentJob' = $1 AND "type" = 'transcribeChunk'`, [parentJobId]);
  return result.rows as Job[];
};

const findTranscriptions = async (statuses?: string[], userId?: string) => {
  if (!userId && !statuses) {
    throw new Error("Must provide userId or status");
  }
  let result;
  if (userId && statuses) {
    result = await Database.query(`SELECT * FROM "job" WHERE "user_id" = $1 AND "status" = ANY($2)`, [userId, statuses]);
  } else if (userId) {
    result = await Database.query(`SELECT * FROM "job" WHERE "user_id" = $1`, [userId]);
  } else {
    result = await Database.query(`SELECT * FROM "job" WHERE "status" = ANY($1)`, [statuses]);
  }
  return result.rows as Job[];
};
