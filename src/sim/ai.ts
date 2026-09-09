import { tuningForTeam, type Tuning } from "../tuning.ts";
import { CENTER_Y, PITCH_LENGTH } from "./constants.ts";
import { FORMATION_442, slotAnchor } from "./formation.ts";
import { updatePlayer } from "./player.ts";
import { interceptPoint } from "./predict.ts";
import { startTackle } from "./tackle.ts";
import { updateKeeper } from "./keeper.ts";
import { attackDirOf, type Player, type World } from "./types.ts";
import { clamp } from "./vec.ts";
import { completeRestart } from "./rules.ts";
import { updateAttack } from "./attack.ts";

/**
 * 两队 AI。
 *
 * 每支球队每 tick 只做一件事的判断：**本方有没有球权**。
 *  - 有球权 → 进攻（D18 阵型 + D19 局部跑位）
 *  - 没球权 → 防守（逼抢 + 补位 + 盯人）
 *  - 球是自由球 → 最近的人去追，其余站阵型
 *
 * 三档职责的原则跟 M2 一样：绝大多数人只是站在阵型锚点上，
 * 只有跟球直接相关的两三个人做局部决策。行为可解释比行为聪明重要 ——
 * 球员做出奇怪动作时你得能立刻说清是哪个数导致的。
 */

const anchorScratch = { x: 0, y: 0 };
const interceptScratch = { x: 0, y: 0 };

export function updateTeamAI(world: World, tuning: Tuning, dt: number): void {
  if (world.phase === "restart" && world.restart) {
    updateRestartAI(world, tuning, dt);
    return;
  }
  const ball = world.ball;
  const carrier = ball.owner !== null ? world.players[ball.owner] : undefined;
  const possTeam = carrier ? carrier.team : null;

  for (const team of [0, 1] as const) {
    const t = tuningForTeam(tuning, team);
    const hasBall = possTeam === team;
    // 阵线回收只在【对方持球】时发生。球是自由球（比如传球飞行中）不该回收 ——
    // 否则每传一脚球全队就往后缩 9 米，接球人被自己的阵型拖走。
    const shouldDrop = possTeam !== null && possTeam !== team;
    const chaser = possTeam === null ? nearestToBall(world, team, t) : -1;
    const runners = hasBall && ball.owner !== null
      ? nearestTeammates(world, ball.owner, t.ai.activeRunners)
      : [];
    // 逼抢半径之外没人出去逼抢，全队保持阵型（tuning.ai.pressRadius）
    let presser = !hasBall && carrier ? nearestTo(world, team, carrier.pos, true) : -1;
    if (presser >= 0) {
      const pp = world.players[presser]!;
      if (Math.hypot(pp.pos.x - carrier!.pos.x, pp.pos.y - carrier!.pos.y) > t.ai.pressRadius) {
        presser = -1;
      }
    }
    const cover = presser >= 0 ? nearestTo(world, team, carrier!.pos, true, presser) : -1;

    for (let i = 0; i < world.players.length; i++) {
      const p = world.players[i]!;
      if (p.team !== team) continue;
      if (i === world.controlled) continue; // 玩家控的那个人不由 AI 驱动
      if (p.stun > 0) {
        updatePlayer(p, 0, 0, false, t, dt);
        continue;
      }
      if (i === ball.owner) {
        if (p.slot === 0) driveKeeper(world, p, i, t, dt);
        else if (!updateAttack(world, p, i, t, dt)) driveCarrier(p, t, dt);
        continue;
      }
      // 门将无球时有一整套自己的逻辑（封角度、预判落点、鱼跃），不走阵型锚点
      if (p.slot === 0) {
        updateKeeper(world, p, t, dt);
        continue;
      }

      if (i === chaser) {
        interceptPoint(ball, p.pos, sprintSpeed(t), t, interceptScratch);
        p.aim.x = interceptScratch.x;
        p.aim.y = interceptScratch.y;
        steer(p, t, dt, true);
        continue;
      }

      slotAnchor(
        FORMATION_442[p.slot]!,
        ball.pos,
        t.ai,
        anchorScratch,
        attackDirOf(team),
        !shouldDrop,
      );

      if (hasBall) {
        if (runners.includes(i)) pickRunTarget(world, p, anchorScratch, t);
        else setAim(p, anchorScratch.x, anchorScratch.y);
        steer(p, t, dt, false);
      } else if (carrier?.slot === 0) {
        // 抱在手里的球不能抢；回到防守站位，并给门将留出发球空间。
        const dx = anchorScratch.x - ball.pos.x, dy = anchorScratch.y - ball.pos.y;
        const distance = Math.hypot(dx, dy);
        const clearance = 4;
        const nx = distance > 0.01 ? dx / distance : -attackDirOf(p.team);
        const ny = distance > 0.01 ? dy / distance : 0;
        setAim(p, distance < clearance ? ball.pos.x + nx * clearance : anchorScratch.x,
          distance < clearance ? ball.pos.y + ny * clearance : anchorScratch.y);
        p.pressTime = 0;
        steer(p, t, dt, false);
      } else if (carrier) {
        defend(world, p, i, carrier, presser, cover, anchorScratch, t, dt);
      } else {
        setAim(p, anchorScratch.x, anchorScratch.y);
        steer(p, t, dt, false);
      }
    }
  }
}

