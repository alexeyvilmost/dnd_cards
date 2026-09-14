/** A regular, bevelled icosahedron. Opposite faces sum to 21. No game RNG. */
export type Vec3 = [number, number, number];
export type Mat3 = number[];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (v: Vec3): Vec3 => scale(v, 1 / Math.hypot(...v));
const phi = (1 + Math.sqrt(5)) / 2;
const vertices: Vec3[] = [
  [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
  [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
  [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
].map(v => unit(v as Vec3));
const indices = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];
// Chessex d20_4 net (not a spindown): 20; counterclockwise upper rings
// 2,8,14; 18,12,10,16,6,4. The lower hemisphere contains their opposites.
// https://aleakybos.ch/Configurations.htm#D20 (d20_4)
const faceValues = [20, 14, 4, 18, 2, 6, 8, 12, 5, 11, 3, 17, 7, 1, 19, 16, 10, 15, 13, 9];
const faces = indices.map((ids, index) => {
  const corners = ids.map(i => vertices[i]);
  const center = scale(add(add(corners[0], corners[1]), corners[2]), 1 / 3);
  const normal = unit(center);
  const up = unit(sub(corners[0], center));
  const right = unit(cross(up, normal));
  return {corners, center, normal, up, right, value: faceValues[index]};
});
export const d20Faces = faces;

/** Column-major matrix: the result face looks at the camera, upright. */
export function d20SettledRotation(value: number): Mat3 {
  const face = faces.find(item => item.value === value) ?? faces[0];
  return [face.right[0], face.up[0], face.normal[0], face.right[1], face.up[1], face.normal[1], face.right[2], face.up[2], face.normal[2]];
}
export function multiply3(a: Mat3, b: Mat3): Mat3 {
  return Array.from({length: 9}, (_, index) => {
    const row = index % 3, col = Math.floor(index / 3);
    return a[row] * b[col * 3] + a[row + 3] * b[col * 3 + 1] + a[row + 6] * b[col * 3 + 2];
  });
}
export function d20Rotation(value: number, progress: number): Mat3 {
  const left = (1 - Math.min(1, Math.max(0, progress))) ** 3;
  const x = left * Math.PI * 5.4, y = left * Math.PI * 7.2, z = left * Math.PI * .9;
  const rx = [1, 0, 0, 0, Math.cos(x), Math.sin(x), 0, -Math.sin(x), Math.cos(x)];
  const ry = [Math.cos(y), 0, -Math.sin(y), 0, 1, 0, Math.sin(y), 0, Math.cos(y)];
  const rz = [Math.cos(z), Math.sin(z), 0, -Math.sin(z), Math.cos(z), 0, 0, 0, 1];
  return multiply3(multiply3(rz, multiply3(rx, ry)), d20SettledRotation(value));
}

// Interleaved position, normal, texture UV, metallic-bevel flag.
export function d20Mesh(): Float32Array {
  const data: number[] = [];
  for (const face of faces) {
    const inner = face.corners.map(v => add(add(face.center, scale(sub(v, face.center), .945)), scale(face.normal, .012)));
    const triangle = (points: Vec3[], metallic: number) => {
      const normal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
      for (const p of points) {
        const delta = sub(p, face.center);
        const u = .5 + dot(delta, face.right) / 1.18;
        const v = .5 + dot(delta, face.up) / 1.18;
        const index = face.value - 1;
        data.push(...p, ...normal, (index % 5 + u) / 5, (Math.floor(index / 5) + v) / 4, metallic);
      }
    };
    triangle(inner, 0);
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      triangle([face.corners[i], face.corners[j], inner[j]], 1);
      triangle([face.corners[i], inner[j], inner[i]], 1);
    }
  }
  return new Float32Array(data);
}
