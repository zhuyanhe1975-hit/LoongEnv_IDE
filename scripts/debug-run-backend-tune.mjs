import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const projectRoot = "D:\\AI\\loongenv";
const pythonExe = path.join(projectRoot, ".venv-backend", "Scripts", "python.exe");
const entryPy = path.join(projectRoot, "server", "python_backend", "entry.py");
const runtimeConfigPath = path.join(projectRoot, "config", "loongenv-runtime.json");

const runtimeConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"));
const modelXmlPath = path.join(projectRoot, "public", "models", "er15-1400.mjcf.xml");
const modelXml = fs.readFileSync(modelXmlPath, "utf8");

const payload = {
  job_id: "debug-local-tune",
  task_type: "tune_controller",
  scene_prompt: "debug local tune",
  task_prompt: "validate backend mjwarp tune",
  objective_prompt: "static stable and dynamic tracking",
  scene_xml: modelXml,
  objective_weights: { precision: 28, stability: 28, vibration: 22, cycle: 14, energy: 8 },
  controller_gains: runtimeConfig.servo.baseline,
  ff_mode: runtimeConfig.backend_control.ff_mode,
  computed_torque: runtimeConfig.backend_control.computed_torque,
  ideal_actuation: runtimeConfig.backend_control.ideal_actuation,
  jobs: 1,
  rounds: 1,
  trials_per_round: 1,
  seed: 1234,
};

const child = spawn(pythonExe, [entryPy], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    LOONGENV_BACKEND_SITE_PACKAGES: path.join(projectRoot, ".venv-backend", "Lib", "site-packages"),
  },
  stdio: ["pipe", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => process.stdout.write(chunk));
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

child.stdin.write(JSON.stringify(payload));
child.stdin.end();