/**
 * 死球期间的跑位。
 *
 * 主罚球员跑去捡球、再把球带到开球点；对方【走着】退出规定距离，不是瞬移；
 * 其余人各回各的阵型位置。全程没有任何人凭空闪现。
 *
 * 主罚球员即使正是玩家控制的那个，也由 AI 驱动 —— 玩家不该被迫用自己的腿
 * 跑 20 米去捡球，那是纯粹的等待。球摆好（stage = ready）才把控制权交还。
 */
function updateRestartAI(world: World, tuning: Tuning, dt: number): void {
  const r = world.restart!;
  const ball = world.ball;

  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i]!;
    const t = tuningForTeam(tuning, p.team);
    if (p.stun > 0) {
      updatePlayer(p, 0, 0, false, t, dt);
      continue;
    }

    if (i === r.taker && r.stage !== "ready") {
      if (r.stage === "fetch") {
        interceptPoint(ball, p.pos, sprintSpeed(t), t, interceptScratch);
        setAim(p, interceptScratch.x, interceptScratch.y);
      } else {
        setAim(p, r.at.x, r.at.y);
      }
      steer(p, t, dt, true);
      continue;
    }

    if (i === world.controlled && r.stage === "ready") continue; // 已经交还给玩家
    if (i === r.taker && r.stage === "ready") {
      updatePlayer(p, 0, 0, false, t, dt);
      if (world.restartTimer <= 0) {
        if (p.slot === 0) driveKeeper(world, p, i, t, dt);
        else kickRestart(world, p, i, t);
      }
      continue;
    }
    if (p.slot === 0) {
      updateKeeper(world, p, t, dt);
      continue;
    }

    slotAnchor(
      FORMATION_442[p.slot]!,
      ball.pos,
      t.ai,
      anchorScratch,
      attackDirOf(p.team),
      p.team === r.team,
    );
    let ax = anchorScratch.x;
    let ay = anchorScratch.y;

    // 对方必须退出规定距离 —— 靠走的，不是靠瞬移
    if (p.team !== r.team) {
      const dx = ax - r.at.x;
      const dy = ay - r.at.y;
      const d = Math.hypot(dx, dy);
      if (d < t.rules.restartClearance) {
        const nx = d > 1e-6 ? dx / d : 1;
        const ny = d > 1e-6 ? dy / d : 0;
        ax = r.at.x + nx * t.rules.restartClearance;
        ay = r.at.y + ny * t.rules.restartClearance;
      }
    }
    setAim(p, ax, ay);
    steer(p, t, dt, false);
  }
}

