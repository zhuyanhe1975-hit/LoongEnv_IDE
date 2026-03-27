import React from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

type MujocoModule = any;
type MujocoModel = any;
type MujocoData = any;

export type ViewerJointTelemetry = {
  name: string;
  position: number;
  velocity: number;
  torque: number;
  error: number;
};

export type ViewerRuntimeStatus = {
  phase: string;
  collisionActiveCount: number;
  lastCollisionPair: string;
  joints: ViewerJointTelemetry[];
};

export type ViewerReplayBodyPose = {
  name: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];
};

export type ViewerReplayFrame = {
  time: number;
  phase: string;
  collisionActiveCount: number;
  lastCollisionPair: string;
  joints: ViewerJointTelemetry[];
  bodyPoses?: ViewerReplayBodyPose[];
};

export type ViewerReplay = {
  duration: number;
  playback_fps?: number;
  frames: ViewerReplayFrame[];
};

type TrajectorySample = {
  time: number;
  joints: [number, number, number, number, number, number];
  suction: boolean;
  label: string;
};

type ViewerTrajectoryPlan = {
  pickupBoxId: string | null;
  samples: TrajectorySample[];
  controller?: string;
  gripperMode?: string;
  duration?: number;
};

type ViewerServoJointConfig = {
  name: string;
  kp: number;
  ki: number;
  kd: number;
  forcerange: [number, number];
};

type MujocoViewerProps = {
  sceneFile?: string;
  sceneXmlOverride?: string | null;
  trajectoryPlan?: ViewerTrajectoryPlan | null;
  servoConfig?: ViewerServoJointConfig[];
  replay?: ViewerReplay | null;
  onStatusUpdate?: (status: ViewerRuntimeStatus) => void;
};

type ControlledJoint = {
  name: string;
  qposAdr: number;
  qvelAdr: number;
  min: number;
  max: number;
};

type LoadState = 'loading' | 'ready' | 'error';

const MODEL_ROOT = '/models/';
const DEFAULT_SCENE_FILE = 'er15-1400.mjcf.xml';
const MUJOCO_JS_URL = 'https://unpkg.com/mujoco-js@0.0.7/dist/mujoco_wasm.js';
const MUJOCO_WASM_URL = 'https://unpkg.com/mujoco-js@0.0.7/dist/mujoco_wasm.wasm';
const EMPTY_STATUS: ViewerRuntimeStatus = { phase: '待机', collisionActiveCount: 0, lastCollisionPair: '-', joints: [] };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readMjName(module: MujocoModule, namesPtr: number, adr: number) {
  if (!Number.isFinite(namesPtr) || !Number.isFinite(adr) || adr < 0) return '';
  return module.UTF8ToString(namesPtr + adr);
}

function readMjObjectName(module: MujocoModule, model: MujocoModel, objectKey: 'mjOBJ_BODY' | 'mjOBJ_JOINT', objectId: number, adr?: number) {
  const enumValue = (module.mjtObj?.[objectKey] as { value?: number } | number | undefined);
  const resolvedEnum = typeof enumValue === 'object' ? enumValue?.value : enumValue;
  if (typeof module.mj_id2name === 'function' && Number.isFinite(resolvedEnum) && objectId >= 0) {
    const resolvedName = module.mj_id2name(model, resolvedEnum, objectId);
    if (resolvedName) return resolvedName;
  }
  return readMjName(module, model.names, adr ?? -1);
}

