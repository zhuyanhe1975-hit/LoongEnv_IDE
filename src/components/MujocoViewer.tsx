import React from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

type MujocoModule = any;
type MujocoModel = any;
type MujocoData = any;

type LoadState = 'loading' | 'ready' | 'error';
type MujocoViewerProps = {
  sceneFile?: string;
  sceneXmlOverride?: string | null;
};
type ControlledJoint = {
  jointIndex: number;
  qposAdr: number;
  min: number;
  max: number;
  maxSpeed: number;
};

const MODEL_ROOT = '/models/';
const DEFAULT_SCENE_FILE = 'er15-1400.mjcf.xml';
const MUJOCO_JS_URL = 'https://unpkg.com/mujoco-js@0.0.7/dist/mujoco_wasm.js';
const MUJOCO_WASM_URL = 'https://unpkg.com/mujoco-js@0.0.7/dist/mujoco_wasm.wasm';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(current: number, target: number, alpha: number) {
  return current + (target - current) * alpha;
}

async function loadMujocoRuntime(): Promise<MujocoModule> {
  const imported = await import(/* @vite-ignore */ MUJOCO_JS_URL);
  const init = imported.default as (options?: Record<string, unknown>) => Promise<MujocoModule>;

  return init({
    locateFile: (path: string) => (path.endsWith('.wasm') ? MUJOCO_WASM_URL : path),
  });
}

function normalizeDependencyPath(baseFile: string, fileAttr: string, prefix = '') {
  const currentDir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/') + 1) : '';
  const raw = `${currentDir}${prefix}${fileAttr}`.replace(/\/+/g, '/');
  const parts = raw.split('/');
  const normalized: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }

  return normalized.join('/');
}

async function populateVirtualFileSystem(mujoco: MujocoModule, sceneFile: string, sceneXmlOverride?: string | null) {
  const parser = new DOMParser();
  const queued = [sceneFile];
  const downloaded = new Set<string>();

  try {
    mujoco.FS.mkdir('/working');
  } catch {
    // Ignore existing directory.
  }

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
        mujoco.FS.mkdir(currentPath);
      } catch {
        // Ignore existing directory.
      }
    }

    if (file.endsWith('.xml')) {
      const text =
        file === sceneFile && sceneXmlOverride
          ? sceneXmlOverride
          : await (async () => {
              const response = await fetch(`${MODEL_ROOT}${file}`);
              if (!response.ok) {
                throw new Error(`Failed to fetch ${file}: ${response.status} ${response.statusText}`);
              }
              return response.text();
            })();
      mujoco.FS.writeFile(targetPath, text);

      const xml = parser.parseFromString(text, 'text/xml');
      const compiler = xml.querySelector('compiler');
      const assetDir = compiler?.getAttribute('assetdir') || '';
      const meshDir = compiler?.getAttribute('meshdir') || assetDir;
      const textureDir = compiler?.getAttribute('texturedir') || assetDir;

      xml.querySelectorAll('[file]').forEach((element) => {
        const fileAttr = element.getAttribute('file');
        if (!fileAttr) return;

        let prefix = '';
        const tagName = element.tagName.toLowerCase();
        if (tagName === 'mesh' && meshDir) prefix = `${meshDir}/`;
        if ((tagName === 'texture' || tagName === 'hfield') && textureDir) prefix = `${textureDir}/`;

        const dependency = normalizeDependencyPath(file, fileAttr, prefix);
        if (!downloaded.has(dependency)) queued.push(dependency);
      });
    } else {
      const response = await fetch(`${MODEL_ROOT}${file}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${file}: ${response.status} ${response.statusText}`);
      }
      mujoco.FS.writeFile(targetPath, new Uint8Array(await response.arrayBuffer()));
    }
  }
}