/** AI 主罚也必须踢出球，不能靠倒计时解除保护后开始带球。 */
function kickRestart(world: World, p: Player, index: number, t: Tuning): void {
  const receiver = nearestTo(world, p.team, p.pos, true, index);
  const target = world.players[receiver]?.pos ?? { x: p.pos.x + attackDirOf(p.team) * 12, y: CENTER_Y };
  const b = world.ball;
  const dx = target.x - b.pos.x;
  const dy = target.y - b.pos.y;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const speed = clamp(distance, 8, 18);
  b.owner = null;
  b.stickyLock = t.dribble.shotCooldown;
  b.pickupBlockedPlayer = null;
  b.vel.x = dx / distance * speed;
  b.vel.y = dy / distance * speed;
  b.vz = 0;
  b.spin = 0;
  world.lastTouch = p.team;
  world.offsideFlags.length = 0;
  world.passes += 1;
  world.matchStats[p.team].passes += 1;
  completeRestart(world, index);
}

/**
 * 门将拿到球：握一下，然后开出去。
 *
 * 不能走 driveCarrier —— 那会让门将一路带球到中场。
 * 对方门将持球仍由 AI 发球；我方门将在取球摆球完成后由玩家操作：
 * 朝前场最靠前的队友（或者干脆朝前）来一脚高球。
 */
function driveKeeper(
  world: World,
  p: Player,
  index: number,
  t: Tuning,
  dt: number,
): void {
  if (p.dive > 0) {
    updateKeeper(world, p, t, dt);
    return;
  }
  p.holdTime += dt;
  updatePlayer(p, 0, 0, false, t, dt);
  if (p.holdTime < t.ai.gkClearDelay) return;

  const dir = attackDirOf(p.team);
  // 朝本方最靠前的队友开，找不到就朝正前方
  let targetX = p.pos.x + dir * 45;
  let targetY = CENTER_Y;
  let bestAdvance = -Infinity;
  for (const q of world.players) {
    if (q.team !== p.team || q.slot === 0) continue;
    const advance = (q.pos.x - p.pos.x) * dir;
    if (advance > bestAdvance && advance < 60) {
      bestAdvance = advance;
      targetX = q.pos.x;
      targetY = q.pos.y;
    }
  }

  const dx = targetX - p.pos.x;
  const dy = targetY - p.pos.y;
  const d = Math.max(Math.hypot(dx, dy), 1);
  const loft = (t.ai.gkClearLoft * Math.PI) / 180;
  const b = world.ball;
  b.owner = null;
  b.stickyLock = t.dribble.shotCooldown;
  b.pickupBlockedPlayer = null;
  b.vel.x = (dx / d) * t.ai.gkClearPower * Math.cos(loft);
  b.vel.y = (dy / d) * t.ai.gkClearPower * Math.cos(loft);
  b.vz = t.ai.gkClearPower * Math.sin(loft);
  b.spin = 0;
  world.lastTouch = p.team;
  world.offsideFlags.length = 0;
  world.receiver = null;
  p.holdTime = 0;
  world.passes += 1;
  world.matchStats[p.team].passes += 1;
  completeRestart(world, index);
}

/**
 * 持球的 AI：朝对方球门带球。
 *
 * 没有合适传射机会时继续推进，传射决策由 attack.ts 负责。
 */
function driveCarrier(p: Player, t: Tuning, dt: number): void {
  const dir = attackDirOf(p.team);
  setAim(p, p.pos.x + dir * 12, CENTER_Y + (p.pos.y - CENTER_Y) * 0.6);
  steer(p, t, dt, true);
}

/**
 * 防守三档（DESIGN.md D12 周边）：
 *  1. 逼抢者 —— 跑向持球人的【球门一侧】，够到了就出脚
 *  2. 补位者 —— 站在逼抢者身后靠自家球门的位置，被过掉时还有一层
 *  3. 其余人 —— 阵型锚点 + 往最近的对手身上拉一点（盯人）
 */
