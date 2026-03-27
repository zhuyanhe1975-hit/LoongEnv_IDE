import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const projectRoot = "D:\\AI\\loongenv";
const pythonExe = path.join(projectRoot, ".venv-backend", "Scripts", "python.exe");
const entryPy = path.join(projectRoot, "server", "python_backend", "entry.py");
const runtimeConfigPath = path.join(projectRoot, "config", "loongenv-runtime.json");
const outputDir = path.join(projectRoot, "logs", "plots");
const outputSvg = path.join(outputDir, "joint2-stiction-torque.svg");
const outputJson = path.join(outputDir, "joint2-stiction-torque.json");

fs.mkdirSync(outputDir, { recursive: true });

const runtimeConfig = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8"));
const payload = {
  job_id: "debug-joint2-stiction",
  task_type: "diagnose_controller",
  scene_prompt: "debug joint2 stiction",
  task_prompt: "probe joint_2 reversal friction",
  objective_prompt: "diagnostic replay only",
  scene_xml: "",
  objective_weights: { precision: 30, stability: 30, vibration: 20, cycle: 10, energy: 10 },
  controller_gains: runtimeConfig.servo.baseline,
  ff_mode: runtimeConfig.backend_control.ff_mode,
  computed_torque: runtimeConfig.backend_control.computed_torque,
  ideal_actuation: runtimeConfig.backend_control.ideal_actuation,
  trajectory_hint: "joint2_stiction_probe",
  jobs: 1,
  rounds: 1,
  trials_per_round: 1,
  seed: 1234,
};

function parseLines(buffer, onLine) {
  let pending = "";
  buffer.on("data", (chunk) => {
    pending += chunk.toString("utf8");
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) onLine(trimmed);
    }
  });
  buffer.on("end", () => {
    const trimmed = pending.trim();
    if (trimmed) onLine(trimmed);
  });
}

function extent(values) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];
  if (Math.abs(max - min) < 1e-9) {
    return [min - 1, max + 1];
  }
  return [min, max];
}

function scaleX(value, min, max, left, width) {
  const alpha = (value - min) / Math.max(1e-9, max - min);
  return left + alpha * width;
}

function scaleY(value, min, max, top, height) {
  const alpha = (value - min) / Math.max(1e-9, max - min);
  return top + height - alpha * height;
}

