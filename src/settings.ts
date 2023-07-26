export const Settings = {
  // Web server port number
  port: 8080,

  // How many concurrent requests to the ASR service to allow
  asrServiceConcurrency: 5,

  // How many concurrent jobs to run.
  jobServiceConcurrency: 100,
  // How many jobs to queue at once (does not include the number of running jobs).
  jobServiceQueueSize: 500,

  // How many times to attempt a job before giving up
  jobAttempts: 3,
  // How long to wait between looking for scheduled or failed jobs.  Note the scheduler is also called when a job is created in case the system is idle.
  jobSchedulingIntervalSeconds: 3,
  // How long to wait before considering a job stale (running for too long)
  jobStaleTimeoutSeconds: 60,
  // How often to check for stale jobs
  jobStaleCheckIntervalSeconds: 30,

  dbConfig: {
    database: "postgres",
    user: "postgres",
    password: "postgres",
    host: "localhost",
    port: 5432,
  },
} as const;
