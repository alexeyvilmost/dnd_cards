import {dieMesh, dieRotation} from './polyhedralGeometry';

const vertex = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute float metal;
uniform mat3 rotation;
uniform float lift;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vLocal;
varying vec2 vUv;
varying float vMetal;
void main() {
  vec3 p = rotation * position;
  vNormal = rotation * normal; vPosition = p; vLocal = position; vUv = uv; vMetal = metal;
  gl_Position = vec4(p.x * 2.15, p.y * 2.15 + lift, -p.z * .2, 3.05 - p.z * .6);
}`;
const fragment = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vLocal;
varying vec2 vUv;
varying float vMetal;
uniform sampler2D numbers;
void main() {
  vec3 n = normalize(vNormal);
  vec3 light = normalize(vec3(-.65, .9, 1.4));
  vec3 fill = normalize(vec3(.9, -.3, .65));
  vec3 view = normalize(vec3(0., 0., 4.) - vPosition);
  float diffuse = max(dot(n, light), 0.);
  float side = max(dot(n, fill), 0.);
  float spec = pow(max(dot(n, normalize(light + view)), 0.), 44.);
  float rim = pow(1. - max(dot(n, view), 0.), 2.);
  float vein = sin(vLocal.x * 9. + sin(vLocal.y * 8. + vLocal.z * 6.) * 2.);
  float grain = sin(vLocal.x * 85.) * sin(vLocal.y * 73.) * sin(vLocal.z * 66.) * .005;
  vec3 sapphire = mix(vec3(.023, .08, .145), vec3(.048, .19, .275), vein * .5 + .5) + grain;
  vec3 gold = vec3(.72, .48, .19);
  vec3 color = mix(sapphire, gold, vMetal) * (.3 + diffuse * .95 + side * .32);
  color += vec3(.48, .68, .83) * rim * .17;
  color += vec3(1., .87, .63) * spec * mix(.46, 1.4, vMetal);
  vec4 ink = texture2D(numbers, vUv);
  color = mix(color, ink.rgb * (.7 + diffuse * .4), ink.a * (1. - vMetal));
  gl_FragColor = vec4(color, 1.);
}`;

let atlas: HTMLCanvasElement | undefined;
function numberAtlas() {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  for (let i = 0; i < 20; i++) {
    const x = (i % 5) * 256, y = Math.floor(i / 5) * 256;
    ctx.save(); ctx.translate(x + 128, y + 128);
    // WebGL texture coordinates have a lower-left origin.
    ctx.scale(1, -1);
    ctx.font = 'bold 91px Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#030c14'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 3;
    ctx.lineWidth = 2; ctx.strokeStyle = '#74502a'; ctx.strokeText(String(i + 1), 0, 3);
    ctx.fillStyle = '#ffe4a2'; ctx.fillText(String(i + 1), 0, 3);
    ctx.shadowBlur = 0;
    if (i === 5 || i === 8) { ctx.fillStyle = '#c59b52'; ctx.fillRect(-10, 46, 20, 2); }
    ctx.restore();
  }
  atlas = canvas;
  return canvas;
}

/** One small WebGL scene, rendered only during the tumble and on resize. */
export function createD20Renderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', {alpha: true, antialias: true, premultipliedAlpha: false});
  if (!gl) return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Dice shader unavailable'); }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }
  gl.useProgram(program);
  let mesh = dieMesh(20), currentSides = 20;
  const meshes = new Map([[20, mesh]]);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  for (const [name, size, offset] of [['position', 3, 0], ['normal', 3, 3], ['uv', 2, 6], ['metal', 1, 8]] as const) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 36, offset * 4);
  }
  const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, numberAtlas());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const rotation = gl.getUniformLocation(program, 'rotation'), lift = gl.getUniformLocation(program, 'lift');
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.clearColor(0, 0, 0, 0);
  return {
    draw(value: number, progress: number, sides = 20, requestedSize = canvas.clientWidth) {
      if (gl.isContextLost()) return false;
      if (sides !== currentSides) {
        mesh = meshes.get(sides) ?? dieMesh(sides); meshes.set(sides, mesh); currentSides = sides;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
      }
      const size = Math.min(512, Math.max(160, Math.round(requestedSize * Math.min(window.devicePixelRatio || 1, 2))));
      if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
      gl.viewport(0, 0, size, size); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix3fv(rotation, false, new Float32Array(dieRotation(sides, value, progress)));
      gl.uniform1f(lift, Math.sin(progress * Math.PI * 4) ** 2 * (1 - progress) * .28);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.length / 9);
      return true;
    },
    dispose() { gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); },
  };
}

// All visible dice share ONE GPU context, even for a large critical-damage pool.
// Copying the rendered frame to 2D surfaces retains the actual 3D mesh/lighting.
let shared: {canvas: HTMLCanvasElement; renderer: ReturnType<typeof createD20Renderer>; users: number; refresh: Set<() => void>} | undefined;
export function createCommittedDieRenderer(surface: HTMLCanvasElement, sides: number, availability?: (available: boolean) => void) {
  const ctx = surface.getContext('2d');
  if (!ctx) return null;
  if (!shared) {
    const canvas = document.createElement('canvas');
    const renderer = createD20Renderer(canvas);
    if (!renderer) return null;
    const scene = {canvas, renderer: renderer as ReturnType<typeof createD20Renderer>, users: 0, refresh: new Set<() => void>()};
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); scene.refresh.forEach(refresh => refresh());
    });
    canvas.addEventListener('webglcontextrestored', () => {
      scene.renderer?.dispose();
      try { scene.renderer = createD20Renderer(canvas); } catch { scene.renderer = null; }
      scene.refresh.forEach(refresh => refresh());
    });
    shared = scene;
  }
  const scene = shared; scene.users++;
  let lastValue=1, lastProgress=1;
  const draw = (value: number, progress: number) => {
      lastValue=value; lastProgress=progress;
      const available=Boolean(scene.renderer?.draw(value, progress, sides, surface.clientWidth));
      availability?.(available);
      if (!available) return false;
      if (surface.width !== scene.canvas.width) { surface.width = scene.canvas.width; surface.height = scene.canvas.height; }
      ctx.clearRect(0, 0, surface.width, surface.height); ctx.drawImage(scene.canvas, 0, 0);
      return true;
  };
  const refresh=()=>draw(lastValue,lastProgress); scene.refresh.add(refresh);
  return {
    draw,
    dispose() { scene.refresh.delete(refresh); if (--scene.users === 0) { scene.renderer?.dispose(); if (shared === scene) shared = undefined; } },
  };
}