function buildControlledJoints(
  moduleInstance: MujocoModule,
  model: MujocoModel,
  replay: ViewerReplay | null | undefined,
) {
  const replayJointNames = replay?.frames?.[0]?.joints?.map((joint) => joint.name).filter(Boolean) ?? [];
  if (replayJointNames.length > 0) {
    const mapped = replayJointNames
      .map((jointName) => {
        const jointTypeValue = moduleInstance.mjtObj?.mjOBJ_JOINT;
        const jointType = typeof jointTypeValue === 'object' ? jointTypeValue?.value : jointTypeValue;
        const jointId =
          typeof moduleInstance.mj_name2id === 'function' && Number.isFinite(jointType)
            ? moduleInstance.mj_name2id(model, jointType, jointName)
            : -1;
        if (!Number.isFinite(jointId) || jointId < 0) return null;
        const qposAdr = model.jnt_qposadr?.[jointId] ?? -1;
        const qvelAdr = model.jnt_dofadr?.[jointId] ?? -1;
        if (qposAdr < 0 || qvelAdr < 0) return null;
        return {
          name: jointName,
          qposAdr,
          qvelAdr,
          min: model.jnt_range?.[jointId * 2] ?? -Infinity,
          max: model.jnt_range?.[jointId * 2 + 1] ?? Infinity,
        } satisfies ControlledJoint;
      })
      .filter((joint): joint is ControlledJoint => Boolean(joint));
    if (mapped.length > 0) return mapped;
  }

  return Array.from({ length: model.nu }, (_, index) => {
    const actuatorJointId = model.actuator_trnid?.[index * 2];
    const jointId = Number.isFinite(actuatorJointId) && actuatorJointId >= 0 ? actuatorJointId : index;
    return {
      name: readMjObjectName(moduleInstance, model, 'mjOBJ_JOINT', jointId, model.name_jntadr?.[jointId]) || `joint_${index + 1}`,
      qposAdr: model.jnt_qposadr[jointId],
      qvelAdr: model.jnt_dofadr[jointId],
      min: model.jnt_range[jointId * 2],
      max: model.jnt_range[jointId * 2 + 1],
    };
  });
}

async function loadMujocoRuntime(): Promise<MujocoModule> {
  const imported = await import(/* @vite-ignore */ MUJOCO_JS_URL);
  return imported.default({
    locateFile: (path: string) => (path.endsWith('.wasm') ? MUJOCO_WASM_URL : path),
  });
}

function normalizeDependencyPath(baseFile: string, fileAttr: string, prefix = '') {
  const currentDir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/') + 1) : '';
  const parts = `${currentDir}${prefix}${fileAttr}`.replace(/\/+/g, '/').split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') normalized.pop();
    else normalized.push(part);
  }
  return normalized.join('/');
}

async function populateVirtualFileSystem(module: MujocoModule, sceneFile: string, sceneXmlOverride?: string | null) {
  const parser = new DOMParser();
  const queued = [sceneFile];
  const downloaded = new Set<string>();

  try {
    module.FS.mkdir('/working');
  } catch {}

  while (queued.length > 0) {
    const file = queued.shift()!;
    if (downloaded.has(file)) continue;
    downloaded.add(file);

    const targetPath = `/working/${file}`;
    const pathParts = file.split('/');
    pathParts.pop();
    let currentPath = '/working';
    for (const part of pathParts) {
      currentPath += `/${part}`;
      try {
        module.FS.mkdir(currentPath);
      } catch {}
    }

    if (file.endsWith('.xml')) {
      const text = file === sceneFile && sceneXmlOverride ? sceneXmlOverride : await (await fetch(`${MODEL_ROOT}${file}`)).text();
      module.FS.writeFile(targetPath, text);
      const xml = parser.parseFromString(text, 'text/xml');
      const compiler = xml.querySelector('compiler');
      const assetDir = compiler?.getAttribute('assetdir') || '';
      const meshDir = compiler?.getAttribute('meshdir') || assetDir;
      const textureDir = compiler?.getAttribute('texturedir') || assetDir;
      xml.querySelectorAll('[file]').forEach((element) => {
        const fileAttr = element.getAttribute('file');
        if (!fileAttr) return;
        const tagName = element.tagName.toLowerCase();
        const prefix =
          tagName === 'mesh' && meshDir
            ? `${meshDir}/`
            : (tagName === 'texture' || tagName === 'hfield') && textureDir
              ? `${textureDir}/`
              : '';
        const dependency = normalizeDependencyPath(file, fileAttr, prefix);
        if (!downloaded.has(dependency)) queued.push(dependency);
      });
    } else {
      module.FS.writeFile(targetPath, new Uint8Array(await (await fetch(`${MODEL_ROOT}${file}`)).arrayBuffer()));
    }
  }
}