function defend(
  world: World,
  p: Player,
  index: number,
  carrier: Player,
  presser: number,
  cover: number,
  anchor: { x: number; y: number },
  t: Tuning,
  dt: number,
): void {
  const dir = attackDirOf(p.team);
  const ownGoalX = dir === 1 ? 0 : PITCH_LENGTH;

  if (index === presser) {
    // 贴到【球】的球门一侧，而不是持球人的。用无球盯人那个 2.2 米的距离来逼抢，
    // 站定的位置就永远够不到球，也就永远不会出脚（见 tuning.ai.pressGoalSide）。
    const ball = world.ball;
    const gx = Math.sign(ownGoalX - ball.pos.x) || -dir;
    // 迎向带球人的下一步，避免追着当前位置跑、接近时又提前减速。
    const distance = Math.hypot(ball.pos.x - p.pos.x, ball.pos.y - p.pos.y);
    const horizon = clamp(distance / sprintSpeed(t) * 0.65, 0, 0.7);
    let aimX = ball.pos.x + carrier.vel.x * horizon + gx * t.ai.pressGoalSide;
    let aimY = ball.pos.y + carrier.vel.y * horizon;
    const bodyClearance = p.radius + carrier.radius + 0.25;
    // 背身护球时，球门侧目标可能落进持球人身体里；绕到球侧，不能反复顶人空抢。
    if (Math.hypot(aimX - carrier.pos.x, aimY - carrier.pos.y) < bodyClearance) {
      const bx = ball.pos.x - carrier.pos.x;
      const by = ball.pos.y - carrier.pos.y;
      const length = Math.hypot(bx, by) || 1;
      const nx = bx / length, ny = by / length;
      const px = p.pos.x - carrier.pos.x, py = p.pos.y - carrier.pos.y;
      const side = px * -ny + py * nx >= 0 ? 1 : -1;
      const behind = px * nx + py * ny < 0;
      aimX = (behind ? carrier.pos.x : ball.pos.x) - ny * side * bodyClearance;
      aimY = (behind ? carrier.pos.y : ball.pos.y) + nx * side * bodyClearance;
    }
    setAim(p, aimX, aimY);
    steer(p, t, dt, true, 0.8);
    const d = Math.hypot(world.ball.pos.x - p.pos.x, world.ball.pos.y - p.pos.y);

    // 先封堵、后择机（参考 FC）：贴住之后要压满 pressCommitDelay 才出脚，
    // 但持球人一旦触球散开（球甩离脚前超过 looseTouch）就立刻出脚。
    if (d < t.tackle.aiTriggerRange) p.pressTime += dt;
    else p.pressTime = 0;
    const loose =
      Math.hypot(world.ball.pos.x - carrier.pos.x, world.ball.pos.y - carrier.pos.y) >
      t.ai.looseTouch;

    if (d < t.tackle.aiTriggerRange && (loose || p.pressTime >= t.ai.pressCommitDelay)) {
      startTackle(world, index, t, "poke");
      p.pressTime = 0;
    } else if (
      d < t.slide.aiTriggerRange &&
      shouldSlide(p, carrier, world.ball.pos, t, ownGoalX)
    ) {
      // 抢断够不着、而且人正在被过掉 —— 这时才值得用铲球去博，代价是躺 1 秒多
      startTackle(world, index, t, "slide");
    }
    return;
  }

  if (index === cover) {
    const gx = Math.sign(ownGoalX - carrier.pos.x) || -dir;
    // 补位保持纵深，同时跟住突破方向，不把边路持球人放回空位。
    setAim(p, carrier.pos.x + carrier.vel.x * 0.4 + gx * t.ai.coverDepth,
      carrier.pos.y + carrier.vel.y * 0.4);
    steer(p, t, dt, true);
    return;
  }

  // 盯人：锚点往最近的对手身上拉，站在他和自家球门之间
  let markX = anchor.x;
  let markY = anchor.y;
  let best = Infinity;
  for (const q of world.players) {
    if (q.team === p.team) continue;
    const d = Math.hypot(q.pos.x - anchor.x, q.pos.y - anchor.y);
    if (d < best && d < 16) {
      best = d;
      const gx = Math.sign(ownGoalX - q.pos.x) || -dir;
      markX = q.pos.x + gx * t.ai.markGoalSide;
      markY = q.pos.y;
    }
  }
  setAim(
    p,
    anchor.x + (markX - anchor.x) * t.ai.markPull,
    anchor.y + (markY - anchor.y) * t.ai.markPull,
  );
  steer(p, t, dt, false);
}