function buildGeom(module: MujocoModule, model: MujocoModel, geomIndex: number) {
  if (model.geom_group?.[geomIndex] === 3) return null;

  const type = model.geom_type[geomIndex];
  const size = model.geom_size.subarray(geomIndex * 3, geomIndex * 3 + 3);
  const pos = model.geom_pos.subarray(geomIndex * 3, geomIndex * 3 + 3);
  const quat = model.geom_quat.subarray(geomIndex * 4, geomIndex * 4 + 4);
  const materialId = model.geom_matid[geomIndex];

  const rgba = materialId >= 0
    ? model.mat_rgba.subarray(materialId * 4, materialId * 4 + 4)
    : model.geom_rgba.subarray(geomIndex * 4, geomIndex * 4 + 4);

  const getEnumValue = (value: unknown) => (value as { value?: number })?.value ?? value;
  const geomTypes = module.mjtGeom;

  let geometry: THREE.BufferGeometry | null = null;

  if (type === getEnumValue(geomTypes.mjGEOM_PLANE)) {
    geometry = new THREE.PlaneGeometry(Math.max(size[0] * 2, 5), Math.max(size[1] * 2, 5));
  } else if (type === getEnumValue(geomTypes.mjGEOM_BOX)) {
    geometry = new THREE.BoxGeometry(size[0] * 2, size[1] * 2, size[2] * 2);
  } else if (type === getEnumValue(geomTypes.mjGEOM_SPHERE)) {
    geometry = new THREE.SphereGeometry(size[0], 24, 24);
  } else if (type === getEnumValue(geomTypes.mjGEOM_CYLINDER)) {
    geometry = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2, 24);
    geometry.rotateX(Math.PI / 2);
  } else if (type === getEnumValue(geomTypes.mjGEOM_CAPSULE)) {
    const radius = size[0];
    const halfLength = size[1];
    geometry = new THREE.CapsuleGeometry(radius, halfLength * 2, 10, 20);
    geometry.rotateX(Math.PI / 2);
  } else if (type === getEnumValue(geomTypes.mjGEOM_MESH)) {
    const meshId = model.geom_dataid[geomIndex];
    const vertexStart = model.mesh_vertadr[meshId];
    const vertexCount = model.mesh_vertnum[meshId];
    const faceStart = model.mesh_faceadr[meshId];
    const faceCount = model.mesh_facenum[meshId];

    geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(model.mesh_vert.subarray(vertexStart * 3, (vertexStart + vertexCount) * 3), 3),
    );
    geometry.setIndex(Array.from(model.mesh_face.subarray(faceStart * 3, (faceStart + faceCount) * 3)));
    geometry.computeVertexNormals();
  }

  if (!geometry) return null;

  geometry.computeVertexNormals();
  const isMeshGeom = type === getEnumValue(geomTypes.mjGEOM_MESH);

  let material: THREE.Material;

  if (!isMeshGeom) {
    const objectColor = new THREE.Color(rgba[0], rgba[1], rgba[2]);
    material = new THREE.MeshStandardMaterial({
      color: objectColor,
      transparent: rgba[3] < 1,
      opacity: rgba[3],
      roughness: 0.55,
      metalness: 0.08,
    });
  } else {
    const bodyId = model.geom_bodyid[geomIndex];
    const isDarkAccent =
      bodyId >= Math.max(1, model.nbody - 2) ||
      geomIndex >= Math.max(1, model.ngeom - 2);
    const isMidAccent = !isDarkAccent && (bodyId === 0 || bodyId === 1 || geomIndex % 5 === 0);
    const baseColor = isDarkAccent
      ? new THREE.Color('#20242b')
      : isMidAccent
        ? new THREE.Color('#d7dbe2')
        : new THREE.Color('#f4f4f1');

    material = new THREE.MeshPhysicalMaterial({
      color: baseColor.lerp(new THREE.Color(rgba[0], rgba[1], rgba[2]), rgba[3] < 0.999 ? 0.15 : 0.05),
      transparent: rgba[3] < 1,
      opacity: rgba[3],
      roughness: isDarkAccent ? 0.18 : 0.12,
      metalness: isDarkAccent ? 0.15 : 0.02,
      envMapIntensity: isDarkAccent ? 0.9 : 1.35,
      clearcoat: isDarkAccent ? 0.45 : 1,
      clearcoatRoughness: isDarkAccent ? 0.18 : 0.06,
      sheen: isDarkAccent ? 0 : 0.2,
      sheenColor: isDarkAccent ? new THREE.Color('#000000') : new THREE.Color('#fff8ee'),
      sheenRoughness: 0.3,
      emissive: isDarkAccent ? new THREE.Color('#040506') : new THREE.Color('#0a0a0a'),
      emissiveIntensity: isDarkAccent ? 0.015 : 0.006,
      side: THREE.DoubleSide,
    });
  }

  const mesh = new THREE.Mesh(
    geometry,
    material,
  );

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.quaternion.set(quat[1], quat[2], quat[3], quat[0]);

  return mesh;
}