function buildPath(series, minX, maxX, minY, maxY, left, top, width, height, valueKey) {
  return series
    .map((sample, index) => {
      const x = scaleX(sample.time, minX, maxX, left, width);
      const y = scaleY(sample[valueKey], minY, maxY, top, height);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderSvg(series) {
  const width = 1400;
  const height = 820;
  const margin = { left: 90, right: 40, top: 50, bottom: 80 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = 320;
  const lowerTop = 450;

  const times = series.map((sample) => sample.time);
  const [minX, maxX] = extent(times);
  const torqueValues = series.flatMap((sample) => [sample.torque, sample.inverseTorque, sample.passiveTorque, sample.constraintTorque]);
  const [minTorque, maxTorque] = extent(torqueValues);
  const [minVel, maxVel] = extent(series.map((sample) => sample.velocity));

  const zeroTorqueY = scaleY(0, minTorque, maxTorque, margin.top, plotHeight);
  const zeroVelY = scaleY(0, minVel, maxVel, lowerTop, plotHeight - 40);

  const torquePath = buildPath(series, minX, maxX, minTorque, maxTorque, margin.left, margin.top, plotWidth, plotHeight, "torque");
  const inversePath = buildPath(series, minX, maxX, minTorque, maxTorque, margin.left, margin.top, plotWidth, plotHeight, "inverseTorque");
  const passivePath = buildPath(series, minX, maxX, minTorque, maxTorque, margin.left, margin.top, plotWidth, plotHeight, "passiveTorque");
  const constraintPath = buildPath(series, minX, maxX, minTorque, maxTorque, margin.left, margin.top, plotWidth, plotHeight, "constraintTorque");
  const velocityPath = buildPath(series, minX, maxX, minVel, maxVel, margin.left, lowerTop, plotWidth, plotHeight - 40, "velocity");

  const zeroCrossings = [];
  for (let index = 1; index < series.length; index += 1) {
    const prev = series[index - 1];
    const curr = series[index];
    if (prev.velocity === 0 || curr.velocity === 0 || prev.velocity * curr.velocity < 0) {
      zeroCrossings.push(curr.time);
    }
  }

  const crossingLines = zeroCrossings
    .map((time) => {
      const x = scaleX(time, minX, maxX, margin.left, plotWidth);
      return `<line x1="${x.toFixed(2)}" y1="${margin.top}" x2="${x.toFixed(2)}" y2="${height - margin.bottom}" stroke="#f59e0b" stroke-dasharray="6 6" stroke-width="1.5" opacity="0.7"/>`;
    })
    .join("");

  const xTicks = 9;
  const xTickLabels = Array.from({ length: xTicks }, (_, index) => minX + ((maxX - minX) * index) / (xTicks - 1))
    .map((value) => {
      const x = scaleX(value, minX, maxX, margin.left, plotWidth);
      return `
        <line x1="${x.toFixed(2)}" y1="${height - margin.bottom}" x2="${x.toFixed(2)}" y2="${height - margin.bottom + 6}" stroke="#7c8aa5"/>
        <text x="${x.toFixed(2)}" y="${height - margin.bottom + 24}" text-anchor="middle" fill="#9fb1ce" font-size="12">${value.toFixed(1)}s</text>
      `;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0f172a"/>
  <text x="${margin.left}" y="30" fill="#e2e8f0" font-size="24" font-family="Segoe UI, sans-serif">joint_2 reversal torque probe</text>
  <text x="${margin.left}" y="56" fill="#94a3b8" font-size="13" font-family="Segoe UI, sans-serif">Applied torque vs inverse torque vs passive torque. Orange dashed lines mark velocity reversals.</text>

  <rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="#111827" stroke="#334155"/>
  <line x1="${margin.left}" y1="${zeroTorqueY.toFixed(2)}" x2="${margin.left + plotWidth}" y2="${zeroTorqueY.toFixed(2)}" stroke="#475569" stroke-dasharray="4 4"/>
  ${crossingLines}
  <path d="${torquePath}" fill="none" stroke="#22c55e" stroke-width="2.5"/>
  <path d="${inversePath}" fill="none" stroke="#38bdf8" stroke-width="2.0"/>
  <path d="${passivePath}" fill="none" stroke="#f43f5e" stroke-width="2.0"/>
  <path d="${constraintPath}" fill="none" stroke="#f59e0b" stroke-width="2.0"/>

  <text x="${margin.left}" y="${margin.top - 12}" fill="#cbd5e1" font-size="16" font-family="Segoe UI, sans-serif">Torque (Nm)</text>
  <text x="${margin.left + 10}" y="${margin.top + 24}" fill="#22c55e" font-size="12">applied</text>
  <text x="${margin.left + 90}" y="${margin.top + 24}" fill="#38bdf8" font-size="12">inverse</text>
  <text x="${margin.left + 165}" y="${margin.top + 24}" fill="#f43f5e" font-size="12">passive</text>
  <text x="${margin.left + 240}" y="${margin.top + 24}" fill="#f59e0b" font-size="12">constraint</text>

  <rect x="${margin.left}" y="${lowerTop}" width="${plotWidth}" height="${plotHeight - 40}" fill="#111827" stroke="#334155"/>
  <line x1="${margin.left}" y1="${zeroVelY.toFixed(2)}" x2="${margin.left + plotWidth}" y2="${zeroVelY.toFixed(2)}" stroke="#475569" stroke-dasharray="4 4"/>
  <path d="${velocityPath}" fill="none" stroke="#f8fafc" stroke-width="2"/>
  <text x="${margin.left}" y="${lowerTop - 12}" fill="#cbd5e1" font-size="16" font-family="Segoe UI, sans-serif">Joint velocity (rad/s)</text>
  <text x="${margin.left + 10}" y="${lowerTop + 24}" fill="#f8fafc" font-size="12">joint_2 velocity</text>

  <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${margin.left + plotWidth}" y2="${height - margin.bottom}" stroke="#64748b"/>
  ${xTickLabels}
</svg>`;
}

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

let completed = null;
parseLines(child.stdout, (line) => {
  process.stdout.write(`${line}\n`);
  try {
    const event = JSON.parse(line);
    if (event.event === "completed") {
      completed = event;
    }
  } catch {
    // ignore non-json lines
  }
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

child.on("exit", (code) => {
  if (code !== 0 || !completed?.result?.replay?.frames?.length) {
    process.exitCode = code ?? 1;
    return;
  }

  const frames = completed.result.replay.frames;
  const joint2 = frames
    .map((frame) => {
      const joint = frame.joints.find((item) => item.name === "joint_2");
      if (!joint) return null;
      return {
        time: Number(frame.time),
        torque: Number(joint.torque ?? 0),
        inverseTorque: Number(joint.inverseTorque ?? 0),
        passiveTorque: Number(joint.passiveTorque ?? 0),
        constraintTorque: Number(joint.constraintTorque ?? 0),
        velocity: Number(joint.velocity ?? 0),
        error: Number(joint.error ?? 0),
      };
    })
    .filter(Boolean);

  fs.writeFileSync(outputJson, JSON.stringify(joint2, null, 2), "utf8");
  fs.writeFileSync(outputSvg, renderSvg(joint2), "utf8");
  console.log(JSON.stringify({ outputSvg, outputJson, points: joint2.length }));
});

child.stdin.write(JSON.stringify(payload));
child.stdin.end();
