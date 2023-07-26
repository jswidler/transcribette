CREATE TABLE job (
    job_id varchar(32) PRIMARY KEY,
    user_id varchar(255) NOT NULL,
    created_at timestamp NOT NULL,
    updated_at timestamp NOT NULL,
    status varchar(32) NOT NULL,
    attempts integer NOT NULL,

    run_at timestamp NOT NULL,
    type varchar(32) NOT NULL,
    args jsonb NOT NULL,
    result jsonb
);

CREATE INDEX "job_status_run_at_idx" ON "job" ("status", "run_at");
CREATE INDEX "job_status_updated_at_idx" ON "job" ("status", "updated_at");
CREATE INDEX "job_user_id_updated_at_idx" ON "job" ("user_id", "updated_at");
CREATE INDEX "job_parent_job_id_idx" ON job((args->>'parentJob'));