import postgres from "postgres";

/**
 * Single connection pool, HMR-safe. The entire app is read-only at the
 * session level (default_transaction_read_only) with a hard statement
 * timeout — hand-written queries and AI-generated queries alike.
 */
const globalForDb = globalThis as unknown as {
  ofdbSql?: ReturnType<typeof postgres>;
};

export const sql =
  globalForDb.ofdbSql ??
  postgres(process.env.DATABASE_URL!, {
    max: 6,
    idle_timeout: 30,
    connect_timeout: 10,
    connection: {
      application_name: "open-funder-db-ui",
      default_transaction_read_only: true,
      statement_timeout: 15000,
    },
  });

if (process.env.NODE_ENV !== "production") globalForDb.ofdbSql = sql;
