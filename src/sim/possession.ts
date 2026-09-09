import { tuningForTeam, type Tuning } from "../tuning.ts";
import { BALL_RADIUS } from "./constants.ts";
import { dribbleTarget } from "./player.ts";
import { attackDirOf, type World } from "./types.ts";
import { checkOffside } from "./rules.ts";
import { keeperReach } from "./keeper.ts";

/** 带球保留惯性与补脚；主动出球、抢断和规则判罚决定球权，普通转向不会自行脱球。 */
export function updatePossession(world: World, t: Tuning, dt: number): void {
  const b = world.ball;

  // 球摆好后保持静止，主罚人可以瞄准，但不能因带球物理脱球而提前放行。
  if (world.phase === "restart" && world.restart?.stage === "ready") {
    b.owner = world.restart.taker;
    b.pos.x = world.restart.at.x;
    b.pos.y = world.restart.at.y;
    b.vel.x = b.vel.y = b.z = b.vz = b.spin = b.stickyLock = 0;
    b.pickupBlockedPlayer = null;
    return;
  }

  if (b.stickyLock > 0) b.stickyLock = Math.max(0, b.stickyLock - dt);
  if (b.stickyLock === 0) b.pickupBlockedPlayer = null;

  if (b.owner !== null) {
    const owner = world.players[b.owner];
    if (!owner) {
      b.owner = null;
      return;
    }
    // 扑住的球握在手中，不再按脚下带球处理，射门动量不能把它带过门线。
    if (owner.slot === 0) {
      b.pos.x = owner.pos.x + attackDirOf(owner.team) * 0.45;
      b.pos.y = owner.pos.y;
      b.vel.x = owner.vel.x;
      b.vel.y = owner.vel.y;
      b.z = owner.dive > 0 ? 0.35 : 1;
      b.vz = b.spin = 0;
      return;
    }
    t = tuningForTeam(t, owner.team);
    const target = dribbleTarget(owner, t);
    const dx = target.x - b.pos.x;
    const dy = target.y - b.pos.y;

    // 目标速度 = 球员速度（前馈）+ 有限的修正。
    //
    // 前馈项让球在稳态下自然跟着人跑，位置偏差趋近于 0；
    // 修正项封顶，所以脱手瞬间球的速度约等于球员速度 —— 球是"滚出去"，
    // 不是"被大脚踢出去"。（早先的纯 P 控制器会在脱手时把球甩出十几米。）
    let cx = dx * t.dribble.reattachRate;
    let cy = dy * t.dribble.reattachRate;
    const cLen = Math.hypot(cx, cy);
    if (cLen > t.dribble.maxCorrection) {
      const k = t.dribble.maxCorrection / cLen;
      cx *= k;
      cy *= k;
    }
    const desiredVx = owner.vel.x + cx;
    const desiredVy = owner.vel.y + cy;

    // 但球有惯性 —— 脚只能以 touchAccel 改变球的速度，不能瞬移它。
    // 这一步是整个粘球手感的核心：急转时球带着旧速度冲出去，
    // 接近控制范围时自动补脚，保留转向惯性但不会无对抗丢球。
    let dvx = desiredVx - b.vel.x;
    let dvy = desiredVy - b.vel.y;
    const dvLen = Math.hypot(dvx, dvy);
    const maxDv = t.dribble.touchAccel * dt;
    if (dvLen > maxDv) {
      const k = maxDv / dvLen;
      dvx *= k;
      dvy *= k;
    }
    b.vel.x += dvx;
    b.vel.y += dvy;
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    const errorX = b.pos.x - target.x, errorY = b.pos.y - target.y;
    const error = Math.hypot(errorX, errorY);
    if (error > t.dribble.maxDetachDistance) {
      const k = t.dribble.maxDetachDistance / error;
      b.pos.x = target.x + errorX * k;
      b.pos.y = target.y + errorY * k;
      b.vel.x = owner.vel.x;
      b.vel.y = owner.vel.y;
    }
    b.z = 0;
    b.vz = 0;
    b.spin = 0;
    return;
  }

  // 自由球：任何球员都能捡起来，最近的那个赢。
  // M1 只允许玩家控的那个人控球；M2 有 10 名队友，球权必须是全队共享的概念，
  // 否则传出去的球没人能接。
  if (b.stickyLock > 0 && b.pickupBlockedPlayer === null) return;
  const receiverTeam =
    world.receiver !== null ? world.players[world.receiver]?.team : undefined;

  // 死球期间只有主罚球员能捡球：不然对方会顺手把界外球捡走
  const onlyTaker =
    world.phase === "restart" && world.restart
      ? world.restart.taker
      : -1;

  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < world.players.length; i++) {
    if (onlyTaker >= 0 && i !== onlyTaker) continue;
    if (b.stickyLock > 0 && b.pickupBlockedPlayer === i) continue;
    const p = world.players[i]!;
    const playerTuning = tuningForTeam(t, p.team);
    // 传球飞行期间，【本方】其他人不该顺手把这脚球捞走 —— 指定接球人有优先权。
    // 对手不受这个限制：把对方的传球截下来正是防守该干的事。
    const priority =
      world.receiver !== null && i !== world.receiver && p.team === receiverTeam
        ? 1 - playerTuning.pass.receiverPriority
        : 1;
    // 门将有手：接球范围更大，而且能接高球（鱼跃时范围再放大）。
    // 场上球员只能碰到近乎贴地的球。
    const isGK = p.slot === 0;
    if (isGK ? b.z > playerTuning.ai.gkCatchHeight : b.z > 0.5) continue;
    const reach = isGK
      ? keeperReach(p, playerTuning) + p.radius + BALL_RADIUS
      : playerTuning.dribble.stickyRadius * priority + p.radius + BALL_RADIUS;
    const dist = Math.hypot(b.pos.x - p.pos.x, b.pos.y - p.pos.y);
    if (dist < reach && dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  if (best >= 0) {
    world.lastTouch = world.players[best]!.team;
    // 越位是在【接球时】吹的：出球瞬间记下谁越位，谁先碰到球就吹谁
    if (checkOffside(world, t, best)) return;
    world.offsideFlags.length = 0;
    gainPossession(world, best);
  }
}

/** 接球/干净抢断共同的第一脚卸力；之后的带球仍有惯性。 */
export function gainPossession(world: World, index: number): void {
  const winner = world.players[index]!;
  const b = world.ball;
  b.owner = index;
  b.vel.x = winner.vel.x;
  b.vel.y = winner.vel.y;
  b.vz = b.spin = b.stickyLock = 0;
  b.pickupBlockedPlayer = null;
  b.z = winner.slot === 0 ? 1 : 0;
  // 第一脚把来球收进身边，尤其避免背后接球落在脚前目标的控制范围之外。
  if (winner.slot !== 0) {
    const dx = b.pos.x - winner.pos.x, dy = b.pos.y - winner.pos.y;
    const distance = Math.hypot(dx, dy);
    const reach = winner.radius + BALL_RADIUS + 0.35;
    if (distance > reach) {
      b.pos.x = winner.pos.x + dx / distance * reach;
      b.pos.y = winner.pos.y + dy / distance * reach;
    }
  }
  winner.holdTime = 0;
  world.lastTouch = winner.team;
  syncPossessionControl(world);
  world.receiver = null;
  world.passHold = 0;
}

/** 控制权意外落到门将时，选择最近的己方场上球员作为兜底。 */
function nearestOwnFieldPlayer(world: World): number {
  let best = world.controlled;
  let bestD = Infinity;
  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i]!;
    if (p.team !== 0 || p.slot === 0) continue;
    const d = Math.hypot(world.ball.pos.x - p.pos.x, world.ball.pos.y - p.pos.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** 我方持球时交给持球者；门将出球后立即交回接应队友，无球时仍自动守门。 */
export function syncPossessionControl(world: World): void {
  const owner = world.ball.owner;
  const canControl = world.phase === "playing" || world.restart?.stage === "ready";
  if (canControl && owner !== null && world.players[owner]?.team === 0) {
    world.controlled = owner;
    return;
  }
  const p = world.players[world.controlled];
  if (!p || p.slot !== 0) return;
  const receiver = world.receiver;
  world.controlled = receiver !== null && world.players[receiver]?.team === 0 && world.players[receiver]?.slot !== 0
    ? receiver : nearestOwnFieldPlayer(world);
}
