import type { Tuning } from "../tuning.ts";
import type { Ball } from "./types.ts";
import { updateBall } from "./ball.ts";
import { TICK_DT } from "./constants.ts";
import type { Vec2 } from "./vec.ts";

/**
 * 球的轨迹预测。
 *
 * 用途有两处，都要求"知道球【将要】在哪"而不是"球现在在哪"：
 *  - 队友接球：跑向拦截点，而不是跑向球当前位置（否则永远跟在球屁股后面）
 *  - D16 传球后的控制权移交：交给"预测接球点最近的队友"
 *
 * predictBallPos 提供短期水平闭式预测；interceptPoint 对高球推进真实物理，
 * 等待可接高度并考虑落地弹跳，避免接球人提前钻到高球下面。
 */
export function predictBallPos(b: Ball, t: Tuning, dt: number, out: Vec2): Vec2 {
  // 空中阻力和地面摩擦不同；用球当前状态选一个，够用了
  const rate = b.z > 0 || b.vz !== 0 ? t.ball.airDrag : t.ball.groundFriction;
  // ∫v0·e^(-rt) dt = v0·(1 - e^(-r·dt)) / r
  const k = rate < 1e-6 ? dt : (1 - Math.exp(-rate * dt)) / rate;
  out.x = b.pos.x + b.vel.x * k;
  out.y = b.pos.y + b.vel.y * k;
  return out;
}

const scratch: Vec2 = { x: 0, y: 0 };

/**
 * 追击解：球员以 speed 跑，最早能在哪个点追上球。
 *
 * 逐点采样而不是解方程 —— 球速带指数衰减，解析解不值得，
 * 而 24 次采样在 60Hz 下对 11 个球员也就是每帧几百次乘法。
 */
export function interceptPoint(
  b: Ball,
  from: Vec2,
  speed: number,
  t: Tuning,
  out: Vec2,
  horizon = 2.4,
  samples = 24,
): { reachable: boolean; time: number } {
  // 高球必须等到可接高度；逐步使用真实物理，包含落地后的反弹与减速。
  const flight: Ball | null = b.z > 0 || b.vz !== 0
    ? { ...b, pos: { ...b.pos }, vel: { ...b.vel } } : null;
  let elapsed = 0;
  for (let i = 1; i <= samples; i++) {
    const time = (i / samples) * horizon;
    if (flight) {
      while (elapsed < time - 1e-8) {
        const dt = Math.min(TICK_DT, time - elapsed);
        updateBall(flight, t, dt);
        elapsed += dt;
      }
      scratch.x = flight.pos.x; scratch.y = flight.pos.y;
      if (flight.z > 0.5) continue;
    } else predictBallPos(b, t, time, scratch);
    const need = Math.hypot(scratch.x - from.x, scratch.y - from.y) / Math.max(speed, 0.1);
    if (need <= time) {
      out.x = scratch.x;
      out.y = scratch.y;
      return { reachable: true, time };
    }
  }
  // 追不上：跑向 horizon 处的位置，至少方向是对的
  if (flight) { out.x = flight.pos.x; out.y = flight.pos.y; }
  else predictBallPos(b, t, horizon, out);
  return { reachable: false, time: horizon };
}
