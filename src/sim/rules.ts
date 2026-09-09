import type { Tuning } from "../tuning.ts";
import {
  BALL_RADIUS,
  CENTER_X,
  CENTER_Y,
  PITCH_LENGTH,
  PITCH_WIDTH,
  PLAYER_RADIUS,
} from "./constants.ts";
import { attackDirOf, type RestartKind, type World } from "./types.ts";
import { clamp } from "./vec.ts";

/**
 * 比赛规则（DESIGN.md D3/D4/D5）。
 *
 * 做的：出界 → 界外球/角球/球门球、越位判罚、犯规 → 任意球、开球、终场。
 * 不做的：点球、换人、体力、牌（D6 明确排除，对 3 分钟一场没有意义）。
 *
 * 所有判罚都只在 phase === "playing" 时发生。死球期间必须什么都不判 ——
 * 少了这个闸门，一次出界会在同一帧被反复判罚。
 */

/**
 * 边线出界 → 界外球。
 *
 * 底线（进球/角球/球门球）不在这里 —— 那是 goal.ts 的 checkGoalLine 一个函数管到底，
 * 因为"进球"和"出底线"必须是同一个决策，拆开就会互相打架。
 */
export function checkOutOfPlay(world: World, t: Tuning): boolean {
  if (!world.officiating || world.phase !== "playing") return false;
  const b = world.ball;
  if (b.pos.y >= 0 && b.pos.y <= PITCH_WIDTH) return false;

  const touch = world.lastTouch ?? (b.owner !== null ? world.players[b.owner]!.team : null);
  if (touch === null) return false;
  award(world, t, "throwIn", touch === 0 ? 1 : 0, {
    x: clamp(b.pos.x, 1, PITCH_LENGTH - 1),
    y: b.pos.y < 0 ? 0.4 : PITCH_WIDTH - 0.4,
  }, "界外球");
  return true;
}

/** 底线判罚的对外入口，由 goal.ts 调用 */
export function awardCornerOrGoalKick(
  world: World,
  t: Tuning,
  kind: "corner" | "goalKick",
  team: 0 | 1,
  at: { x: number; y: number },
  label: string,
): void {
  if (!world.officiating) return;
  award(world, t, kind, team, at, label);
}

/**
 * 越位判罚（D4）。
 *
 * 出球瞬间由 pass.ts 记下谁处于越位位置（`offsideFlags`），
 * 这里只负责一件事：**被记下的那个人先碰到了球就吹掉**。
 *
 * 判罚点在越位球员的位置，任意球给对方 —— 这正是让"门口挂机"无效的那一条。
 */
export function checkOffside(world: World, t: Tuning, toucher: number): boolean {
  if (!world.officiating || world.phase !== "playing") return false;
  if (!world.offsideFlags.includes(toucher)) return false;
  const p = world.players[toucher]!;
  award(world, t, "freeKick", p.team === 0 ? 1 : 0, { x: p.pos.x, y: p.pos.y }, "越位");
  return true;
}

/**
 * 犯规（D5）：铲球撞到人却没碰到球 → 任意球。
 *
 * 不做牌、不做点球（D6）。这一条存在的唯一理由是让抢断有成本 ——
 * 光有硬直还不够，硬直只惩罚"没铲到"，不惩罚"铲的是人"。
 */
export function foul(world: World, t: Tuning, offender: number, at: { x: number; y: number }): void {
  if (!world.officiating || world.phase !== "playing") return;
  const p = world.players[offender]!;
  award(world, t, "freeKick", p.team === 0 ? 1 : 0, at, "犯规 · 任意球");
}

/** 进球之后由中圈开球，开球方是被进球的一方 */
export function awardKickoff(world: World, t: Tuning, team: 0 | 1, label: string): void {
  award(world, t, "kickoff", team, { x: CENTER_X, y: CENTER_Y }, label);
}

/**
 * 布置一次死球重开。
 *
 * **不移动任何人，也不移动球。** 球停在它自己滚出去的地方，
 * 主罚球员跑过去捡（fetch），捡到后带到开球点（carry），到位了才恢复比赛（ready）。
 *
 * 早先的版本是把主罚球员和球一起瞬移到开球点、对方也瞬移着退开 ——
 * 省事，但画面上是一堆人凭空闪现，完全看不懂发生了什么。
 * 现在唯一的"瞬移"只剩超时兜底（fetchTimeout），正常情况下碰不到。
 */
function award(
  world: World,
  t: Tuning,
  kind: RestartKind,
  team: 0 | 1,
  at: { x: number; y: number },
  label: string,
): void {
  const taker = pickTaker(world, team, kind, at);

  // 球不动。它会按正常摩擦滚到停下，主罚球员自己跑过去捡。
  // 只解除球权，免得出界那一刻还挂在某人脚上。
  const b = world.ball;
  b.owner = null;
  b.stickyLock = 0;
  b.pickupBlockedPlayer = null;

  world.phase = "restart";
  world.restart = {
    kind,
    team,
    at: { x: at.x, y: at.y },
    taker,
    label,
    stage: "fetch",
    fetchTimeout: t.rules.fetchTimeout,
  };
  world.restartTimer = t.rules.restartDelay;
  world.lastTouch = team;
  world.offsideFlags.length = 0;
  world.receiver = null;
  world.passHold = 0;
  world.charge.kind = null;
  world.charge.time = 0;
  world.eventLabel = label;
  world.eventTimer = t.rules.eventBannerTime;
}

