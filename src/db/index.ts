import "server-only";
import { requireConfig } from "@/lib/env";
import { connectDatabase } from "./connection";

const globalDatabase = globalThis as unknown as { siftDatabase?: ReturnType<typeof connectDatabase> };
export function database() {
  if (!globalDatabase.siftDatabase) globalDatabase.siftDatabase = connectDatabase(requireConfig(["DATABASE_URL"]).DATABASE_URL);
  return globalDatabase.siftDatabase.db;
}
