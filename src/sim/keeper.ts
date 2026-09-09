import { tuningForTeam, type Tuning } from "../tuning.ts";
import { CENTER_Y, GOAL_WIDTH, PITCH_LENGTH, PENALTY_BOX_DEPTH, PENALTY_BOX_WIDTH } from "./constants.ts";
import { updatePlayer } from "./player.ts";
import { predictBallPos } from "./predict.ts";
import { attackDirOf, type Player, type World, type InputState } from "./types.ts";
import { clamp } from "./vec.ts";

/**
 * 门将（无球自动扑救，我方持球交给玩家）。
 *
 * M1~M4 里门将只是站在门线上靠身体碰撞挡球 —— 实测 180 脚射正的球扑出 0 次，
 * 就是个摆设。这个文件把他变成真正的守门员，三件事：
 *
 *  1. **封角度**：站在"球 → 球门中心"的连线上，离门线 gkLineDepth 米
 *  2. **预判落点**：球朝门飞时，横向移动到它将要越过门线的那个点
 *  3. **鱼跃**：预判点超出他跑得到的范围时飞身扑救，扑完要趴 gkDiveRecovery 秒
 *
 * 第 3 条同时是门将的【代价】：扑错方向就门户大开，跟铲球的硬直是一个道理。
 */

const HALF_GOAL = GOAL_WIDTH / 2;
const scratch = { x: 0, y: 0 };

/** 球会在什么时候、什么高度越过 x = atX 这条线，越过时 y 是多少 */
function predictCross(
  world: World,
  t: Tuning,
  atX: number,
): { y: number; z: number; time: number } | null {
  const b = world.ball;
  const towards = (atX - b.pos.x) * b.vel.x;
  if (towards <= 0) return null;
  for (let i = 1; i <= 30; i++) {
    const time = (i / 30) * 2.5;
    predictBallPos(b, t, time, scratch);
    const crossed = b.vel.x > 0 ? scratch.x >= atX : scratch.x <= atX;
    if (!crossed) continue;
    // 抛体高度：z = z0 + vz·t − g·t²/2
    const z = b.z + b.vz * time - 0.5 * t.ball.gravityZ * time * time;
    return { y: scratch.y, z, time };
  }
  return null;
}

/** 无球时的门将。返回 true 表示已经驱动了这名球员 */
export function updateKeeper(
  world: World,
  p: Player,
  t: Tuning,
  dt: number,
): boolean {
  t = tuningForTeam(t, p.team);
  if (p.dive > 0) {
    p.dive = Math.max(0, p.dive - dt);
    if (p.dive === 0) p.stun = t.ai.gkDiveRecovery;
    // 鱼跃靠身体横向移动获得覆盖范围；不能套用停步减速，几帧就刹停。
    const remaining = p.aim.y - p.pos.y;
    const travel = Math.min(Math.abs(remaining), t.ai.gkDiveSpeed * dt);
    p.vel.x = 0;
    p.vel.y = dt > 0 ? Math.sign(remaining) * travel / dt : 0;
    p.pos.y += Math.sign(remaining) * travel;
    return true;
  }
  if (p.stun > 0) {
    updatePlayer(p, 0, 0, false, t, dt);
    return true;
  }

  const dir = attackDirOf(p.team);
  const goalX = dir === 1 ? 0 : PITCH_LENGTH;
  const lineX = goalX + dir * t.ai.gkLineDepth;
  const ball = world.ball;

  const cross = ball.owner === null ? predictCross(world, t, lineX) : null;
  let aimY: number;

  // 反应时间：球朝门飞了 gkReaction 秒之后他才开始扑。
  // pressTime 在门将身上没有别的用途（他不逼抢），借来当这个计时器。
  if (cross) p.pressTime += dt;
  else p.pressTime = 0;
  const reacted = p.pressTime >= t.ai.gkReaction;

  if (cross && reacted && cross.z <= t.ai.gkCatchHeight * 1.6) {
    // 球朝门飞：横向移动到预判落点
    aimY = cross.y;
    // 射正而跑不过去就尝试鱼跃，来不及的球也会扑空。
    const gap = Math.abs(aimY - p.pos.y);
    const reachable = t.ai.gkSpeed * Math.max(cross.time, 0.01);
    if (gap > reachable + t.ai.gkDiveTrigger && Math.abs(aimY - CENTER_Y) <= HALF_GOAL) {
      p.aim.y = clamp(aimY, CENTER_Y - HALF_GOAL - 1.2, CENTER_Y + HALF_GOAL + 1.2);
      p.dive = t.ai.gkDiveWindow;
      p.vel.y = Math.sign(aimY - p.pos.y) * t.ai.gkDiveSpeed;
      p.vel.x = 0;
      return true;
    }
  } else {
    // 没有威胁：站在"球 → 球门中心"的连线上封角度
    const dxb = ball.pos.x - goalX;
    const k = Math.abs(dxb) < 0.01 ? 0 : (lineX - goalX) / dxb;
    aimY = CENTER_Y + (ball.pos.y - CENTER_Y) * clamp(k, 0, 1);
  }

  aimY = clamp(aimY, CENTER_Y - HALF_GOAL - 1.2, CENTER_Y + HALF_GOAL + 1.2);
  p.aim.x = lineX;
  p.aim.y = aimY;

  const dx = p.aim.x - p.pos.x;
  const dy = p.aim.y - p.pos.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.1) {
    updatePlayer(p, 0, 0, false, t, dt);
    return true;
  }
  // 门将的移动幅度被 gkSpeed 压住 —— 他不该有场上球员的冲刺速度，
  // 否则永远不需要鱼跃，走过去就够到球了
  const cap = clamp(t.ai.gkSpeed / t.move.maxSpeed, 0, 1);
  const mag = clamp(d / 1.2, 0, 1) * cap;
  updatePlayer(p, (dx / d) * mag, (dy / d) * mag, false, t, dt);
  return true;
}

/** 门将能够到多远的球（鱼跃时更远） */
export function keeperReach(p: Player, t: Tuning): number {
  t = tuningForTeam(t, p.team);
  return p.dive > 0 ? t.ai.gkDiveReach : t.ai.gkReach;
}


/** 抱球时允许玩家在禁区内移动、转向；鱼跃与起身完整结束后才能行动。 */
export function updateHeldKeeper(world: World, p: Player, input: InputState, t: Tuning, dt: number): void {
  t = tuningForTeam(t, p.team);
  if (p.dive > 0 || p.stun > 0) {
    updateKeeper(world, p, t, dt);
    return;
  }
  const scale = Math.min(1, t.ai.gkSpeed / t.move.maxSpeed);
  const length = Math.max(1, Math.hypot(input.moveX, input.moveY));
  updatePlayer(p, input.moveX / length * scale, input.moveY / length * scale, false, t, dt);
  const lowX = p.team === 0 ? p.radius : PITCH_LENGTH - PENALTY_BOX_DEPTH + 0.7;
  const highX = p.team === 0 ? PENALTY_BOX_DEPTH - 0.7 : PITCH_LENGTH - p.radius;
  const x = clamp(p.pos.x, lowX, highX);
  const y = clamp(p.pos.y, CENTER_Y - PENALTY_BOX_WIDTH / 2 + p.radius,
    CENTER_Y + PENALTY_BOX_WIDTH / 2 - p.radius);
  if (x !== p.pos.x) p.vel.x = 0;
  if (y !== p.pos.y) p.vel.y = 0;
  p.pos.x = x; p.pos.y = y;
}
