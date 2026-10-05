import { config } from "dotenv";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../src/db/connection";
config({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env.local before migrating.");
const { db, pool } = connectDatabase(process.env.DATABASE_URL);
try { await migrate(db, { migrationsFolder: "drizzle" }); console.log("Sift migrations applied."); }
finally { await pool.end(); }