/**
 * 该不该用铲球 —— 只在"最后一搏"的情况下。
 *
 * 三个条件必须同时成立：
 *  1. 持球人正在明显拉开距离（不是并排跑）
 *  2. 防守者【已经被过掉】：持球人跑到了他和自家球门之间
 *  3. **球比人更近** —— 去球不去人。少了这一条，AI 会从背后连人带球一起铲，
 *     实测一场 3 分钟判 9~22 次任意球（真实足球 90 分钟才 20~30 次）。
 *
 * 少了第 2 条，玩家一加速逃离就会被从侧后方铲到，
 * 实测"冲刺逃离 0.5 秒被断"比站着不动还快 —— 逃跑反而是自杀，方向完全反了。
 */
function shouldSlide(
  defender: Player,
  carrier: Player,
  ball: { x: number; y: number },
  t: Tuning,
  ownGoalX: number,
): boolean {
  const dx = carrier.pos.x - defender.pos.x;
  const dy = carrier.pos.y - defender.pos.y;
  const d = Math.hypot(dx, dy) || 1;
  const away = (carrier.vel.x * dx + carrier.vel.y * dy) / d;
  if (away < t.ai.slideEscapeSpeed) return false;
  // 去球不去人：球得比人更近，否则这一铲多半是铲在人身上
  if (Math.hypot(ball.x - defender.pos.x, ball.y - defender.pos.y) >= d) return false;
  // 被过掉了才铲：持球人比防守者更靠近自家球门
  return Math.abs(carrier.pos.x - ownGoalX) < Math.abs(defender.pos.x - ownGoalX);
}

const setAim = (p: Player, x: number, y: number): void => {
  p.aim.x = x;
  p.aim.y = y;
};

const sprintSpeed = (t: Tuning): number => t.move.maxSpeed * t.move.sprintMultiplier;

/** 朝 aim 走。靠近时收小输入幅度，否则会在目标点两侧来回抖 */
function steer(p: Player, t: Tuning, dt: number, sprint: boolean, arriveRadius = t.ai.arriveRadius): void {
  const dx = p.aim.x - p.pos.x;
  const dy = p.aim.y - p.pos.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.15) {
    updatePlayer(p, 0, 0, false, t, dt);
    return;
  }
  const mag = clamp(d / arriveRadius, 0, 1);
  updatePlayer(p, (dx / d) * mag, (dy / d) * mag, sprint && d > arriveRadius, t, dt);
}

/**
 * 无输入时自动迎球。
 *
 * D16 在球还在飞的时候就把控制权交给接球人。但 AI 会跳过玩家控制的球员，
 * 于是接球人一拿到控制权就变成雕像，球从他身边滚过去 —— 传球等于必丢。
 *
 * 规则很简单：你不按方向键，他就自己去接球；你一按方向键，立刻听你的。
 */
export function autoReceive(world: World, t: Tuning, dt: number): boolean {
  t = tuningForTeam(t, 0);
  if (world.ball.owner !== null) return false;
  if (world.receiver !== world.controlled) return false;
  const p = world.players[world.controlled];
  if (!p || p.stun > 0) return false;
  interceptPoint(world.ball, p.pos, sprintSpeed(t), t, interceptScratch);
  setAim(p, interceptScratch.x, interceptScratch.y);
  steer(p, t, dt, true);
  return true;
}

/** 本队里最早能追上球的人（不含门将、不含玩家控的那个） */
function nearestToBall(world: World, team: 0 | 1, t: Tuning): number {
  const receiver = world.receiver;
  if (receiver !== null && receiver !== world.controlled &&
      world.players[receiver]?.team === team && world.players[receiver]!.stun <= 0) return receiver;
  let best = -1;
  let bestT = Infinity;
  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i]!;
    if (p.team !== team || i === world.controlled || p.slot === 0 || p.stun > 0) continue;
    const r = interceptPoint(world.ball, p.pos, sprintSpeed(t), t, interceptScratch);
    if (r.time < bestT) {
      bestT = r.time;
      best = i;
    }
  }
  return best;
}

