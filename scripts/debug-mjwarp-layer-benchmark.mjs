import path from "node:path";
import {spawn} from "node:child_process";

const projectRoot = "D:\\AI\\loongenv";
const pythonExe = path.join(projectRoot, ".venv-backend", "Scripts", "python.exe");
const scriptPy = path.join(projectRoot, "scripts", "debug-mjwarp-layer-benchmark.py");

const child = spawn(
  pythonExe,
  [
    scriptPy,
    "--device",
    "cuda:0",
    "--world-count",
    "8192",
    "--steps",
    "1000",
    "--modes",
    "step_only,inverse_only,step_inverse,step_inverse_control",
    "--capture",
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      LOONGENV_BACKEND_SITE_PACKAGES: path.join(projectRoot, ".venv-backend", "Lib", "site-packages"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

child.stdout.on("data", (chunk) => process.stdout.write(chunk));
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