function buildGeom(module: MujocoModule, model: MujocoModel, geomIndex: number) {
  if (model.geom_group?.[geomIndex] === 3) return null;

  const type = model.geom_type[geomIndex];
  const size = model.geom_size.subarray(geomIndex * 3, geomIndex * 3 + 3);
  const pos = model.geom_pos.subarray(geomIndex * 3, geomIndex * 3 + 3);
  const quat = model.geom_quat.subarray(geomIndex * 4, geomIndex * 4 + 4);
  const rgba = model.geom_rgba.subarray(geomIndex * 4, geomIndex * 4 + 4);
  const getEnumValue = (value: unknown) => (value as { value?: number })?.value ?? value;
  const geomTypes = module.mjtGeom;

  let geometry: THREE.BufferGeometry | null = null;
  if (type === getEnumValue(geomTypes.mjGEOM_PLANE)) geometry = new THREE.PlaneGeometry(Math.max(size[0] * 2, 5), Math.max(size[1] * 2, 5));
  else if (type === getEnumValue(geomTypes.mjGEOM_BOX)) geometry = new THREE.BoxGeometry(size[0] * 2, size[1] * 2, size[2] * 2);
  else if (type === getEnumValue(geomTypes.mjGEOM_SPHERE)) geometry = new THREE.SphereGeometry(size[0], 24, 24);
  else if (type === getEnumValue(geomTypes.mjGEOM_CYLINDER)) {
    geometry = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2, 24);
    geometry.rotateX(Math.PI / 2);
  } else if (type === getEnumValue(geomTypes.mjGEOM_CAPSULE)) {
    geometry = new THREE.CapsuleGeometry(size[0], size[1] * 2, 10, 20);
    geometry.rotateX(Math.PI / 2);
  } else if (type === getEnumValue(geomTypes.mjGEOM_MESH)) {
    const meshId = model.geom_dataid[geomIndex];
    const vertexStart = model.mesh_vertadr[meshId];
    const vertexCount = model.mesh_vertnum[meshId];
    const faceStart = model.mesh_faceadr[meshId];
    const faceCount = model.mesh_facenum[meshId];
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(model.mesh_vert.subarray(vertexStart * 3, (vertexStart + vertexCount) * 3), 3));
    geometry.setIndex(Array.from(model.mesh_face.subarray(faceStart * 3, (faceStart + faceCount) * 3)));
  }

  if (!geometry) return null;
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(rgba[0], rgba[1], rgba[2]),
      transparent: rgba[3] < 1,
      opacity: rgba[3],
      roughness: 0.35,
      metalness: 0.05,
    }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.quaternion.set(quat[1], quat[2], quat[3], quat[0]);
  return mesh;
}

function sampleReplayFrame(replay: ViewerReplay | null | undefined, timeValue: number) {
  if (!replay?.frames?.length) return null;
  if (timeValue <= replay.frames[0].time) return replay.frames[0];
  for (let index = 0; index < replay.frames.length - 1; index += 1) {
    const start = replay.frames[index];
    const end = replay.frames[index + 1];
    if (timeValue <= end.time) {
      const alpha = clamp((timeValue - start.time) / Math.max(end.time - start.time, 1e-6), 0, 1);
      return {
        ...start,
        time: timeValue,
        phase: alpha < 0.5 ? start.phase : end.phase,
        collisionActiveCount: alpha < 0.5 ? start.collisionActiveCount : end.collisionActiveCount,
        lastCollisionPair: alpha < 0.5 ? start.lastCollisionPair : end.lastCollisionPair,
        joints: start.joints.map((joint, jointIndex) => {
          const nextJoint = end.joints[jointIndex] ?? joint;
          return {
            name: joint.name,
            position: joint.position + (nextJoint.position - joint.position) * alpha,
            velocity: joint.velocity + (nextJoint.velocity - joint.velocity) * alpha,
            torque: joint.torque + (nextJoint.torque - joint.torque) * alpha,
            error: joint.error + (nextJoint.error - joint.error) * alpha,
          };
        }),
        bodyPoses: alpha < 0.5 ? start.bodyPoses : end.bodyPoses,
      } satisfies ViewerReplayFrame;
    }
  }
  return replay.frames[replay.frames.length - 1];
}

