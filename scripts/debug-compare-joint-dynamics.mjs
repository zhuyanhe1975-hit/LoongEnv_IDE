import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const projectRoot = "D:\\AI\\loongenv";
const pythonExe = path.join(projectRoot, ".venv-backend", "Scripts", "python.exe");
const entryPy = path.join(projectRoot, "server", "python_backend", "entry.py");
const runtimeConfigPath = path.join(projectRoot, "config", "loongenv-runtime.json");
const modelXmlPath = path.join(projectRoot, "public", "models", "er15-1400.mjcf.xml");

const originalConfigText = fs.readFileSync(runtimeConfigPath, "utf8");
const originalConfig = JSON.parse(originalConfigText);
const modelXml = fs.readFileSync(modelXmlPath, "utf8");

const industrialDynamics = {
  joint_1: { damping: 8.0, frictionloss: 3.2, armature: 0.08 },
  joint_2: { damping: 9.0, frictionloss: 3.6, armature: 0.08 },
  joint_3: { damping: 8.5, frictionloss: 3.0, armature: 0.07 },
  joint_4: { damping: 2.8, frictionloss: 0.9, armature: 0.02 },
  joint_5: { damping: 2.0, frictionloss: 0.5, armature: 0.015 },
  joint_6: { damping: 0.8, frictionloss: 0.18, armature: 0.006 },
};

const scenarios = [
  { name: "no_dynamics", joint_dynamics: {} },
  { name: "current_dynamics", joint_dynamics: originalConfig.physics?.joint_dynamics ?? {} },
  { name: "industrial_dynamics", joint_dynamics: industrialDynamics },
];

function runTune(payload) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
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

    child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`python exit ${code}\n${stderr.join("")}\n${stdout.join("")}`));
        return;
      }
      const text = stdout.join("").trim();
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error(`failed to parse stdout as JSON\n${text}\n${String(error)}`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function main() {
  const results = {};
  try {
    for (const scenario of scenarios) {
      const patchedConfig = JSON.parse(originalConfigText);
      patchedConfig.physics = patchedConfig.physics ?? {};
      patchedConfig.physics.joint_dynamics = scenario.joint_dynamics;
      fs.writeFileSync(runtimeConfigPath, `${JSON.stringify(patchedConfig, null, 2)}\n`, "utf8");

      const payload = {
        job_id: `debug-compare-${scenario.name}`,
        task_type: "tune_controller",
        scene_prompt: "debug compare dynamics",
        task_prompt: scenario.name,
        objective_prompt: "compare pure robot tuning dynamics",
        scene_xml: modelXml,
        objective_weights: { precision: 28, stability: 28, vibration: 22, cycle: 14, energy: 8 },
        controller_gains: originalConfig.servo.baseline,
        ff_mode: originalConfig.backend_control.ff_mode,
        computed_torque: originalConfig.backend_control.computed_torque,
        ideal_actuation: originalConfig.backend_control.ideal_actuation,
        jobs: 1,
        rounds: 1,
        trials_per_round: 1,
        seed: 1234,
      };

      const result = await runTune(payload);
      results[scenario.name] = {
        joint_dynamics: scenario.joint_dynamics,
        metrics: result?.result?.metrics ?? result?.metrics ?? null,
      };
    }
  } finally {
    fs.writeFileSync(runtimeConfigPath, originalConfigText, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        control_mode: originalConfig.backend_control,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
