/** Runs once when the Node server boots: prepare the database, first sync if empty, start the scheduler. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootstrap } = await import("./src/lib/bootstrap");
  const { firstSync } = await bootstrap();
  const { startScheduler } = await import("./src/lib/scheduler");
  startScheduler({ skipInitial: firstSync });
}
