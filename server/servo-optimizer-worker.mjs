const gainProfile = [1.0, 1.0, 0.85, 0.65, 0.45, 0.35];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function logUniform(rng, min, max) {
  const u = rng();
  return min * ((max / min) ** u);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCommandSamples() {
  return [
    {time: 0.0, joints: [0, -0.72, 1.28, 0, 1.02, 0]},
    {time: 0.7, joints: [0.22, -0.72, 1.28, 0, 1.02, 0]},
    {time: 1.4, joints: [-0.18, -0.72, 1.28, 0, 1.02, 0]},
    {time: 2.1, joints: [0, -0.48, 1.28, 0, 1.02, 0]},
    {time: 2.8, joints: [0, -0.94, 1.28, 0, 1.02, 0]},
    {time: 3.5, joints: [0, -0.72, 1.52, 0, 1.02, 0]},
    {time: 4.2, joints: [0, -0.72, 1.08, 0, 1.02, 0]},
    {time: 4.9, joints: [0, -0.72, 1.28, 0.18, 1.02, 0]},
    {time: 5.6, joints: [0, -0.72, 1.28, -0.18, 1.02, 0]},
    {time: 6.3, joints: [0, -0.72, 1.28, 0, 1.16, 0]},
    {time: 7.0, joints: [0, -0.72, 1.28, 0, 0.9, 0]},
    {time: 7.7, joints: [0, -0.72, 1.28, 0, 1.02, 0.28]},
    {time: 8.4, joints: [0, -0.72, 1.28, 0, 1.02, -0.28]},
    {time: 9.2, joints: [0, -0.72, 1.28, 0, 1.02, 0]},
  ];
}

function sampleCommand(samples, time) {
  const first = samples[0];
  if (time <= first.time) return first.joints;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const start = samples[index];
    const end = samples[index + 1];
    if (time <= end.time) {
      const alpha = clamp((time - start.time) / Math.max(end.time - start.time, 1e-6), 0, 1);
      return start.joints.map((value, jointIndex) => value + (end.joints[jointIndex] - value) * alpha);
    }
  }
  return samples[samples.length - 1].joints;
}

