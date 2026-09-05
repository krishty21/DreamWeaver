import { spawn } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [nextBin, "build"], {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=4096"]
        .filter(Boolean)
        .join(" "),
    },
  });
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    if (code === 0) resolve(undefined);
    else reject(new Error(signal ? `next build exited with ${signal}` : `next build exited with ${code}`));
  });
});

const standaloneDir = join(root, ".next", "standalone");
await mkdir(join(standaloneDir, ".next"), { recursive: true });
await cp(join(root, ".next", "static"), join(standaloneDir, ".next", "static"), {
  recursive: true,
  force: true,
});
await cp(join(root, "public"), join(standaloneDir, "public"), {
  recursive: true,
  force: true,
});
