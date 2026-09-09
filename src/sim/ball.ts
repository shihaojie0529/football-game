import type { Tuning } from "../tuning.ts";
import type { Ball } from "./types.ts";
import { decay } from "./vec.ts";

/** m/s — Magnus 项的参考速度，只是把 curveFactor 归一到"正常射门速度"的量纲 */
const MAGNUS_REF_SPEED = 25;

/**
 * 自由球的物理。有 owner 时不走这里（粘球在 possession.ts 里接管）。
 *
 * z 轴是"2.5D 感"的全部来源（D7/D8）：抛物线 + 落地反弹，
 * 渲染层把球画在 (x, y - z*PPM)，影子留在 (x, y)。
 */
export function updateBall(b: Ball, t: Tuning, dt: number): void {
  const airborne = b.z > 0 || b.vz !== 0;

  if (airborne) {
    // Magnus 简化：侧向加速度 ∝ spin × 球速，只在空中生效。
    // 乘上球速这一项是必须的 —— 写成常数加速度的话，球慢下来后
    // 曲率 a/|v| 会发散，一脚球能拐出几十米。
    if (Math.abs(b.spin) > 1e-4) {
      const sp = Math.hypot(b.vel.x, b.vel.y);
      if (sp > 1e-4) {
        const nx = -b.vel.y / sp;
        const ny = b.vel.x / sp;
        const a = b.spin * t.ball.curveFactor * (sp / MAGNUS_REF_SPEED);
        b.vel.x += nx * a * dt;
        b.vel.y += ny * a * dt;
      }
      b.spin *= decay(t.ball.spinDecayAir, dt);
    }

    b.vz -= t.ball.gravityZ * dt;
    b.z += b.vz * dt;

    const d = decay(t.ball.airDrag, dt);
    b.vel.x *= d;
    b.vel.y *= d;

    if (b.z <= 0) {
      b.z = 0;
      b.vz = -b.vz * t.ball.bounceRestitution;
      // 反弹太小就当作停在地面，避免无限抖动
      if (Math.abs(b.vz) < 0.8) b.vz = 0;
      b.vel.x *= t.ball.bounceFriction;
      b.vel.y *= t.ball.bounceFriction;
      b.spin *= t.ball.spinDecayBounce;
    }
  } else {
    const d = decay(t.ball.groundFriction, dt);
    b.vel.x *= d;
    b.vel.y *= d;
    b.spin *= decay(2, dt);
  }

  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;

  if (Math.hypot(b.vel.x, b.vel.y) < 0.05 && b.z === 0 && b.vz === 0) {
    b.vel.x = 0;
    b.vel.y = 0;
  }
}
