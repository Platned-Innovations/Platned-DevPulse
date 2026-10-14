// Builds the standalone server and assembles a deployable folder: dist/
//   cd dist && npm start      (or: node start.cjs)
// Self-contained: its package.json starts the bundled server, not the Next.js CLI.
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const run = spawnSync("npx next build", {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_OUTPUT: "standalone" },
});
if (run.status !== 0) process.exit(run.status ?? 1);

rmSync("dist", { recursive: true, force: true });
// dereference: Turbopack reaches pg/mongodb through symlinks such as .next/node_modules/pg-<hash>. Symlinks do not
// survive a zip upload (and a local build makes them absolute paths), so copy the real folders instead.
cpSync(".next/standalone", "dist", { recursive: true, dereference: true });
cpSync(".next/static", "dist/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", "dist/public", { recursive: true });

// Next copies local .env files into the standalone output. They hold secrets and must never be deployed:
// configuration comes from the host's application settings.
for (const name of readdirSync("dist")) if (name.startsWith(".env")) rmSync(`dist/${name}`);

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
// Kudu reads this from the package root: skip the server-side npm install/build (it is already built).
// On small plans that install is the single biggest CPU and disk cost.
writeFileSync("dist/.deployment", ["[config]", "SCM_DO_BUILD_DURING_DEPLOYMENT=false", ""].join("\n"));
// Fallback for hosts where the copy above cannot follow those links (for example a Windows build): replace each
// ".next/node_modules/<package>-<hash>" link with a real copy of dist/node_modules/<package>.
const aliasDir = "dist/.next/node_modules";
if (existsSync(aliasDir)) {
  for (const name of readdirSync(aliasDir)) {
    const p = `${aliasDir}/${name}`;
    const m = /^(.+)-[0-9a-f]{16}$/.exec(name);
    if (m && lstatSync(p).isSymbolicLink()) {
      rmSync(p, { recursive: true, force: true });
      cpSync(`dist/node_modules/${m[1]}`, p, { recursive: true, dereference: true });
    }
  }
}

// Fail the build (not the deployed site) if any symlink is left in the bundle.
const links = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`;
    const st = lstatSync(p);
    if (st.isSymbolicLink()) links.push(p);
    else if (st.isDirectory()) walk(p);
  }
};
walk("dist");
if (links.length) {
  console.error(["Symlinks found in dist (they would break after upload):", ...links.slice(0, 10)].join("\n  "));
  process.exit(1);
}
console.log("Standalone build ready in ./dist  ->  cd dist && npm start");
