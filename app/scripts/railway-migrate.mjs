import { spawn } from "node:child_process";

const FAILED_MIGRATION_NAME = "20260125000000_add_llmcall_fk_constraints";

function run(cmd, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code) => {
      if (code === 0) return resolve();
      const err = new Error(`${cmd} ${args.join(" ")} exited with code ${code}`);
      if (allowFailure) return resolve(err);
      return reject(err);
    });

    child.on("error", (err) => {
      if (allowFailure) return resolve(err);
      reject(err);
    });
  });
}

// Railway can get "stuck" if a migration previously failed (P3009).
// We resolve it as rolled back (safe when it never applied) and then run deploy.
await run("npx", ["prisma", "migrate", "resolve", "--rolled-back", FAILED_MIGRATION_NAME], {
  allowFailure: true,
});

await run("npx", ["prisma", "migrate", "deploy"]);

