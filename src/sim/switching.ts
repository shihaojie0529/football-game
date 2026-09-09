import type { Tuning } from "../tuning.ts";
import { interceptPoint } from "./predict.ts";
import type { World } from "./types.ts";
import { clamp } from "./vec.ts";

/** 输入层提供的可操作区域，只有世界坐标，不依赖显示设备。 */
export interface FieldRect { minX: number; minY: number; maxX: number; maxY: number }
export interface DefenderView { bounds: FieldRect; obscured: readonly FieldRect[] }
/** 与上一帧向玩家显示的下一位标记一致。 */
export interface DefenderSelection { view: DefenderView; controlled: number; next: number | null }

function contains(r: FieldRect, x: number, y: number): boolean {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

export function availableDefender(world: World, index: number, view?: DefenderView): boolean {
  const p = world.players[index];
  if (!p || p.team !== 0 || p.slot === 0 || p.stun > 0 || p.lungeKind === "slide") return false;
  return !view || (contains(view.bounds, p.pos.x, p.pos.y) &&
    !view.obscured.some(r => contains(r, p.pos.x, p.pos.y)));
}

/** 地滚球看距球距离，高球看到落点时间；转身和球门侧只作小幅修正。 */
export function defenderScore(world: World, index: number, t: Tuning): number {
  const p = world.players[index]!;
  const b = world.ball;
  const speed = t.move.maxSpeed * t.move.sprintMultiplier;
  let target = b.pos;
  let arrival: number;
  if (b.owner === null && (b.z > 0.5 || b.vz > 0.5)) {
    const point = { x: 0, y: 0 };
    const intercept = interceptPoint(b, p.pos, speed, t, point);
    target = point;
    // 预测范围之外仍比较剩余距离，不能把所有追不上的人都记成 2.4 秒。
    arrival = intercept.reachable ? intercept.time
      : Math.max(intercept.time, Math.hypot(point.x - p.pos.x, point.y - p.pos.y) / speed);
  } else {
    arrival = Math.hypot(b.pos.x - p.pos.x, b.pos.y - p.pos.y) / speed;
  }
  const dx = target.x - p.pos.x, dy = target.y - p.pos.y;
  const distance = Math.hypot(dx, dy) || 1;
  const alignment = (Math.cos(p.facing) * dx + Math.sin(p.facing) * dy) / distance;
  const turn = (1 - alignment) * 0.08;
  const runningToward = clamp((p.vel.x * dx + p.vel.y * dy) / distance / speed, -1, 1) * 0.08;
  const goalSide = b.owner !== null && p.pos.x < b.pos.x
    ? 0.16 * clamp(1 - Math.abs(p.pos.y - b.pos.y) / 12, 0, 1) : 0;
  return arrival + turn - runningToward - goalSide + Math.max(0, p.stun);
}

export function rankedDefenders(world: World, t: Tuning, view?: DefenderView): number[] {
  return world.players.map((_, i) => i)
    .filter(i => availableDefender(world, i, view))
    .sort((a, b) => defenderScore(world, a, t) - defenderScore(world, b, t) ||
      Math.hypot(world.players[a]!.pos.x - world.ball.pos.x, world.players[a]!.pos.y - world.ball.pos.y) -
      Math.hypot(world.players[b]!.pos.x - world.ball.pos.x, world.players[b]!.pos.y - world.ball.pos.y) || a - b);
}

/** 连按也只在附近三名候选中轮换，不沿全队名单越切越远。 */
export function nextDefender(world: World, t: Tuning, view?: DefenderView): number | null {
  if (world.phase !== "playing" || world.ball.owner === world.controlled) return null;
  const ranked = rankedDefenders(world, t, view);
  const best = ranked[0];
  if (best === undefined) return null;
  const bestScore = defenderScore(world, best, t);
  const local = ranked.filter(i => defenderScore(world, i, t) <= bestScore + 1.2).slice(0, 3);
  const at = local.indexOf(world.controlled);
  const next = world.switchManualChain > 0 && at >= 0
    ? local[(at + 1) % local.length]
    : local.find(i => i !== world.controlled);
  return next === undefined || next === world.controlled ? null : next;
}
