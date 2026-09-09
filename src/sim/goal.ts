import type { Tuning } from "../tuning.ts";
import {
  CENTER_Y,
  GOAL_BOX_DEPTH,
  GOAL_BOX_WIDTH,
  GOAL_HEIGHT,
  GOAL_WIDTH,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from "./constants.ts";
import { awardCornerOrGoalKick, awardKickoff } from "./rules.ts";
import type { World } from "./types.ts";
import { clamp, lerp } from "./vec.ts";
import { resetKickoff } from "./world.ts";

const HALF_GOAL = GOAL_WIDTH / 2;

/**
 * 底线判定：进球 还是 角球/球门球。
 *
 * **这必须是同一个决策。** 曾经拆成两个互不知情的函数（checkGoal 和 checkOutOfPlay
 * 各判各的），结果带球过线时 checkGoal 因为"球有主"而放弃，球掉进出界判定变成球门球 ——
 * 明明是进球。两个函数对同一件事各有一套条件，就一定会出现它们互相打架的角度。
 *
 * 同时用【过线那一瞬间】的插值位置，而不是过线之后采样的位置：
 * 球一个 tick 能走 0.7 米，用采样点判会把擦柱而入判成出界，也会把擦柱而出判成进球。
 */
export function checkGoalLine(world: World, t: Tuning, dt: number): void {
  if (world.goalFlash > 0) world.goalFlash = Math.max(0, world.goalFlash - dt);
  if (world.phase !== "playing") return;

  const b = world.ball;
  const x0 = b.prevPos.x;
  const x1 = b.pos.x;

  let line: number;
  if (x1 >= PITCH_LENGTH && x0 < PITCH_LENGTH) line = PITCH_LENGTH;
  else if (x1 <= 0 && x0 > 0) line = 0;
  else if (x1 > PITCH_LENGTH || x1 < 0) line = x1 > PITCH_LENGTH ? PITCH_LENGTH : 0; // 已经在线外
  else return;

  // 过线瞬间的 y 和 z
  const denom = x1 - x0;
  const k = Math.abs(denom) < 1e-9 ? 1 : Math.min(1, Math.max(0, (line - x0) / denom));
  const crossY = lerp(b.prevPos.y, b.pos.y, k);
  const crossZ = lerp(b.prevZ, b.z, k);

  const rightSide = line === PITCH_LENGTH;
  const inMouth = Math.abs(crossY - CENTER_Y) <= HALF_GOAL && crossZ <= GOAL_HEIGHT;

  if (inMouth) {
    // 进球。球有没有人控都算 —— 带球过线本来就是进球
    const scorer: 0 | 1 = rightSide ? 0 : 1;
    world.goals[scorer] += 1;
    world.goalFlash = 1.8;
    world.lastScorer = scorer;
    resetKickoff(world);
    awardKickoff(world, t, scorer === 0 ? 1 : 0, scorer === 0 ? "进球！" : "被进球");
    return;
  }

  // 不是进球 → 角球或球门球，看最后碰球的是攻方还是守方
  const defending: 0 | 1 = rightSide ? 1 : 0;
  // 开场第一脚之前谁都没碰过球：算进攻方碰的（判球门球），别白送一个角球
  const attacking: 0 | 1 = defending === 0 ? 1 : 0;
  const touch = world.lastTouch ?? (b.owner !== null ? world.players[b.owner]!.team : attacking);
  if (touch === defending) {
    awardCornerOrGoalKick(
      world,
      t,
      "corner",
      defending === 0 ? 1 : 0,
      { x: rightSide ? PITCH_LENGTH - 0.5 : 0.5, y: crossY < CENTER_Y ? 0.5 : PITCH_WIDTH - 0.5 },
      "角球",
    );
  } else {
    awardCornerOrGoalKick(
      world,
      t,
      "goalKick",
      defending,
      // 球门球可以在球门区内任意位置开出：摆在离出界点最近的那一侧，
      // 否则门将要横穿二十米去把球捡回来再走回门中央
      {
        x: rightSide ? PITCH_LENGTH - GOAL_BOX_DEPTH : GOAL_BOX_DEPTH,
        y: clamp(crossY, CENTER_Y - GOAL_BOX_WIDTH / 2 + 1, CENTER_Y + GOAL_BOX_WIDTH / 2 - 1),
      },
      "球门球",
    );
  }
}
