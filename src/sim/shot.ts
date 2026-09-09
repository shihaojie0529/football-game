import { tuningForTeam, type Tuning } from "../tuning.ts";
import { lateralSpeed } from "./player.ts";
import type { World } from "./types.ts";
import { clamp, fromAngle } from "./vec.ts";
import { completeRestart } from "./rules.ts";

/**
 * K 键蓄力射门（DESIGN.md §4）。蓄力的累计与松开检测在 action.ts，
 * 这里只负责"给定蓄力比例，把球踢出去"。
 *
 * 力度 = charge 线性映射到 [minPower, maxPower]。
 * 弧线来自出球瞬间球员的【横向速度】—— 朝正前方跑着射是直球，
 * 横着拉开再射才有弧线。这是这个射门唯一的技术深度，别把它调没了。
 */
export function fireShot(world: World, t: Tuning, ratio: number): void {
  const b = world.ball;
  if (b.owner === null) return;
  if (world.phase !== "playing" && !(world.phase === "restart" &&
      world.restart?.stage === "ready" && world.restart.taker === b.owner)) return;
  const kicker = b.owner;
  const p = world.players[b.owner];
  if (!p) return;
  t = tuningForTeam(t, p.team);

  const r = clamp(ratio, 0, 1);
  const power = t.shot.minPower + (t.shot.maxPower - t.shot.minPower) * r;
  const loft = (t.shot.loftAngle * Math.PI) / 180;

  const dir = fromAngle(p.facing);
  const horizontal = power * Math.cos(loft);

  b.owner = null;
  b.stickyLock = t.dribble.shotCooldown;
  b.pickupBlockedPlayer = null;
  b.vel.x = dir.x * horizontal + p.vel.x * t.shot.inheritVelocity;
  b.vel.y = dir.y * horizontal + p.vel.y * t.shot.inheritVelocity;
  b.vz = power * Math.sin(loft);
  b.spin = -lateralSpeed(p);
  world.shots += 1;
  world.matchStats[p.team].shots += 1;
  world.lastTouch = p.team;
  world.offsideFlags.length = 0;
  world.receiver = null;
  world.passHold = 0;
  completeRestart(world, kicker);
}
