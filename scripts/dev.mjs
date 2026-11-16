// `npm run dev`: run the server (with reload) and the Vite dev server together.
import { spawn } from "node:child_process";
import { styleText } from "node:util";

const procs = [
  ["server", "cyan", ["run", "dev:server"]],
  ["web", "magenta", ["run", "dev:web"]],
].map(([name, color, args]) => {
  const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const prefix = styleText(color, `${name.padEnd(6)}│ `);
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop();
      for (const line of lines) process.stdout.write(prefix + line + "\n");
    });
  }
  child.on("exit", (code) => {
    console.log(prefix + `exited (${code})`);
    shutdown();
  });
  return child;
});

function shutdown() {
  for (const p of procs) if (p.exitCode === null) p.kill("SIGINT");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
