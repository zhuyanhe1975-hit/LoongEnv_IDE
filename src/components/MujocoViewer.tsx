import React from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type MujocoModule = any;
type MujocoModel = any;
type MujocoData = any;

type LoadState = 'loading' | 'ready' | 'error';

const MODEL_ROOT = `${import.meta.env.BASE_URL}models/`;
const SCENE_FILE = 'er15-1400.mjcf.xml';
const MUJOCO_JS_URL = 'https://unpkg.com/mujoco-js@0.0.7/dist/mujoco_wasm.js';
const MUJOCO_WASM_URL = 'https://unpkg.com/mujoco-js@0.0.7/dist/mujoco_wasm.wasm';

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

async function populateVirtualFileSystem(mujoco: MujocoModule, sceneFile: string) {
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

    const response = await fetch(`${MODEL_ROOT}${file}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${file}: ${response.status} ${response.statusText}`);
    }

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
      const text = await response.text();
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

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(rgba[0], rgba[1], rgba[2]),
      transparent: rgba[3] < 1,
      opacity: rgba[3],
      roughness: 0.6,
      metalness: 0.2,
      side: THREE.DoubleSide,
    }),
  );

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.quaternion.set(quat[1], quat[2], quat[3], quat[0]);

  return mesh;
}

const MujocoViewerInner: React.FC = () => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [loadState, setLoadState] = React.useState<LoadState>('loading');
  const [statusText, setStatusText] = React.useState('Initializing MuJoCo WASM...');
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
    async function boot() {
      const container = containerRef.current;
      if (!container) return;
      if (started || container.clientWidth === 0 || container.clientHeight === 0) return;
      started = true;

      try {
        setLoadState('loading');
        setErrorText(null);
        setStatusText('Initializing MuJoCo WASM...');

        moduleInstance = await loadMujocoRuntime();
        if (disposed) return;

        setStatusText(`Loading ${SCENE_FILE}...`);
        await populateVirtualFileSystem(moduleInstance, SCENE_FILE);
        if (disposed) return;

        setStatusText('Compiling model...');
        model = moduleInstance.MjModel.loadFromXML(`/working/${SCENE_FILE}`);
        data = new moduleInstance.MjData(model);

        if (typeof model.nkey === 'number' && model.nkey > 0 && typeof moduleInstance.mj_resetDataKeyframe === 'function') {
          moduleInstance.mj_resetDataKeyframe(model, data, 0);
        }
        moduleInstance.mj_forward(model, data);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#0f172a');

        const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 100);
        camera.position.set(2.4, -1.8, 1.9);
        camera.up.set(0, 0, 1);
        camera.lookAt(0.3, 0, 0.7);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0.3, 0, 0.7);
        controls.minDistance = 1;
        controls.maxDistance = 8;

        scene.add(new THREE.AmbientLight(0xffffff, 0.65));

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
        keyLight.position.set(4, -2, 6);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.6);
        fillLight.position.set(-3, 3, 3);
        scene.add(fillLight);

        const grid = new THREE.GridHelper(6, 24, 0x38bdf8, 0x1e293b);
        grid.rotation.x = Math.PI / 2;
        grid.position.z = -0.001;
        scene.add(grid);

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

          moduleInstance.mj_step(model, data);

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

        setStatusText(`Model: ${SCENE_FILE}`);
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
      renderer?.dispose();
      renderer?.domElement.remove();
      data?.delete?.();
      model?.delete?.();
    };
  }, []);

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
          <span className="text-[10px] font-mono text-muted uppercase">Physics State</span>
          <span className="text-xs font-mono text-blue-400">{loadState === 'ready' ? 'Simulation Running + STL Visuals' : 'Preparing Scene'}</span>
          <span className="text-xs font-mono text-main">Task: ER15-1400 Simulation</span>
        </div>
      </div>

      {loadState !== 'ready' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm">
          <div className="rounded-2xl border border-white/10 bg-black/60 px-5 py-4 text-center">
            <div className="text-sm font-semibold text-slate-100">{loadState === 'error' ? 'MuJoCo Load Failed' : 'Loading Simulation'}</div>
            <div className="mt-2 max-w-[280px] text-xs font-mono text-slate-300">{errorText ?? statusText}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export const MujocoViewer = React.memo(MujocoViewerInner);
