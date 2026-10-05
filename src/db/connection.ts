import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Executor = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;

export function connectDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 20000, connectionTimeoutMillis: 10000 });
  // Connection errors must not dump URLs or credentials to the application log.
  pool.on("error", () => console.error(JSON.stringify({ event: "database.connection_error" })));
  return { db: drizzle(pool, { schema }), pool };
}
