import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { BoardLayout } from './layout';
import { applyBoardViewport, boardLayout } from './layout';
import { loadModel } from './assets';

export type ScatterLayer = {
  pass: RenderPass;
  update?(elapsed: number, motion: boolean): void;
  resize(width: number, height: number, visible: boolean): void;
};

/**
 * Renderer, lighting, board mesh and the frame that maps the board into `#board-frame`.
 * Gameplay and dice plug in after the board has loaded.
 */
export async function createStage(host: HTMLElement, boardFrame: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 100);
  camera.position.set(0, 12, 8.3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const titleCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  const backdrop = new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    uniforms: { time: { value: 0 }, aspect: { value: 1 }, title: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `varying vec2 vUv; uniform float time; uniform float aspect; uniform float title;
    void main(){
      vec2 p=(vUv-.5)*vec2(aspect,1.); float t=time*.065;
      vec2 q=p;
      for(int i=1;i<4;i++){float f=float(i);q+=.12/f*vec2(sin(q.y*5.*f+t*f),cos(q.x*4.*f-t));}
      float wave=sin(q.x*6.+q.y*8.+sin(q.y*5.-t)*2.+t);
      float stripe=smoothstep(.18,.65,wave);
      float blue=smoothstep(-.7,-.25,wave)*(1.-stripe);
      vec3 c=vec3(.013,.024,.052);
      c=mix(c,vec3(.038,.105,.22),blue*.86);
      c=mix(c,vec3(.33,.018,.048),stripe*.9);
      gl_FragColor=vec4(c,1.-title);
    }`,
  });
  const background = new THREE.Scene();
  background.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backdrop));
  const backgroundCamera = new THREE.Camera();

  scene.add(new THREE.HemisphereLight(0xffefd2, 0x242139, 2.2));
  const key = new THREE.DirectionalLight(0xffedce, 3.2);
  key.position.set(-3, 9, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x789ffe, 1.1);
  rim.position.set(4, 4, -4);
  scene.add(rim);
  const red = new THREE.PointLight(0xff334b, 14, 20, 2);
  red.position.set(-5, 2, 2);
  scene.add(red);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(background, backgroundCamera));
  const boardPass = new RenderPass(scene, camera);
  boardPass.clear = false;
  composer.addPass(boardPass);
  composer.addPass(new OutputPass());
  const retro = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      time: { value: 0 },
      resolution: { value: new THREE.Vector2() },
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform vec2 resolution; varying vec2 vUv;
    void main(){
      vec3 c=texture2D(tDiffuse,vUv).rgb;
      float grain=fract(sin(dot(floor(vUv*resolution),vec2(12.9898,78.233))+floor(time*12.))*43758.5453)-.5;
      c+=grain*.027;
      c*=1.-.022*(.5+.5*sin(vUv.y*resolution.y*3.14159));
      vec2 p=(vUv-.5)*1.25; c*=1.-.24*dot(p,p);
      gl_FragColor=vec4(c,texture2D(tDiffuse,vUv).a);
    }`,
  });
  composer.addPass(retro);

  const gltf = await loadModel('Board');
  const board = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(board);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  // Source GLB is Y-up. Keep its geometry and embedded materials.
  board.position.sub(center);
  const root = new THREE.Group();
  root.add(board);
  root.scale.setScalar(10 / Math.max(size.x, size.z));
  scene.add(root);

  const shadow = contactShadow();
  shadow.position.y = (-size.y * root.scale.x) / 2 - 0.18;
  scene.add(shadow);

  const layout: BoardLayout = { depth: 1, stackSlots: 5 };
  let home: { group: THREE.Group; update(dt: number, active: boolean): void } | undefined;
  let scatter: ScatterLayer | undefined;
  let waitingScatter: ScatterLayer | undefined;
  let onLayout: (() => void) | undefined;

  function resize() {
    const frame = boardFrame.getBoundingClientRect();
    const width = frame.width;
    const height = frame.height;
    const aspect = width / height;
    const title = document.body.classList.contains('on-title');
    const portrait = matchMedia('(max-aspect-ratio: 1/1)').matches;
    Object.assign(layout, boardLayout(portrait, title, aspect));
    const waiting = document.body.classList.contains('is-waiting');
    const showBoard = !waiting && !(title && portrait);
    board.visible = showBoard;
    shadow.visible = showBoard;
    board.scale.z = layout.depth;
    shadow.scale.y = layout.depth;
    onLayout?.();
    root.updateMatrixWorld(true);

    const worldBounds = new THREE.Box3().setFromObject(board);
    const projected = new THREE.Box3();
    for (const x of [worldBounds.min.x, worldBounds.max.x])
      for (const y of [worldBounds.min.y, worldBounds.max.y])
        for (const z of [worldBounds.min.z, worldBounds.max.z])
          projected.expandByPoint(
            new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse),
          );

    const halfHeight = title
      ? (projected.max.x - projected.min.x) / 2 / aspect / 0.9
      : Math.max(
          (projected.max.y - projected.min.y) / 2 / (portrait ? 0.96 : 0.82),
          (projected.max.x - projected.min.x) / 2 / aspect / 0.94,
        ) + 0.08;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = title
      ? projected.max.y + 0.25
      : portrait
        ? (projected.max.y + projected.min.y) / 2 + halfHeight
        : halfHeight - 0.6;
    camera.bottom = title || portrait ? camera.top - 2 * halfHeight : -halfHeight - 0.6;
    camera.updateProjectionMatrix();

    const screenWidth = host.clientWidth;
    const screenHeight = host.clientHeight;
    scatter?.resize(screenWidth, screenHeight, title && portrait && !waiting);
    waitingScatter?.resize(screenWidth, screenHeight, waiting);
    if (waiting)
      renderer.domElement.setAttribute(
        'aria-label',
        'Decorative original Plakoto dice and checkers',
      );
    if (title && !portrait) {
      // A lower viewing angle makes the home-screen board read as a laid-back table.
      // Extend the near edge beyond the viewport so the board fills both lower corners.
      titleCamera.aspect = aspect;
      const direction = new THREE.Vector3(0, 0.55, 0.835).normalize();
      const halfWidth = (worldBounds.max.x - worldBounds.min.x) / 2;
      const halfDepth = (worldBounds.max.z - worldBounds.min.z) / 2;
      const distance =
        halfWidth / (Math.tan(THREE.MathUtils.degToRad(17.5)) * aspect * 1.7) +
        halfDepth * direction.z;
      titleCamera.position.copy(direction.multiplyScalar(distance));
      titleCamera.lookAt(0, 0, 0);
      titleCamera.updateMatrixWorld();
      titleCamera.updateProjectionMatrix();
      let topEdge = -Infinity;
      for (const x of [worldBounds.min.x, worldBounds.max.x])
        for (const y of [worldBounds.min.y, worldBounds.max.y])
          for (const z of [worldBounds.min.z, worldBounds.max.z])
            topEdge = Math.max(topEdge, new THREE.Vector3(x, y, z).project(titleCamera).y);
      titleCamera.projectionMatrix.premultiply(
        new THREE.Matrix4().makeTranslation(0, 0.86 - topEdge, 0),
      );
      applyBoardViewport(titleCamera, frame, screenWidth, screenHeight);
      boardPass.camera = titleCamera;
    } else {
      applyBoardViewport(camera, frame, screenWidth, screenHeight);
      boardPass.camera = camera;
    }
    renderer.setSize(screenWidth, screenHeight);
    composer.setSize(screenWidth, screenHeight);
    backdrop.uniforms.aspect.value = screenWidth / screenHeight;
    backdrop.uniforms.title.value = title ? 1 : 0;
    retro.uniforms.resolution.value.set(
      screenWidth * renderer.getPixelRatio(),
      screenHeight * renderer.getPixelRatio(),
    );
  }

  return {
    root,
    center,
    camera,
    canvas: renderer.domElement,
    layout,
    attachHome(next: NonNullable<typeof home>) {
      home = next;
      scene.add(next.group);
    },
    attachScatter(next: ScatterLayer) {
      scatter = next;
      composer.insertPass(next.pass, 2);
    },
    attachWaiting(next: ScatterLayer) {
      waitingScatter = next;
      composer.insertPass(next.pass, 2);
    },
    /** Start framing. `onLayout` runs after the board scale changes and before the camera fit. */
    mount(layoutHook: () => void) {
      onLayout = layoutHook;
      window.addEventListener('resize', resize);
      new ResizeObserver(resize).observe(boardFrame);
      resize();
    },
    render(elapsed: number, motion: boolean, texture: boolean, dt: number) {
      backdrop.uniforms.time.value = elapsed;
      retro.uniforms.time.value = elapsed;
      const desktopHome =
        document.body.classList.contains('on-title') &&
        !document.body.classList.contains('is-waiting') &&
        !matchMedia('(max-aspect-ratio: 1/1)').matches;
      root.position.y = motion && !desktopHome ? Math.sin(elapsed * 0.65) * 0.035 : 0;
      home?.update(dt, desktopHome && motion);
      if (scatter?.pass.enabled) scatter.update?.(elapsed, motion);
      if (waitingScatter?.pass.enabled) waitingScatter.update?.(elapsed, motion);
      retro.enabled = texture;
      composer.render();
    },
    setLoop(frame: (now: number) => void) {
      renderer.setAnimationLoop(frame);
    },
  };
}

function contactShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 12, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,.65)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 10),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