const MujocoViewerInner: React.FC<MujocoViewerProps> = ({
  sceneFile = DEFAULT_SCENE_FILE,
  sceneXmlOverride = null,
  trajectoryPlan = null,
  servoConfig,
  replay = null,
  onStatusUpdate,
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [loadState, setLoadState] = React.useState<LoadState>('loading');
  const [statusText, setStatusText] = React.useState('正在加载后端回放播放器...');
  const [errorText, setErrorText] = React.useState<string | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let model: MujocoModel | null = null;
    let data: MujocoData | null = null;
    let animationFrame = 0;
    let moduleInstance: MujocoModule | null = null;
    let cleanupResize: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let pmremGenerator: THREE.PMREMGenerator | null = null;
    let envRenderTarget: THREE.WebGLRenderTarget | null = null;
    let lastFrameTime = 0;
    let playbackTime = 0;
    let lastTelemetryUpdate = 0;
    let controlledJoints: ControlledJoint[] = [];
    const bodyGroups: THREE.Group[] = [];
    const freejointQposByBodyName = new Map<string, number>();

    async function boot() {
      const container = containerRef.current;
      if (!container || container.clientWidth === 0 || container.clientHeight === 0) return;

      try {
        setLoadState('loading');
        setErrorText(null);
        setStatusText('正在装载后端场景...');
        onStatusUpdate?.(EMPTY_STATUS);

        moduleInstance = await loadMujocoRuntime();
        if (disposed) return;
        await populateVirtualFileSystem(moduleInstance, sceneFile, sceneXmlOverride);
        if (disposed) return;
        model = moduleInstance.MjModel.loadFromXML(`/working/${sceneFile}`);
        data = new moduleInstance.MjData(model);
        if (typeof model.nkey === 'number' && model.nkey > 0 && typeof moduleInstance.mj_resetDataKeyframe === 'function') {
          moduleInstance.mj_resetDataKeyframe(model, data, 0);
        }
        moduleInstance.mj_forward(model, data);

        controlledJoints = buildControlledJoints(moduleInstance, model, replay);

        for (let bodyIndex = 0; bodyIndex < model.nbody; bodyIndex += 1) {
          const bodyName = readMjObjectName(moduleInstance, model, 'mjOBJ_BODY', bodyIndex, model.name_bodyadr?.[bodyIndex]);
          const jointAdr = model.body_jntadr?.[bodyIndex] ?? -1;
          if (jointAdr >= 0) {
            const qposAdr = model.jnt_qposadr?.[jointAdr] ?? -1;
            if (qposAdr >= 0) freejointQposByBodyName.set(bodyName, qposAdr);
          }
        }

        const firstFrame = replay?.frames?.[0];
        if (firstFrame) {
          firstFrame.joints.forEach((joint, index) => {
            const controlled = controlledJoints[index];
            if (!controlled) return;
            data.qpos[controlled.qposAdr] = clamp(joint.position, controlled.min, controlled.max);
            data.qvel[controlled.qvelAdr] = joint.velocity;
          });
          firstFrame.bodyPoses?.forEach((pose) => {
            const qposAdr = freejointQposByBodyName.get(pose.name);
            if (qposAdr === undefined) return;
            data.qpos[qposAdr] = pose.position[0];
            data.qpos[qposAdr + 1] = pose.position[1];
            data.qpos[qposAdr + 2] = pose.position[2];
            data.qpos[qposAdr + 3] = pose.quaternion[0];
            data.qpos[qposAdr + 4] = pose.quaternion[1];
            data.qpos[qposAdr + 5] = pose.quaternion[2];
            data.qpos[qposAdr + 6] = pose.quaternion[3];
          });
          moduleInstance.mj_forward(model, data);
        } else if (trajectoryPlan?.samples?.length) {
          const initial = trajectoryPlan.samples[0];
          controlledJoints.forEach((joint, index) => {
            data.qpos[joint.qposAdr] = clamp(initial.joints[index] ?? 0, joint.min, joint.max);
            data.qvel[joint.qvelAdr] = 0;
          });
          moduleInstance.mj_forward(model, data);
        }

        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#1c2430');
        scene.fog = new THREE.Fog('#242d38', 6, 15);

        const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 100);
        camera.position.set(2.4, -1.8, 1.9);
        camera.up.set(0, 0, 1);
        camera.lookAt(0.3, 0, 0.7);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.88;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.domElement.style.pointerEvents = 'auto';
        renderer.domElement.style.touchAction = 'none';
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        pmremGenerator = new THREE.PMREMGenerator(renderer);
        envRenderTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.05);
        scene.environment = envRenderTarget.texture;

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.enablePan = true;
        controls.enableRotate = true;
        controls.enableZoom = true;
        controls.target.set(0.3, 0, 0.7);
        controls.minDistance = 1;
        controls.maxDistance = 8;

        scene.add(new THREE.AmbientLight(0xcfd8e3, 0.08));
        const keyLight = new THREE.DirectionalLight(0xffffff, 4.2);
        keyLight.position.set(2.8, -1.6, 6.6);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(2048, 2048);
        keyLight.shadow.radius = 6;
        keyLight.target.position.set(0.2, 0, 0.9);
        scene.add(keyLight);
        scene.add(keyLight.target);

        const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.MeshStandardMaterial({ color: '#454d56', roughness: 0.92, metalness: 0.02 }));
        floor.position.z = -0.03;
        floor.receiveShadow = true;
        scene.add(floor);

        const grid = new THREE.GridHelper(18, 36, 0x444c56, 0x525b65);
        grid.rotation.x = Math.PI / 2;
        grid.position.z = -0.01;
        (grid.material as THREE.Material).transparent = true;
        (grid.material as THREE.Material).opacity = 0.1;
        scene.add(grid);

        for (let bodyIndex = 0; bodyIndex < model.nbody; bodyIndex += 1) {
          const group = new THREE.Group();
          bodyGroups.push(group);
          scene.add(group);
        }
        for (let geomIndex = 0; geomIndex < model.ngeom; geomIndex += 1) {
          const bodyId = model.geom_bodyid[geomIndex];
          const geom = buildGeom(moduleInstance, model, geomIndex);
          if (geom) bodyGroups[bodyId].add(geom);
        }

        const resize = () => {
          if (!renderer) return;
          camera.aspect = container.clientWidth / Math.max(container.clientHeight, 1);
          camera.updateProjectionMatrix();
          renderer.setSize(container.clientWidth, container.clientHeight);
        };
        window.addEventListener('resize', resize);
        cleanupResize = () => window.removeEventListener('resize', resize);
        resize();

        const step = () => {
          if (disposed || !renderer || !controls || !moduleInstance || !model || !data) return;

          const now = performance.now();
          if (lastFrameTime === 0) lastFrameTime = now;
          const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
          lastFrameTime = now;

          if (replay?.frames?.length) {
            const activeReplayDuration =
              typeof trajectoryPlan?.duration === 'number' && Number.isFinite(trajectoryPlan.duration) && trajectoryPlan.duration > 0
                ? Math.min(replay.duration, trajectoryPlan.duration)
                : replay.duration;
            if (activeReplayDuration > 0) {
              playbackTime = (playbackTime + deltaSeconds) % activeReplayDuration;
            } else {
              playbackTime = 0;
            }
            const frame = sampleReplayFrame(replay, playbackTime);
            if (frame) {
              frame.joints.forEach((joint, index) => {
                const controlled = controlledJoints[index];
                if (!controlled) return;
                data.qpos[controlled.qposAdr] = clamp(joint.position, controlled.min, controlled.max);
                data.qvel[controlled.qvelAdr] = joint.velocity;
              });
              frame.bodyPoses?.forEach((pose) => {
                const qposAdr = freejointQposByBodyName.get(pose.name);
                if (qposAdr === undefined) return;
                data.qpos[qposAdr] = pose.position[0];
                data.qpos[qposAdr + 1] = pose.position[1];
                data.qpos[qposAdr + 2] = pose.position[2];
                data.qpos[qposAdr + 3] = pose.quaternion[0];
                data.qpos[qposAdr + 4] = pose.quaternion[1];
                data.qpos[qposAdr + 5] = pose.quaternion[2];
                data.qpos[qposAdr + 6] = pose.quaternion[3];
              });
              moduleInstance.mj_forward(model, data);
              if (now - lastTelemetryUpdate >= 120) {
                onStatusUpdate?.({
                  phase: frame.phase,
                  collisionActiveCount: frame.collisionActiveCount,
                  lastCollisionPair: frame.lastCollisionPair,
                  joints: frame.joints,
                });
                lastTelemetryUpdate = now;
              }
            }
          } else if (now - lastTelemetryUpdate >= 200) {
            onStatusUpdate?.(EMPTY_STATUS);
            lastTelemetryUpdate = now;
          }

          for (let bodyIndex = 0; bodyIndex < bodyGroups.length; bodyIndex += 1) {
            const body = bodyGroups[bodyIndex];
            body.position.set(data.xpos[bodyIndex * 3], data.xpos[bodyIndex * 3 + 1], data.xpos[bodyIndex * 3 + 2]);
            body.quaternion.set(data.xquat[bodyIndex * 4 + 1], data.xquat[bodyIndex * 4 + 2], data.xquat[bodyIndex * 4 + 3], data.xquat[bodyIndex * 4]);
            body.updateMatrixWorld();
          }

          controls.update();
          renderer.render(scene, camera);
          animationFrame = window.requestAnimationFrame(step);
        };

        setStatusText(replay?.frames?.length ? '后端回放加载完成' : `模型：${sceneFile}`);
        setLoadState('ready');
        step();
      } catch (error) {
        const message = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
        setLoadState('error');
        setErrorText(message || 'Unknown backend playback initialization error');
        setStatusText('后端回放播放器初始化失败');
      }
    }

    const tryBoot = () => {
      const container = containerRef.current;
      if (!container || disposed) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        setStatusText('等待视图布局完成...');
        return;
      }
      void boot();
    };

    tryBoot();
    const container = containerRef.current;
    if (container && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => tryBoot());
      resizeObserver.observe(container);
    }

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      cleanupResize?.();
      controls?.dispose();
      envRenderTarget?.dispose();
      pmremGenerator?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
      data?.delete?.();
      model?.delete?.();
    };
  }, [sceneFile, sceneXmlOverride, trajectoryPlan, servoConfig, replay, onStatusUpdate]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-white/10 bg-[#020617]">
      <div ref={containerRef} className="absolute inset-0" />
      {loadState !== 'ready' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm">
          <div className="rounded-2xl border border-white/10 bg-black/60 px-5 py-4 text-center">
            <div className="text-sm font-semibold text-slate-100">{loadState === 'error' ? '回放加载失败' : '正在加载回放'}</div>
            <div className="mt-2 max-w-[280px] text-xs font-mono text-slate-300">{errorText ?? statusText}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export const MujocoViewer = React.memo(MujocoViewerInner);
