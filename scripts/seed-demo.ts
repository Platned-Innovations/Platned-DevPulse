/**
 * Manual seeding:  npm run seed
 * Loads fictional demo data into the configured database (safe to re-run; ids are deterministic).
 */
import { getStore } from "../src/lib/db";
import { seedDemoData } from "../src/lib/seed";

async function main() {
  const store = await getStore();
  const r = await seedDemoData(store);
  console.log(`Seeded ${r.repos} repositories, ${r.accounts} accounts, ${r.activities} activities into ${store.kind}.`);
  await store.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
