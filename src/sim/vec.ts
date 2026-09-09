export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const clone = (v: Vec2): Vec2 => ({ x: v.x, y: v.y });
export const copyInto = (dst: Vec2, src: Vec2): void => {
  dst.x = src.x;
  dst.y = src.y;
};

export const len = (v: Vec2): number => Math.hypot(v.x, v.y);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

/** 逆时针 90° — 用于弧线的侧向加速度和横向速度分解 */
export const perp = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });

export function normalized(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

export const fromAngle = (a: number, m = 1): Vec2 => ({
  x: Math.cos(a) * m,
  y: Math.sin(a) * m,
});

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 角度插值，处理 ±π 的绕回。渲染插值必须用这个，否则转身时会瞬间反向旋转一圈 */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** 把 from 朝 to 旋转，每次最多 maxStep 弧度 */
export function rotateToward(from: number, to: number, maxStep: number): number {
  let d = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/** 指数衰减：与帧率无关的 "每秒衰减 rate" */
export const decay = (rate: number, dt: number): number => Math.exp(-rate * dt);
