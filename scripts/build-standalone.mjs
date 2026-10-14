// Builds the standalone server and assembles a deployable folder: dist/
//   dist/server.js  (run with `node server.js`; honours PORT and HOSTNAME)
import { cpSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const run = spawnSync("npx next build", {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_OUTPUT: "standalone" },
});
if (run.status !== 0) process.exit(run.status ?? 1);

rmSync("dist", { recursive: true, force: true });
cpSync(".next/standalone", "dist", { recursive: true });
cpSync(".next/static", "dist/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", "dist/public", { recursive: true });
console.log("Standalone build ready in ./dist  ->  cd dist && node server.js");
