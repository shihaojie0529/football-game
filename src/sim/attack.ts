import type { Tuning } from "../tuning.ts";
import { CENTER_Y, PITCH_LENGTH } from "./constants.ts";
import { fireAIPass, isOffside } from "./pass.ts";
import { fireShot } from "./shot.ts";
import { attackDirOf, type Player, type World } from "./types.ts";
import { clamp, rotateToward } from "./vec.ts";

/** 返回 true 时本 tick 正在准备/完成出球；否则继续带球推进。 */
export function updateAttack(world: World, p: Player, index: number, t: Tuning, dt: number): boolean {
  if (world.phase !== "playing" || world.ball.owner !== index) return false;
  p.holdTime += dt;
  if (p.holdTime < t.attack.decisionDelay) return false;
  const dir = attackDirOf(p.team);
  const goalX = p.team === 0 ? PITCH_LENGTH : 0;
  const toGoal = Math.abs(goalX - p.pos.x);
  const keeper = world.players.find((q) => q.team !== p.team && q.slot === 0);
  const aimY = CENTER_Y + (keeper && keeper.pos.y >= CENTER_Y ? -2.2 : 2.2);
  const lane = clearance(world, p, goalX, aimY);

  // 到禁区附近才射门；瞄准需要转身时间，不能在背对球门时瞬间抽射。
  if (toGoal < t.attack.shotRange && Math.abs(p.pos.y - CENTER_Y) < 14 && lane > 0.8) {
    const angle = Math.atan2(aimY - world.ball.pos.y, goalX - world.ball.pos.x);
    p.facing = rotateToward(p.facing, angle, t.move.turnRate * dt);
    p.vel.x *= Math.exp(-8 * dt);
    p.vel.y *= Math.exp(-8 * dt);
    const error = Math.atan2(Math.sin(angle - p.facing), Math.cos(angle - p.facing));
    if (Math.abs(error) < 0.12) {
      fireShot(world, t, clamp((toGoal - 6) / 24, 0.3, 0.85));
      p.holdTime = 0;
    }
    return true;
  }

  if (p.holdTime < t.attack.passDelay) return false;
  let pressure = Infinity;
  for (const q of world.players) {
    if (q.team !== p.team) pressure = Math.min(pressure, Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y));
  }
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < world.players.length; i++) {
    const q = world.players[i]!;
    if (i === index || q.team !== p.team || q.slot === 0 || q.stun > 0) continue;
    const distance = Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y);
    if (distance < 5 || distance > 27 || isOffside(world, p.team, q.pos.x)) continue;
    const advance = (q.pos.x - p.pos.x) * dir;
    if (pressure > 4 && advance < 5) continue;
    const openLane = clearance(world, p, q.pos.x, q.pos.y);
    if (openLane < 1.7) continue;
    let space = 12;
    for (const foe of world.players) {
      if (foe.team !== p.team) space = Math.min(space, Math.hypot(foe.pos.x - q.pos.x, foe.pos.y - q.pos.y));
    }
    if (space < 2.5) continue;
    const score = advance * 0.55 + space + Math.min(openLane, 5) - Math.abs(distance - 14) * 0.3;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  if (best < 0) return false;
  fireAIPass(world, t, index, best);
  return true;
}

function clearance(world: World, from: Player, x: number, y: number): number {
  const dx = x - from.pos.x;
  const dy = y - from.pos.y;
  const length2 = dx * dx + dy * dy;
  let closest = Infinity;
  for (const foe of world.players) {
    if (foe.team === from.team || foe.slot === 0) continue;
    const along = ((foe.pos.x - from.pos.x) * dx + (foe.pos.y - from.pos.y) * dy) / Math.max(length2, 1);
    if (along < 0.08 || along > 1) continue;
    closest = Math.min(closest, Math.hypot(foe.pos.x - from.pos.x - along * dx, foe.pos.y - from.pos.y - along * dy));
  }
  return closest;
}
