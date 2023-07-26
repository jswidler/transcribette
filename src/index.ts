import { Client } from "pg";
import { migrate } from "postgres-migrations";
import { scheduleJobs } from "./jobs";
import { server } from "./server";
import { Settings } from "./settings";
import pino from "pino";

export const logger = pino();

export let Database: Client;

export const initDatabase = async () => {
  const client = new Client(Settings.dbConfig);
  await client.connect();
  Database = client;
  await migrate({ client }, "migrations");
};

async function main() {
  await initDatabase();
  scheduleJobs();
  server.listen({ port: Settings.port }, async (err) => {
    if (err) {
      console.error(err);
      await Database.end();
      process.exit(1);
    }
  });
}
main();
