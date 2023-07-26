# Transcribette

This repo implements a solution to a take home interview problem.  The problem included a mock API to do the actual transcribing, so the main challenge here was to implement a robust client around that flakey API.

I am purposely not naming the company or providing other context around provided materials.

## Running the code

1. Run the Mock API at locahost:3000 (as configured in the provided server).
2. Start Postgres.  You can do this with `docker-compose up` in the root of this repo.  If you do not use this method, you may need to update `dbConfig` in `src/settings.js` accordingly.
3. Run `npm install` in the root of this repo.
4. Run `npm start` in the root of this repo.  Alternatively, for live-reloading, use `nodemon --watch src --watch migrations --ext ts,sql`

## Demo commands


Create a job 
```sh
curl --request POST \
  --url http://localhost:8080/transcribe \
  --header 'Content-Type: application/json' \
  --data '{
  "audioChunkPaths": [
    "audio-file-1.wav",
    "audio-file-2.wav",
    "audio-file-3.wav",
    "audio-file-4.wav",
    "audio-file-5.wav",
    "audio-file-6.wav"
  ],
  "userId": "jesse"
}'
```

Check the status and output of a job
```sh
curl --request GET --url http://localhost:8080/transcript/01H6A0H518HAE19FM3Y0FBN8QB
```

Search for all jobs for a user
```sh
curl --request GET  --url 'http://localhost:8080/transcript/search?userId=jesse'
```

Search for all `failed`|`completed`|`in-progress`|`scheduled`|`running` jobs.  `in-progress` is an alias for both `scheduled` and `running`.

```sh
curl --request GET  --url 'http://localhost:8080/transcript/search?jobStatus=failed'
```

Run a job and poll for the result using a bash script (requires HTTPie and jq):

```sh
./scripts/createAndPoll.sh
```

## Notes

I created a simple Job framework to acquire work from a Postgres data store.  There are two job created for it.  For expediency, they use the job table to store their results instead of creating new tables to store their output.

I created a simple Pool to manage concurrency limits.  A Pool is used by the Job framework to limit the number of concurrent jobs.  A separate Pool is used by the `transcribeChunk` job to limit the number of concurrent API calls to the mock API.

All jobs will be retried automatically, up to 3 times (or depending on configuration in the settings file).  If a job fails too many times, it will be marked as `failed` and will not be retried, even if the retry limit is changed.  While below the retry setting, a failed job will be retried by setting its status to `scheduled` instead of `failed`.

If the server crashes or otherwise fails to reback a result to the Job table, it will be noticed as being stale once enough time has passed; as dictated by the `jobStaleTimeoutSeconds` setting.  When a job is noticed as being stale, it will be handled as if it had failed, and either retried or marked as `failed` depending on the number of previous attempts.