const MujocoViewerInner: React.FC<MujocoViewerProps> = ({ sceneFile = DEFAULT_SCENE_FILE, sceneXmlOverride = null }) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [loadState, setLoadState] = React.useState<LoadState>('loading');
  const [statusText, setStatusText] = React.useState('正在初始化 MuJoCo WASM...');
  const [errorText, setErrorText] = React.useState<string | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let started = false;
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
    let stepAccumulator = 0;
    let motionClock = 0;
    let controlledJoints: ControlledJoint[] = [];
    let activeTargets: number[] = [];
    let pendingTargets: number[] = [];
    let nextTargetTime = 0;
    async function boot() {
      const container = containerRef.current;
      if (!container) return;
      if (started || container.clientWidth === 0 || container.clientHeight === 0) return;
      started = true;

      try {
        setLoadState('loading');
        setErrorText(null);
        setStatusText('正在初始化 MuJoCo WASM...');

        moduleInstance = await loadMujocoRuntime();
        if (disposed) return;

        setStatusText(`正在加载 ${sceneFile}...`);
        await populateVirtualFileSystem(moduleInstance, sceneFile, sceneXmlOverride);
        if (disposed) return;

        setStatusText('正在编译模型...');
        model = moduleInstance.MjModel.loadFromXML(`/working/${sceneFile}`);
        data = new moduleInstance.MjData(model);

        controlledJoints = Array.from({ length: model.njnt }, (_, jointIndex) => {
          const qposAdr = model.jnt_qposadr[jointIndex];
          const rangeMin = model.jnt_range[jointIndex * 2];
          const rangeMax = model.jnt_range[jointIndex * 2 + 1];
          const span = Math.max(0.1, rangeMax - rangeMin);

          return {
            jointIndex,
            qposAdr,
            min: rangeMin,
            max: rangeMax,
            maxSpeed: clamp(span * 0.28, 0.18, 0.95),
          };
        }).filter((joint) => Number.isFinite(joint.min) && Number.isFinite(joint.max));

        if (typeof model.nkey === 'number' && model.nkey > 0 && typeof moduleInstance.mj_resetDataKeyframe === 'function') {
          moduleInstance.mj_resetDataKeyframe(model, data, 0);
        }
        moduleInstance.mj_forward(model, data);

        activeTargets = controlledJoints.map((joint) => data.qpos[joint.qposAdr]);
        pendingTargets = [...activeTargets];
        nextTargetTime = 1.5;
        motionClock = 0;

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
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        pmremGenerator = new THREE.PMREMGenerator(renderer);
        envRenderTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.05);
        scene.environment = envRenderTarget.texture;

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
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

        const fillLight = new THREE.DirectionalLight(0xc9d6e6, 0.2);
        fillLight.position.set(-3.6, 2.4, 3.8);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0xe7edf7, 1.35);
        rimLight.position.set(-2.2, -3.8, 4.6);
        scene.add(rimLight);

        const topLight = new THREE.SpotLight(0xffffff, 5.4, 0, Math.PI / 7, 0.25, 0.95);
        topLight.position.set(0.8, 0.2, 7.6);
        topLight.castShadow = true;
        topLight.shadow.mapSize.set(2048, 2048);
        topLight.shadow.radius = 8;
        topLight.target.position.set(0.2, 0, 0.75);
        scene.add(topLight);
        scene.add(topLight.target);

        const frontAccent = new THREE.SpotLight(0xf8fbff, 1.5, 0, Math.PI / 8, 0.42, 1.15);
        frontAccent.position.set(3.6, -2.4, 2.8);
        frontAccent.target.position.set(0.25, 0, 0.85);
        scene.add(frontAccent);
        scene.add(frontAccent.target);

        const centerGlow = new THREE.PointLight(0xffffff, 0.7, 2.8, 2);
        centerGlow.position.set(0.2, 0, 1.2);
        scene.add(centerGlow);

        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(18, 18),
          new THREE.MeshStandardMaterial({
            color: '#454d56',
            roughness: 0.92,
            metalness: 0.02,
            envMapIntensity: 0.02,
          }),
        );
        floor.position.z = -0.03;
        floor.receiveShadow = true;
        scene.add(floor);

        const robotPad = new THREE.Mesh(
          new THREE.CircleGeometry(1.45, 48),
          new THREE.MeshStandardMaterial({
            color: '#2f3740',
            roughness: 0.78,
            metalness: 0.03,
            envMapIntensity: 0.04,
          }),
        );
        robotPad.position.set(0.2, 0, -0.018);
        scene.add(robotPad);

        const robotHighlight = new THREE.Mesh(
          new THREE.CircleGeometry(1.02, 48),
          new THREE.MeshBasicMaterial({
            color: '#d9dee5',
            transparent: true,
            opacity: 0.16,
          }),
        );
        robotHighlight.position.set(0.2, 0, -0.017);
        scene.add(robotHighlight);

        const aisleLineMaterial = new THREE.MeshBasicMaterial({ color: '#b8860b', transparent: true, opacity: 0.52 });
        const aisleLineA = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 10), aisleLineMaterial);
        aisleLineA.position.set(0, 0, -0.02);
        scene.add(aisleLineA);

        const aisleLineB = new THREE.Mesh(new THREE.PlaneGeometry(10, 0.08), aisleLineMaterial);
        aisleLineB.position.set(0, 0, -0.02);
        scene.add(aisleLineB);

        const workCellOutline = new THREE.Mesh(
          new THREE.RingGeometry(2.1, 2.18, 64),
          new THREE.MeshBasicMaterial({ color: '#9f7510', transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
        );
        workCellOutline.position.set(0.2, 0, -0.015);
        scene.add(workCellOutline);

        const grid = new THREE.GridHelper(18, 36, 0x444c56, 0x525b65);
        grid.rotation.x = Math.PI / 2;
        grid.position.z = -0.01;
        (grid.material as THREE.Material).transparent = true;
        (grid.material as THREE.Material).opacity = 0.1;
        scene.add(grid);

        const backWall = new THREE.Mesh(
          new THREE.PlaneGeometry(18, 6),
          new THREE.MeshStandardMaterial({
            color: '#3f4955',
            roughness: 0.95,
            metalness: 0.03,
            envMapIntensity: 0.03,
            side: THREE.DoubleSide,
          }),
        );
        backWall.position.set(0, 5.6, 2.5);
        backWall.rotation.x = Math.PI / 2;
        backWall.receiveShadow = true;
        scene.add(backWall);

        const sideWall = new THREE.Mesh(
          new THREE.PlaneGeometry(12, 6),
          new THREE.MeshStandardMaterial({
            color: '#37414c',
            roughness: 0.96,
            metalness: 0.02,
            envMapIntensity: 0.02,
            side: THREE.DoubleSide,
          }),
        );
        sideWall.position.set(-6, 0, 2.5);
        sideWall.rotation.y = Math.PI / 2;
        sideWall.receiveShadow = true;
        scene.add(sideWall);

        const bodies: THREE.Group[] = [];
        for (let bodyIndex = 0; bodyIndex < model.nbody; bodyIndex += 1) {
          const group = new THREE.Group();
          bodies.push(group);
          scene.add(group);
        }

        for (let geomIndex = 0; geomIndex < model.ngeom; geomIndex += 1) {
          const bodyId = model.geom_bodyid[geomIndex];
          const geom = buildGeom(moduleInstance, model, geomIndex);
          if (geom) bodies[bodyId].add(geom);
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
          if (disposed || !moduleInstance || !model || !data || !renderer || !controls) return;

          const now = performance.now();
          if (lastFrameTime === 0) {
            lastFrameTime = now;
          }

          const frameDeltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
          lastFrameTime = now;

          const simulationTimestep =
            typeof model.opt?.timestep === 'number' && model.opt.timestep > 0 ? model.opt.timestep : 1 / 60;
          stepAccumulator += frameDeltaSeconds;

          const maxStepsPerFrame = Math.max(1, Math.ceil(0.1 / simulationTimestep));
          let stepsThisFrame = 0;
          while (stepAccumulator >= simulationTimestep && stepsThisFrame < maxStepsPerFrame) {
            motionClock += simulationTimestep;

            if (motionClock >= nextTargetTime) {
              pendingTargets = controlledJoints.map((joint, index) => {
                const span = joint.max - joint.min;
                const safeMin = joint.min + span * 0.18;
                const safeMax = joint.max - span * 0.18;
                const randomTarget = safeMin + Math.random() * Math.max(0.01, safeMax - safeMin);
                return clamp(randomTarget, joint.min, joint.max);
              });
              nextTargetTime = motionClock + 2.5 + Math.random() * 2.5;
            }

            for (let index = 0; index < controlledJoints.length; index += 1) {
              const joint = controlledJoints[index];
              const currentQ = data.qpos[joint.qposAdr];
              activeTargets[index] = lerp(activeTargets[index], pendingTargets[index], 0.01);
              const positionError = activeTargets[index] - currentQ;
              const maxDelta = joint.maxSpeed * simulationTimestep;
              const nextQ = currentQ + clamp(positionError, -maxDelta, maxDelta);
              data.qpos[joint.qposAdr] = clamp(nextQ, joint.min, joint.max);
            }

            moduleInstance.mj_forward(model, data);
            stepAccumulator -= simulationTimestep;
            stepsThisFrame += 1;
          }

          for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex += 1) {
            const body = bodies[bodyIndex];
            body.position.set(data.xpos[bodyIndex * 3], data.xpos[bodyIndex * 3 + 1], data.xpos[bodyIndex * 3 + 2]);
            body.quaternion.set(
              data.xquat[bodyIndex * 4 + 1],
              data.xquat[bodyIndex * 4 + 2],
              data.xquat[bodyIndex * 4 + 3],
              data.xquat[bodyIndex * 4],
            );
          }

          controls.update();
          renderer.render(scene, camera);
          animationFrame = window.requestAnimationFrame(step);
        };

        setStatusText(`模型：${sceneFile}`);
        setLoadState('ready');
        step();

        return () => window.removeEventListener('resize', resize);
      } catch (error) {
        started = false;
        if (disposed) return;
        const message = error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
        console.error('MuJoCo viewer init error', error);
        setLoadState('error');
        setErrorText(message || 'Unknown MuJoCo initialization error');
        setStatusText('MuJoCo failed to initialize');
      }
    }

    const tryBoot = () => {
      const container = containerRef.current;
      if (!container || disposed || started) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        setStatusText('Waiting for viewer layout...');
        return;
      }
      void boot();
    };

    tryBoot();

    const container = containerRef.current;
    if (container && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        tryBoot();
      });
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
  }, [sceneFile, sceneXmlOverride]);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-xl border border-white/10 bg-[#020617]">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 pointer-events-none">
        <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${loadState === 'error' ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse'}`} />
          <span className="text-xs font-mono text-emerald-400 font-bold">MuJoCo WASM Engine</span>
        </div>
        <div className="bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
          <span className="text-xs font-mono text-muted">{statusText}</span>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 z-10 pointer-events-none">
        <div className="bg-black/60 backdrop-blur-md px-3 py-2 rounded-lg border border-white/10 flex flex-col gap-1">
          <span className="text-[10px] font-mono text-muted uppercase">物理状态</span>
          <span className="text-xs font-mono text-blue-400">{loadState === 'ready' ? '仿真运行中 + STL 可视化' : '正在准备场景'}</span>
          <span className="text-xs font-mono text-main">任务：ER15-1400 仿真</span>
        </div>
      </div>

      {loadState !== 'ready' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm">
          <div className="rounded-2xl border border-white/10 bg-black/60 px-5 py-4 text-center">
            <div className="text-sm font-semibold text-slate-100">{loadState === 'error' ? 'MuJoCo 加载失败' : '正在加载仿真'}</div>
            <div className="mt-2 max-w-[280px] text-xs font-mono text-slate-300">{errorText ?? statusText}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export const MujocoViewer = React.memo(MujocoViewerInner);
