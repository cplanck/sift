import { Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../src/db/connection";

export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://sift:sift-local-only@localhost:55432/sift_test";
export async function prepareTestDatabase() {
  const url = new URL(testDatabaseUrl);
  if (!url.pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to a dedicated database ending in _test.");
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.href });
  try {
    const name = url.pathname.slice(1);
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error("Invalid test database name.");
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) await admin.query(`CREATE DATABASE "${name}"`);
  } finally { await admin.end(); }
  const connection = connectDatabase(testDatabaseUrl);
  try {
    await migrate(connection.db, { migrationsFolder: "drizzle" });
    // Reset only auth throttle counters in the dedicated test database between runs.
    await connection.pool.query("TRUNCATE rate_limits");
  }
  finally { await connection.pool.end(); }
}
export default prepareTestDatabase;
