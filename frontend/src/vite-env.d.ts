/// <reference types="vite/client" />

// cannon (физика 3D-кубика) не поставляет тайпинги — минимальная декларация
// под фактически используемые члены (Dice3D.tsx).
declare module 'cannon' {
  export class World { constructor(...args: unknown[]); [k: string]: any }
  export class Body { constructor(...args: unknown[]); [k: string]: any }
  export class Plane { constructor(...args: unknown[]); [k: string]: any }
  export class Vec3 { constructor(...args: unknown[]); [k: string]: any }
  export class NaiveBroadphase { constructor(...args: unknown[]); [k: string]: any }
}