function evaluateCandidate(joints, objectiveWeights) {
  const samples = buildCommandSamples();
  const dt = 0.002;
  const duration = samples[samples.length - 1].time + 2.4;
  const holdStartTime = samples[samples.length - 1].time;
  const dynamicDuration = Math.max(holdStartTime, dt);
  const state = joints.map((joint, index) => ({
    q: sampleCommand(samples, 0)[index],
    dq: 0,
    integral: 0,
  }));

  let peakError = 0;
  let errorIntegral = 0;
  let peakVelocity = 0;
  let peakTorque = 0;
  let dynamicPeakError = 0;
  let dynamicPeakVelocityError = 0;
  let settleScore = 0;
  let unstable = false;
  let lastLargeErrorTime = 0;
  let oscillationPenalty = 0;
  let stabilityIntegral = 0;
  let dynamicErrorIntegral = 0;
  let dynamicVelocityErrorIntegral = 0;
  let dynamicLagPenalty = 0;
  let holdErrorIntegral = 0;
  let holdVelocityIntegral = 0;
  let holdTorqueIntegral = 0;
  let holdPeakError = 0;
  let holdPeakVelocity = 0;
  let holdPeakTorque = 0;
  let holdSignFlips = 0;
  let holdSampleCount = 0;
  const previousVelocitySigns = joints.map(() => 0);
  const holdVelocitySigns = joints.map(() => 0);

  for (let time = 0; time <= duration; time += dt) {
    const command = sampleCommand(samples, time);
    const inHoldWindow = time >= holdStartTime;
    const previousCommand = sampleCommand(samples, Math.max(0, time - dt));
    const nextCommand = sampleCommand(samples, Math.min(duration, time + dt));
    for (let index = 0; index < joints.length; index += 1) {
      const joint = joints[index];
      const axisScale = gainProfile[index];
      const inertia = 1.6 - index * 0.18;
      const passiveDamping = 11.5 + (5 - index) * 1.9;
      const staticFriction = 0.65 + axisScale * 0.55;
      const stateItem = state[index];
      const error = command[index] - stateItem.q;
      const velocityRef = inHoldWindow ? 0 : (command[index] - previousCommand[index]) / Math.max(dt, 1e-6);
      const accelRef =
        inHoldWindow ? 0 : (nextCommand[index] - 2 * command[index] + previousCommand[index]) / Math.max(dt * dt, 1e-6);
      const integralLimit = inHoldWindow ? 0.03 : 0.1;
      stateItem.integral = clamp(stateItem.integral + error * dt, -integralLimit, integralLimit);
      const effectiveKi = inHoldWindow ? joint.ki * 0.12 : joint.ki * 0.32;
      const effectiveKd = inHoldWindow ? joint.kd * 1.3 : joint.kd * 1.08;
      const previewTarget = inHoldWindow ? command[index] : command[index] + velocityRef * 0.032;
      const previewError = previewTarget - stateItem.q;
      const velocityError = velocityRef - stateItem.dq;
      const ffTorque = inertia * accelRef + passiveDamping * velocityRef + 2.5 * axisScale * command[index];
      const torque = joint.kp * previewError + effectiveKi * stateItem.integral + effectiveKd * velocityError + ffTorque;
      const clippedTorque = clamp(torque, joint.forcerange[0], joint.forcerange[1]);
      const frictionTorque =
        Math.abs(stateItem.dq) < 0.01 && Math.abs(clippedTorque) < staticFriction
          ? clippedTorque
          : Math.sign(stateItem.dq || clippedTorque || 1) * staticFriction;
      const qdd =
        (clippedTorque - frictionTorque - passiveDamping * stateItem.dq - 2.5 * axisScale * stateItem.q) /
        Math.max(0.25, inertia);
      stateItem.dq += qdd * dt;
      stateItem.q += stateItem.dq * dt;

      const absError = Math.abs(error);
      const absVelocity = Math.abs(stateItem.dq);
      const absTorque = Math.abs(clippedTorque);
      peakError = Math.max(peakError, absError);
      peakVelocity = Math.max(peakVelocity, absVelocity);
      peakTorque = Math.max(peakTorque, absTorque);
      errorIntegral += absError * dt;
      stabilityIntegral += (absVelocity * 0.35 + absError * 0.9) * dt;
      if (!inHoldWindow) {
        const absVelocityError = Math.abs(velocityError);
        dynamicErrorIntegral += absError * dt;
        dynamicVelocityErrorIntegral += absVelocityError * dt;
        dynamicPeakError = Math.max(dynamicPeakError, absError);
        dynamicPeakVelocityError = Math.max(dynamicPeakVelocityError, absVelocityError);
        dynamicLagPenalty += Math.max(0, absError - 0.02) * (1 + Math.abs(velocityRef) * 1.6 + Math.abs(accelRef) * 0.08) * dt;
      }
      const sign = absVelocity < 1e-4 ? 0 : Math.sign(stateItem.dq);
      if (previousVelocitySigns[index] !== 0 && sign !== 0 && sign !== previousVelocitySigns[index] && absError > 0.01) {
        oscillationPenalty += 1;
      }
      if (sign !== 0) previousVelocitySigns[index] = sign;
      if (inHoldWindow) {
        holdErrorIntegral += absError * dt;
        holdVelocityIntegral += absVelocity * dt;
        holdTorqueIntegral += absTorque * dt;
        holdPeakError = Math.max(holdPeakError, absError);
        holdPeakVelocity = Math.max(holdPeakVelocity, absVelocity);
        holdPeakTorque = Math.max(holdPeakTorque, absTorque);
        holdSampleCount += 1;
        if (holdVelocitySigns[index] !== 0 && sign !== 0 && sign !== holdVelocitySigns[index] && absError > 0.002) {
          holdSignFlips += 1;
        }
        if (sign !== 0) holdVelocitySigns[index] = sign;
      }
      if (absError > 0.03) lastLargeErrorTime = time;
      if (absError > 0.6 || absVelocity > 8 || !Number.isFinite(stateItem.q) || !Number.isFinite(stateItem.dq)) {
        unstable = true;
      }
    }
  }

  const meanError = errorIntegral / Math.max(duration, 1e-6);
  const dynamicMeanError = dynamicErrorIntegral / dynamicDuration;
  const dynamicMeanVelocityError = dynamicVelocityErrorIntegral / dynamicDuration;
  settleScore = duration - lastLargeErrorTime;
  const precisionTerm = dynamicMeanError * 240 + dynamicPeakError * 170 + meanError * 50 + peakError * 30 + dynamicLagPenalty * 180;
  const vibrationTerm = peakVelocity * 8 + dynamicMeanVelocityError * 70 + dynamicPeakVelocityError * 22;
  const energyTerm = peakTorque * 0.08;
  const cycleTerm = (duration - settleScore) * 8;
  const holdMeanError = holdErrorIntegral / Math.max(duration - holdStartTime, 1e-6);
  const holdMeanVelocity = holdVelocityIntegral / Math.max(duration - holdStartTime, 1e-6);
  const holdMeanTorque = holdTorqueIntegral / Math.max(duration - holdStartTime, 1e-6);
  const holdPenalty =
    holdMeanError * 260 +
    holdPeakError * 420 +
    holdMeanVelocity * 180 +
    holdPeakVelocity * 90 +
    holdSignFlips * 2.2 +
    holdMeanTorque * 0.08;
  const stabilityTerm = stabilityIntegral * 18 + oscillationPenalty * 1.6 + (duration - settleScore) * 10 + holdPenalty;
  const stabilityPenalty = unstable ? 500 : 0;
  const holdUnstablePenalty = holdPeakError > 0.012 || holdPeakVelocity > 0.2 ? 120 : 0;
  const torquePenalty = peakTorque > 0.92 * Math.max(...joints.map((joint) => Math.abs(joint.forcerange[1]))) ? 60 : 0;
  const score =
    precisionTerm * (objectiveWeights.precision / 100) +
    stabilityTerm * ((objectiveWeights.stability ?? 20) / 100) +
    vibrationTerm * (objectiveWeights.vibration / 100) +
    cycleTerm * (objectiveWeights.cycle / 100) +
    energyTerm * (objectiveWeights.energy / 100) +
    stabilityPenalty +
    holdUnstablePenalty +
    torquePenalty;

  return {
    score,
    metrics: {
      peakError,
      meanError,
      dynamicMeanError,
      dynamicPeakError,
      dynamicMeanVelocityError,
      dynamicPeakVelocityError,
      peakVelocity,
      peakTorque,
      settleTime: duration - settleScore,
      oscillationPenalty,
      stabilityIndex: stabilityTerm,
      holdMeanError,
      holdPeakError,
      holdMeanVelocity,
      holdPeakVelocity,
      holdMeanTorque,
      holdPeakTorque,
      stable: !unstable && holdPeakError < 0.012 && holdPeakVelocity < 0.2,
    },
  };
}

