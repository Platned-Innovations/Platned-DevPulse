/** Starts the background sync scheduler once when the Node server boots. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./src/lib/scheduler");
  startScheduler();
}
