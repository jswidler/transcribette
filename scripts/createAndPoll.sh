#!/bin/bash
set -euo pipefail

# Uses httpie and jq; they can be installed with brew.

# Create a new job and extract jobId from JSON response
JOB_ID=`http POST http://localhost:8080/transcribe --raw '{
  "audioChunkPaths": [
    "audio-file-1.wav",
    "audio-file-2.wav",
    "audio-file-3.wav",
    "audio-file-4.wav",
    "audio-file-5.wav",
    "audio-file-6.wav",
    "audio-file-7.wav"
  ],
  "userId": "jesse"
}' | jq -r '.jobId'`


echo "Job ${JOB_ID} created."

# Poll while status equals 'in-progress'
STATUS='in-progress'
while [ $STATUS == 'in-progress' ];
do
  sleep 1
  RESULT=`http GET http://localhost:8080/transcript/$JOB_ID`
  STATUS=`echo -E ${RESULT} | jq -r '.jobStatus'`
  if [ $STATUS == 'in-progress' ]; then
    echo -n '.'
  fi
done

# Print some kind of result
if [ $STATUS == 'completed' ]; then
  echo -e "\n\nTranscript:"
  echo -E ${RESULT} | jq -r '.transcriptText'
else
  echo -e "\n\nJob $JOB_ID failed"
  echo -E ${RESULT}  | jq -r '.chunkStatuses'
fi