/** 本队里离某个点最近的人 */
function nearestTo(
  world: World,
  team: 0 | 1,
  at: { x: number; y: number },
  skipGK: boolean,
  exclude = -1,
): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i]!;
    if (p.team !== team || i === exclude || i === world.controlled || p.stun > 0) continue;
    if (skipGK && p.slot === 0) continue;
    const d = Math.hypot(p.pos.x - at.x, p.pos.y - at.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function nearestTeammates(world: World, from: number, n: number): number[] {
  const origin = world.players[from]!;
  const out: Array<{ i: number; d: number }> = [];
  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i]!;
    if (i === from || i === world.controlled) continue;
    if (p.team !== origin.team || p.slot === 0) continue;
    out.push({ i, d: Math.hypot(p.pos.x - origin.pos.x, p.pos.y - origin.pos.y) });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, n).map((o) => o.i);
}

/**
 * D19 的局部势场：在锚点周围撒一圈候选点，选分最高的。
 *
 * 评分只有三项，刻意保持少 —— 项数一多，"他为什么跑那儿"就说不清了，
 * 而可解释性正是选锚点方案而不是全场势场的全部理由。
 */
function pickRunTarget(
  world: World,
  p: Player,
  anchor: { x: number; y: number },
  t: Tuning,
): void {
  // 球权可能在同一轮 AI 循环里就没了（比如门将在前面几个索引把球开了出去），
  // 这时"和持球人保持可传距离"这一项没有意义，退回纯锚点。
  const holder = world.ball.owner !== null ? world.players[world.ball.owner] : undefined;
  if (!holder) {
    setAim(p, anchor.x, anchor.y);
    return;
  }
  const dir = attackDirOf(p.team);
  const n = t.ai.runnerSamples;
  let bestScore = -Infinity;
  let bx = anchor.x;
  let by = anchor.y;

  for (let s = 0; s < n; s++) {
    const a = (s / n) * Math.PI * 2;
    const cx = anchor.x + Math.cos(a) * t.ai.runnerRadius;
    const cy = anchor.y + Math.sin(a) * t.ai.runnerRadius;

    // 1) 往对方球门推进。必须以【锚点】为基准，不能以球员当前位置为基准 ——
    //    后者是个棘轮：每帧"比现在靠前"都得分，球员会一路漂到活动矩形边界。
    const advance = (cx - anchor.x) * dir * t.ai.wAdvance;

    // 2) 离最近的【对手】远一点。M2 没有对手时这一项退化成"别和队友挤在一起"，
    //    现在它才是原本 D19 想要的那个意思。
    let nearest = Infinity;
    for (let j = 0; j < world.players.length; j++) {
      if (j === world.ball.owner) continue;
      const q = world.players[j]!;
      if (q === p) continue;
      // 队友和对手都要拉开距离。曾经把队友权重降到 0.5，结果队友互相挤得更近，
      // 传球被自己人半路截走的比例反而上升。对手只稍微更要紧一点。
      const severity = q.team === p.team ? 0.85 : 1;
      nearest = Math.min(nearest, Math.hypot(q.pos.x - cx, q.pos.y - cy) * severity);
    }
    const space = Math.min(nearest, 12) * t.ai.wSpace;

    // 3) 和持球人保持一个能传到的距离，太近太远都不好接球
    const passDist = Math.hypot(cx - holder.pos.x, cy - holder.pos.y);
    const passable = -Math.abs(passDist - t.ai.preferredPassDistance) * t.ai.wPassable;

    const score = advance + space + passable;
    if (score > bestScore) {
      bestScore = score;
      bx = cx;
      by = cy;
    }
  }
  setAim(p, bx, by);
}
