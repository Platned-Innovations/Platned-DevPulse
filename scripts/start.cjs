// Production start that does not depend on node_modules/.bin (missing or Windows-style shims on Azure
// are what produce "sh: next: not found"). Resolves Next.js through Node's module lookup, which also
// honours NODE_PATH as set by Azure's Oryx.
//   npm start        -> node scripts/start.cjs
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const port = process.env.PORT || "8080";
let bin;
try {
  bin = require.resolve("next/dist/bin/next");
} catch {
  console.error(
    "[devpulse] The 'next' package is not installed here.\n" +
      "  - Azure: deploy the contents of the standalone bundle (npm run build:standalone -> dist/), not the source tree.\n" +
      "  - Elsewhere: run 'npm ci && npm run build' first.",
  );
  process.exit(1);
}
if (!fs.existsSync(path.join(process.cwd(), ".next"))) {
  console.error("[devpulse] No production build found (.next). Run 'npm run build' first, or deploy the standalone bundle.");
  process.exit(1);
}
const child = spawn(process.execPath, [bin, "start", "-H", "0.0.0.0", "-p", port], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => child.kill(sig));
