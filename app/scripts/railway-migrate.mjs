import { spawn } from "node:child_process";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code) => {
      if (code === 0) return resolve();
      return reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });

    child.on("error", reject);
  });
}

// Run prisma migrate deploy to apply any pending migrations
await run("npx", ["prisma", "migrate", "deploy"]);
