import postgres from "postgres";

/**
 * The ANALYST pool, HMR-safe.
 *
 * funder_ro: SELECT-only grants, role-level default_transaction_read_only,
 * role-level search_path = "internal, public" (which the unqualified example
 * queries in lib/ai/system-prompt.ts depend on), 15s statement timeout.
 *
 * This pool executes MODEL-GENERATED SQL — lib/ai/tools.ts runs
 * tx.unsafe(<model output>) here, and lib/ai/sql-guard.ts allows any `select`
 * with no schema restriction, naming funder_ro's grants as safety layer 3 of 4.
 * It therefore holds NO privileges in the community schema, not even USAGE, so
 * no model turn can reach a member row or an email address. Keep it that way:
 * `grant ... on schema community to funder_ro` would silently undo it.
 *
 * The read-only property is enforced at the ROLE (pg_roles.rolconfig), not by
 * the connection option below — deleting that line would not make writes work.
 *
 * Hand-written application queries that need to write live on communitySql
 * (lib/community/db.ts, role community_app). The two pools are split by WHO
 * AUTHORED THE SQL, not by read vs. write.
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
