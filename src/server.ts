import fastify from "fastify";
import { createJob } from "./jobs";
import { getTranscriptResult, getTranscriptSearchResults } from "./transcriptions";

export const server = fastify({ logger: true });

interface TranscribeArgs {
  audioChunkPaths: string[];
  userId: string;
}

server.post("/transcribe", async (request, reply) => {
  const { audioChunkPaths, userId } = request.body as TranscribeArgs;
  const jobId = await createJob("transcribeChunks", userId, { audioChunkPaths });
  return { jobId };
});

server.get("/transcript/:id", async (request, reply) => {
  const { id } = request.params as { id: string };

  const transcriptResult = await getTranscriptResult(id);
  if (transcriptResult) {
    return transcriptResult;
  }

  reply.status(404).send({ error: "Job not found" });
  return;
});

interface SearchArgs {
  jobStatus?: string;
  userId?: string;
}

server.get("/transcript/search", async (request, reply) => {
  const { jobStatus, userId } = request.query as SearchArgs;
  let statuses: string[] | undefined;
  if (jobStatus === "in-progress") {
    statuses = ["scheduled", "running"];
  } else if (jobStatus) {
    statuses = [jobStatus];
  }
  return await getTranscriptSearchResults(statuses, userId);
});