function buildCandidate(baseJoints, bestJoints, rng, trialIndex) {
  return baseJoints.map((joint, index) => {
    const anchor = bestJoints?.[index] ?? joint;
    const explore = trialIndex < 4 || !bestJoints;
    const kpFactor = explore ? logUniform(rng, 0.58, 1.85) : logUniform(rng, 0.88, 1.16);
    const kdFactor = explore ? logUniform(rng, 0.8, 2.1) : logUniform(rng, 0.92, 1.22);
    const kiFactor = explore ? logUniform(rng, 1e-6, 0.75) : logUniform(rng, 0.65, 1.05);
    const kp = clamp(anchor.kp * kpFactor, Math.max(80, joint.forcerange[1] * 0.32), joint.forcerange[1] * 1.9);
    const kd = clamp(anchor.kd * kdFactor, Math.max(12, joint.kd * 0.5), Math.max(joint.kd * 2.4, 24));
    const ki = clamp(anchor.ki * kiFactor, 0, Math.max(0.4, joint.ki * 1.6));
    return {...joint, kp: Math.round(kp), kd: Math.round(kd), ki: Number(ki.toFixed(2))};
  });
}

async function runWorker(payload) {
  const rng = mulberry32(payload.seed);
  let best = null;

  for (let trialOffset = 0; trialOffset < payload.trials; trialOffset += 1) {
    const trial = payload.trialStart + trialOffset + 1;
    const candidate = trialOffset === 0 && payload.initialJoints?.length ? payload.initialJoints : buildCandidate(payload.baseJoints, best?.joints ?? null, rng, trialOffset);
    const evaluation = evaluateCandidate(candidate, payload.objectiveWeights);
    if (!best || evaluation.score < best.score) {
      best = {trial, score: evaluation.score, joints: candidate, metrics: evaluation.metrics};
    }
    process.send?.({
      type: 'trial',
      workerId: payload.workerId,
      trial,
      total: payload.totalTrials,
      score: evaluation.score,
      metrics: evaluation.metrics,
      joints: candidate,
      isBest: best.trial === trial,
    });
  }

  process.send?.({type: 'done', workerId: payload.workerId, best});
}

process.on('message', (message) => {
  if (!message || message.type !== 'start') return;
  void runWorker(message.payload)
    .then(() => process.exit(0))
    .catch((error) => {
      process.send?.({type: 'error', workerId: message.payload?.workerId ?? 'worker', error: error instanceof Error ? error.message : String(error)});
      process.exit(1);
    });
});
