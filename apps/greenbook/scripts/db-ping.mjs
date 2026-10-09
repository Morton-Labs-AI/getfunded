import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 10,
  connection: {
    application_name: "ofdb-ping",
    default_transaction_read_only: "on",
    statement_timeout: "10000",
  },
});

const t0 = performance.now();
const [totals] = await sql`select * from internal.mv_overview_totals`;
const ms = Math.round(performance.now() - t0);
console.log(`ok ${ms}ms —`, {
  orgs: totals.orgs,
  events: totals.events,
  people: totals.people,
});

// read-only proof: this must FAIL
try {
  await sql`create table _write_probe (id int)`;
  console.error("WRITE SUCCEEDED — read-only enforcement is BROKEN");
  process.exit(1);
} catch (e) {
  console.log("read-only enforced:", e.message.slice(0, 60));
}
await sql.end();
