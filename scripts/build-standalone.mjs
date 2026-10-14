// Builds the standalone server and assembles a deployable folder: dist/
//   cd dist && npm start      (or: node start.cjs)
// Self-contained: its package.json starts the bundled server, not the Next.js CLI.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Azure (Oryx) and `npm start` read package.json: point start at the bundled server and keep only
// runtime dependencies, so an Azure-side `npm install` (if it runs) also yields a working app.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync(
  "dist/package.json",
  JSON.stringify({ name: pkg.name, version: pkg.version, private: true, scripts: { start: "node start.cjs" }, dependencies: pkg.dependencies, engines: pkg.engines }, null, 2) + "\n",
);

// Azure sets HOSTNAME to the container's own name, which makes the standalone server bind to the
// wrong interface. Force 0.0.0.0 (all interfaces) and default PORT to Azure's 8080.
writeFileSync(
  "dist/start.cjs",
  `process.env.HOSTNAME = "0.0.0.0";\nprocess.env.PORT = process.env.PORT || "8080";\nrequire("./server.js");\n`,
);
console.log("Standalone build ready in ./dist  ->  cd dist && npm start");
