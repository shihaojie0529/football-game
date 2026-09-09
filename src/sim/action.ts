import { tuningForTeam, type Tuning } from "../tuning.ts";
import { firePass } from "./pass.ts";
import { startTackle } from "./tackle.ts";
import { availableDefender, defenderScore, nextDefender, rankedDefenders, type DefenderSelection } from "./switching.ts";
import { fireShot } from "./shot.ts";
import type { ChargeKind, InputState, World } from "./types.ts";
import { clamp } from "./vec.ts";

/**
 * 射门和三种传球共用的蓄力状态机。
 *
 * 四个动作是同一套机制：按住蓄力、松开出球。同一时刻只能蓄一个 ——
 * 先按下的那个键说了算，别的键在它松开之前一律忽略。
 *
 * 蓄力对射门和传球的含义不同，这是刻意的：
 *   射门 —— 蓄力决定【力度】（球速）
 *   传球 —— 蓄力决定【想传多远】，球速仍然由系统精确反解，保证到人脚下
 *
 * 传球不让玩家直接控力度，是因为那会把辅助传球变回手动传球：
 * 力度稍偏，球就从接球人身边滚过去。蓄力管"传给多远的人"、系统管"用多大力送到"，
 * 玩家得到了控制权，又不会因此传丢。
 */
const KEYS: ChargeKind[] = ["shot", "short", "through", "long"];

function isHeld(input: InputState, kind: ChargeKind): boolean {
  switch (kind) {
    case "shot":
      return input.shoot;
    case "short":
      return input.passShort;
    case "through":
      return input.passThrough;
    case "long":
      return input.passLong;
  }
}

export function updateAction(
  world: World,
  input: InputState,
  t: Tuning,
  dt: number,
  selection?: DefenderSelection,
): void {
  t = tuningForTeam(t, 0);
  const c = world.charge;
  if (world.phase === "restart" &&
      (world.restart?.stage !== "ready" || world.restart.taker !== world.controlled)) {
    c.kind = null;
    c.time = 0;
    for (const kind of KEYS) world.actionWasHeld[kind] = isHeld(input, kind);
    return;
  }
  const hasBall = world.ball.owner === world.controlled;
  const keeper = hasBall && world.players[world.controlled]?.slot === 0;
  const player = world.players[world.controlled];
  if (keeper && player && (player.dive > 0 || player.stun > 0)) {
    c.kind = null; c.time = 0;
    for (const kind of KEYS) world.actionWasHeld[kind] = isHeld(input, kind);
    return;
  }

  // 输入层按攻守配置映射动作；真实按下沿避免切换球权时把两个独立按键混为长按。
  if (!hasBall) {
    if (c.kind !== null) {
      c.kind = null;
      c.time = 0;
    }
    // K = 抢断（站立出脚，够得近、落空硬直短）
    if (input.shoot && (input.actionPressed?.shot ?? !world.actionWasHeld.shot)) {
      startTackle(world, world.controlled, t, "poke");
    }
    // L = 铲球（滑铲，够得远得多，但落空要躺 1 秒多）
    if (input.passThrough && (input.actionPressed?.through ?? !world.actionWasHeld.through)) {
      startTackle(world, world.controlled, t, "slide");
    }
    // J = 手动切人（D15：切到离球最近的己方球员，按一次切一个，按住不连切）
    if (input.passShort && (input.actionPressed?.short ?? !world.actionWasHeld.short)) {
      switchPlayer(world, t, selection);
    }
    for (const kind of KEYS) world.actionWasHeld[kind] = isHeld(input, kind);
    return;
  }

  if (c.kind === null) {
    // 挑一个【本帧刚按下】的键开始蓄力
    for (const kind of KEYS) {
      const held = isHeld(input, kind);
      if (held && (input.actionPressed?.[kind] ?? !world.actionWasHeld[kind])) {
        c.kind = kind;
        c.time = 0;
        break;
      }
    }
  }

  if (c.kind !== null) {
    const max = c.kind === "shot" ? t.shot.chargeTime : t.pass.chargeTime;
    if (isHeld(input, c.kind)) {
      c.time = Math.min(c.time + dt, max);
    } else {
      const ratio = clamp(c.time / max, 0, 1);
      const kind = c.kind;
      c.kind = null;
      c.time = 0;
      if (kind === "shot" && keeper) firePass(world, input, "long", t, ratio);
      else if (kind === "shot") fireShot(world, t, ratio);
      else firePass(world, input, kind, t, ratio);
    }
  }

  for (const kind of KEYS) world.actionWasHeld[kind] = isHeld(input, kind);
}

/** 蓄力进度 0..1，渲染层画力度条用 */
export function chargeRatio(world: World, t: Tuning): number {
  t = tuningForTeam(t, 0);
  if (world.charge.kind === null) return 0;
  const max = world.charge.kind === "shot" ? t.shot.chargeTime : t.pass.chargeTime;
  return clamp(world.charge.time / max, 0, 1);
}

/** 按 J 确认刚显示的候选；候选失效时不偷偷改选另一人。 */
function switchPlayer(world: World, t: Tuning, selection?: DefenderSelection): void {
  t = tuningForTeam(t, 0);
  const next = selection ? (selection.controlled === world.controlled ? selection.next : null)
    : nextDefender(world, t);
  if (next === null || next === world.controlled || !availableDefender(world, next, selection?.view)) return;
  world.controlled = next;
  world.switchLock = t.ai.manualSwitchLock;
  world.switchManualChain = 0.7;
  if (world.ball.owner === null) world.switchLooseUsed = true;
}

/**
 * 辅助防守切人：只处理空中球/无主球，一次球权争夺最多切一次。
 * 对方稳定带球时、玩家持续跑位时和手动选择后，都保留当前后卫。
 * 本方接球的控制权移交仍由 possession / pass 负责。
 */
export function autoSwitchDefence(world: World, t: Tuning, dt: number, input: InputState, selection?: DefenderSelection): void {
  t = tuningForTeam(t, 0);
  world.switchLock = Math.max(0, world.switchLock - dt);
  world.switchManualChain = Math.max(0, world.switchManualChain - dt);
  const moving = Math.hypot(input.moveX, input.moveY) > 0.01;
  world.switchInputLock = moving ? t.ai.switchInputGrace : Math.max(0, world.switchInputLock - dt);

  const owner = world.ball.owner;
  if (world.phase !== "playing" || owner !== null) {
    world.switchLooseUsed = false;
    return;
  }
  if (t.ai.switching === "manual") return;
  // 接自己传出去的球属于进攻控制权移交，不是防守自动切人。
  if (world.passHold > 0 || (world.receiver !== null && world.players[world.receiver]?.team === 0)) return;
  const me = world.players[world.controlled];
  if (!me || me.lunge > 0 || world.switchLock > 0 || world.switchInputLock > 0 || moving || world.switchLooseUsed) return;

  const best = rankedDefenders(world, t, selection?.view)[0];
  if (best === undefined || best === world.controlled) return;
  if (defenderScore(world, world.controlled, t) - defenderScore(world, best, t) < t.ai.autoSwitchMargin) return;

  world.controlled = best;
  world.switchLock = t.ai.autoSwitchCooldown;
  world.switchLooseUsed = true;
}
