/**
 * Manual migration:  npm run migrate
 * Connects to the configured database (PostgreSQL or MongoDB) and creates/updates the schema.
 * Idempotent; the app also does this automatically at startup.
 */
import { getStore } from "../src/lib/db";

async function main() {
  const store = await getStore(); // init() creates tables / collections / indexes
  console.log(`Schema is up to date (${store.kind}).`);
  await store.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
