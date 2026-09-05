import { spawn } from "node:child_process";
import { join } from "node:path";

const child = spawn(process.execPath, [join(".next", "standalone", "server.js")], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
  },
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
