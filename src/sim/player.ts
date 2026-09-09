import type { Player } from "./types.ts";
import type { Tuning } from "../tuning.ts";
import { fromAngle, len, normalized, rotateToward } from "./vec.ts";

/**
 * 受控球员的移动。
 *
 * 模型：输入方向 → 目标速度，当前速度以有限加速度朝它靠拢。
 * 朝向（facing）与速度分离，用 turnRate 限制转动 —— 这是"转身有重量"的来源，
 * 也是粘球松动（D11）的触发器：facing 转得慢，脚前的球目标点就会滞后。
 */
export function updatePlayer(
  p: Player,
  moveX: number,
  moveY: number,
  sprint: boolean,
  t: Tuning,
  dt: number,
): void {
  // 硬直中完全不能动（D12：铲球落空的代价）
  if (p.stun > 0) {
    p.vel.x *= Math.max(0, 1 - t.move.deceleration * dt);
    p.vel.y *= Math.max(0, 1 - t.move.deceleration * dt);
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    return;
  }

  const inputLen = Math.hypot(moveX, moveY);
  const hasInput = inputLen > 0.01;

  const speedCap = t.move.maxSpeed * (sprint ? t.move.sprintMultiplier : 1);
  const accel = hasInput
    ? sprint
      ? t.move.sprintAcceleration
      : t.move.acceleration
    : t.move.deceleration;

  // 目标速度
  let tx = 0;
  let ty = 0;
  if (hasInput) {
    const nx = moveX / inputLen;
    const ny = moveY / inputLen;
    // 幅度 < 1 表示"慢慢走"：键盘恒为 1，AI 靠近目标点时会收小以免来回抖
    const mag = Math.min(inputLen, 1);
    tx = nx * speedCap * mag;
    ty = ny * speedCap * mag;
  }

  // 以有限加速度靠拢目标速度
  const dx = tx - p.vel.x;
  const dy = ty - p.vel.y;
  const dLen = Math.hypot(dx, dy);
  const step = accel * dt;
  if (dLen <= step || dLen < 1e-6) {
    p.vel.x = tx;
    p.vel.y = ty;
  } else {
    p.vel.x += (dx / dLen) * step;
    p.vel.y += (dy / dLen) * step;
  }

  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;

  // 朝向：优先跟输入（响应快），没有输入时跟残余速度
  const speed = len(p.vel);
  let desired = p.facing;
  if (hasInput) {
    desired = Math.atan2(moveY, moveX);
  } else if (speed > 0.4) {
    desired = Math.atan2(p.vel.y, p.vel.x);
  }
  p.facing = rotateToward(p.facing, desired, t.move.turnRate * dt);
}

/** 脚前的粘球目标点（D11） */
export function dribbleTarget(p: Player, t: Tuning): { x: number; y: number } {
  const d = fromAngle(p.facing, t.dribble.dribbleOffset);
  return { x: p.pos.x + d.x, y: p.pos.y + d.y };
}

/** 球员速度中垂直于朝向的分量 —— 射门弧线的来源 */
export function lateralSpeed(p: Player): number {
  const f = fromAngle(p.facing);
  const n = normalized({ x: -f.y, y: f.x });
  return p.vel.x * n.x + p.vel.y * n.y;
}
