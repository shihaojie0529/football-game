import type { Tuning } from "../tuning.ts";
import { autoReceive, updateTeamAI } from "./ai.ts";
import { updateBall } from "./ball.ts";
import { updatePassHold } from "./pass.ts";
import { autoSwitchDefence, updateAction } from "./action.ts";
import { updateTackleTimers } from "./tackle.ts";
import { resolveCollisions } from "./collision.ts";
import { checkGoalLine } from "./goal.ts";
import { checkOutOfPlay, updateClock } from "./rules.ts";
import { updateHeldKeeper } from "./keeper.ts";
import { updatePlayer } from "./player.ts";
import { syncPossessionControl, updatePossession } from "./possession.ts";
import type { DefenderSelection } from "./switching.ts";
import type { InputState, World } from "./types.ts";

/**
 * 一个固定 60Hz 的模拟步（DESIGN.md D26）。
 *
 * 纯函数式的入口：只读 (world, input, tuning, dt)，只写 world。
 * 不碰 DOM、不碰 canvas、不碰 requestAnimationFrame、不读 performance.now()（D25）。
 * dt 由调用方给，绝不自己去测时间 —— 这是"手感可复现"的全部前提。
 */
export function step(
  world: World,
  input: InputState,
  tuning: Tuning,
  dt: number,
  selection?: DefenderSelection,
): void {
  savePrev(world);
  updateClock(world, tuning, dt);

  // 终场之后一切静止，只留渲染插值用的 prev 状态
  if (world.phase === "fullTime") return;
  if (world.phase === "playing") {
    const team = world.ball.owner === null ? world.lastTouch : world.players[world.ball.owner]?.team;
    if (team !== null && team !== undefined) world.matchStats[team].possession += dt;
  }

  // 死球期间主罚球员由 AI 驱动（去捡球、摆球），球摆好了才交还控制权
  const restartTaker =
    world.phase === "restart" && world.restart && world.restart.stage !== "ready"
      ? world.restart.taker
      : -1;

  syncPossessionControl(world);
  const me = world.players[world.controlled];
  if (me && world.controlled !== restartTaker) {
    // 没按方向键、而且正等着接自己传出去的球 → 自动迎球（见 ai.ts autoReceive）。
    // 一按方向键就立刻交还控制权。
    const hasInput = Math.hypot(input.moveX, input.moveY) > 0.01;
    if (me.slot === 0 && world.ball.owner === world.controlled && world.phase === "playing") {
      updateHeldKeeper(world, me, input, tuning, dt);
    } else if (!hasInput && autoReceive(world, tuning, dt)) {
      // autoReceive 已经驱动了这名球员
    } else {
      const waitingToKick = world.phase === "restart" &&
        world.restart?.stage === "ready" && world.restart.taker === world.controlled;
      const x = me.pos.x;
      const y = me.pos.y;
      updatePlayer(me, input.moveX, input.moveY, input.sprint, tuning, dt);
      if (waitingToKick) {
        // 方向键仍可瞄准；实际出球之前主罚人留在开球点。
        me.pos.x = x;
        me.pos.y = y;
        me.vel.x = me.vel.y = 0;
      }
    }
  }

  // 其余 10 人由 AI 驱动（D18 阵型 + D19 局部跑位）
  updateTeamAI(world, tuning, dt);

  // 出球/出脚必须在球物理之前：本 tick 踢出去或断下来的球，本 tick 就要开始动
  updatePassHold(world, tuning, dt);
  updateAction(world, input, tuning, dt, selection);
  // 计时器每 tick 都要跑（硬直要在死球期间消化掉）；
  // 判定结算和"能不能出脚"由 tackle.ts 内部按 phase 决定
  updateTackleTimers(world, tuning, dt);

  updatePossession(world, tuning, dt);
  syncPossessionControl(world);
  autoSwitchDefence(world, tuning, dt, input, selection);
  if (world.ball.owner === null) {
    updateBall(world.ball, tuning, dt);
    // 死球时让球快点停下：滚得越远，去捡球的人跑得越久，玩家干等的时间越长
    if (world.phase !== "playing") {
      const damp = Math.exp(-tuning.rules.deadBallDamping * dt);
      world.ball.vel.x *= damp;
      world.ball.vel.y *= damp;
    }
  }

  // 判罚必须早于围栏 clamp，否则球会先被墙弹回来。
  // 底线（进球/角球/球门球）由 checkGoalLine 一个函数管到底，边线走 checkOutOfPlay。
  checkGoalLine(world, tuning, dt);
  checkOutOfPlay(world, tuning);
  resolveCollisions(world, tuning);

  world.time += dt;
}

/** 渲染插值需要上一 tick 的状态（D26） */
function savePrev(world: World): void {
  for (const p of world.players) {
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
    p.prevFacing = p.facing;
  }
  const b = world.ball;
  b.prevPos.x = b.pos.x;
  b.prevPos.y = b.pos.y;
  b.prevZ = b.z;
}