/**
 * 球门球由门将主罚（D17）；其余由本方主罚。
 *
 * 挑人的依据是【离球多近】，不是离开球点多近 —— 他第一件事是跑过去把球捡起来。
 * 按开球点挑会选到一个站在开球点旁边、但离球二十米的人，捡球时间白白翻倍。
 */
function pickTaker(
  world: World,
  team: 0 | 1,
  kind: RestartKind,
  at: { x: number; y: number },
): number {
  const ball = world.ball.pos;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i]!;
    if (p.team !== team) continue;
    if (kind === "goalKick") {
      if (p.slot === 0) return i;
      continue;
    }
    if (p.slot === 0) continue;
    // 跑过去捡球 + 带回开球点，两段都要算
    const d =
      Math.hypot(p.pos.x - ball.x, p.pos.y - ball.y) +
      Math.hypot(ball.x - at.x, ball.y - at.y) * 0.15;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best >= 0 ? best : 0;
}

/**
 * 死球阶段推进 + 比赛时钟。
 *
 * fetch → carry → ready → playing。死球期间时钟停住：
 * 3 分钟一场，被出界吃掉一半就没得踢了。
 */
export function updateClock(world: World, t: Tuning, dt: number): void {
  if (world.eventTimer > 0) world.eventTimer = Math.max(0, world.eventTimer - dt);

  if (world.phase === "restart") {
    const r = world.restart;
    if (!r) {
      world.phase = "playing";
      return;
    }
    const b = world.ball;
    const taker = world.players[r.taker];

    if (r.stage === "fetch") {
      r.fetchTimeout -= dt;
      if (b.owner === r.taker) {
        r.stage = "carry";
      } else if (r.fetchTimeout <= 0 && taker) {
        // 兜底：谁也捡不到（球卡在角落、主罚的人被挤住），直接把球放到开球点
        placeAt(world, r.at, r.taker, t);
        r.stage = "ready";
        world.restartTimer = t.rules.restartDelay;
      }
      return;
    }

    if (r.stage === "carry") {
      r.fetchTimeout -= dt;
      if (b.owner !== r.taker) {
        // 带球途中把球弄丢了，退回去重新捡
        r.stage = "fetch";
        return;
      }
      const d = Math.hypot(b.pos.x - r.at.x, b.pos.y - r.at.y);
      if (d < t.rules.placeRadius || r.fetchTimeout <= 0) {
        placeAt(world, r.at, r.taker, t);
        r.stage = "ready";
        world.restartTimer = t.rules.restartDelay;
      }
      return;
    }

    // ready：倒计时只决定 AI 何时出球，绝不能替玩家开球。
    world.restartTimer = Math.max(0, world.restartTimer - dt);
    return;
  }
  if (world.phase !== "playing") return;

  world.clock = Math.max(0, world.clock - dt);
  if (world.clock === 0) {
    world.phase = "fullTime";
    world.eventLabel = "全场结束";
    world.eventTimer = 99;
  }
}

/** 只有主罚球员实际出球才能结束死球；等待、摆球和蓄力都不算。 */
export function completeRestart(world: World, kicker: number): void {
  if (world.phase !== "restart" || world.restart?.stage !== "ready" ||
      world.restart.taker !== kicker) return;
  world.phase = "playing";
  world.restart = null;
  world.restartTimer = 0;
}

/** 把球精确摆到开球点，主罚球员站到球后面。只在球已经被带到附近时调用 */
function placeAt(
  world: World,
  at: { x: number; y: number },
  taker: number,
  t: Tuning,
): void {
  const b = world.ball;
  b.pos.x = at.x;
  b.pos.y = at.y;
  b.prevPos.x = at.x;
  b.prevPos.y = at.y;
  b.vel.x = 0;
  b.vel.y = 0;
  b.z = 0;
  b.prevZ = 0;
  b.vz = 0;
  b.spin = 0;
  b.owner = taker;
  b.stickyLock = 0;
  b.pickupBlockedPlayer = null;

  const p = world.players[taker];
  if (p) {
    const dir = attackDirOf(p.team);
    p.pos.x = at.x - dir * (PLAYER_RADIUS + BALL_RADIUS + 0.5);
    p.pos.y = at.y;
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
    p.vel.x = 0;
    p.vel.y = 0;
    p.facing = dir === 1 ? 0 : Math.PI;
    p.stun = 0;
    p.lunge = 0;
  }
  // 球到位了才把控制权交还给玩家：捡球和摆球全程由 AI 跑，玩家不用等自己的腿。
  // 我方门将主罚球门球也交给玩家。
  const tk = world.players[taker];
  if (tk?.team === 0) world.controlled = taker;
  void t;
}
