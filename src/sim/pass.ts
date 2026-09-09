import type { Tuning } from "../tuning.ts";
import { PITCH_WIDTH, PITCH_LENGTH } from "./constants.ts";
import { attackDirOf, type InputState, type World } from "./types.ts";
import { clamp, fromAngle } from "./vec.ts";
import { completeRestart } from "./rules.ts";

/**
 * 三种传球（DESIGN.md D13 / D14 / D20 / D21）。
 *
 * 三个键的区别不是"力度不同"，而是【目标筛选逻辑 + 弹道】不同：
 *   短传 J — 地滚，吸附最强，主要看意图方向和线路是否通畅
 *   长传 I — 高球，吸附最弱（更看方向和射程），刻意不帮玩家太多
 *   直塞 L — 地滚，传向队友【前方的空位】而不是脚下
 *
 * 直塞传空位这一条是它存在的唯一理由：传到脚下就等于短传。
 * 也正因为如此，它必须配合 D19 的队友前插跑位才有意义。
 */

export type PassKind = "short" | "long" | "through";

interface Candidate {
  index: number;
  /** 实际瞄准的点（直塞会瞄在队友前方） */
  aimX: number;
  aimY: number;
  score: number;
}

/** D16 的控制权移交计时 + 传球生命周期。每 tick 调用，跟出球无关 */
export function updatePassHold(world: World, t: Tuning, dt: number): void {
  // 球已经停下来了，这脚传球就算结束 —— 必须解除接球人优先权，
  // 否则其他人的吸附半径会被永久压制，谁都捡不起这个球。
  const b = world.ball;
  if (
    world.receiver !== null &&
    b.owner === null &&
    b.z <= 0 &&
    Math.hypot(b.vel.x, b.vel.y) < 1.5
  ) {
    world.receiver = null;
  }

  if (world.passHold <= 0) return;
  world.passHold = Math.max(0, world.passHold - dt);
  // D16：出脚后先保持控制传球者，给"传完就跑"留空间，之后再移交
  if (world.passHold === 0) handOverControl(world, t);
}

/**
 * 出球。由蓄力状态机（action.ts）在松开传球键时调用。
 *
 * ratio 是蓄力比例，含义是【你想传多远】：0 = 最近，1 = 这种传球的最大射程。
 * 它只影响"挑谁"，不影响力度 —— 力度永远由系统精确反解到接球人脚下。
 */
export function firePass(
  world: World,
  input: InputState,
  kind: PassKind,
  t: Tuning,
  ratio: number,
): void {
  const b = world.ball;
  if (b.owner === null || b.owner !== world.controlled) return;
  if (world.phase !== "playing" && !(world.phase === "restart" &&
      world.restart?.stage === "ready" && world.restart.taker === b.owner)) return;

  const cfg = t.pass[kind];
  const wantDist = cfg.minRange + (cfg.maxRange - cfg.minRange) * clamp(ratio, 0, 1);

  // 找不到人也要把球踢出去（见 fallbackTarget）
  const target =
    pickTarget(world, input, kind, t, wantDist) ??
    fallbackTarget(world, input, wantDist);
  launch(world, target, kind, t, wantDist);
  completeRestart(world, world.controlled);
}

/**
 * 一个人都选不到时的兜底：把球传向输入方向的空档。
 *
 * 按了传球键却什么都不发生，是这套操作里最难受的一件事 ——
 * 玩家不知道是自己按错了、还是游戏没反应，只会觉得"传球不好使"。
 * 真实球赛里也没有"不出脚"这个选项：找不到人就把球捅向空档，
 * 反正离球最近的队友会去追（ai.ts 的 chaser）。
 */
function fallbackTarget(
  world: World,
  input: InputState,
  wantDist: number,
): Candidate {
  const from = world.players[world.controlled]!;
  let dirX = input.moveX;
  let dirY = input.moveY;
  const inLen = Math.hypot(dirX, dirY);
  if (inLen < 0.01) {
    const f = fromAngle(from.facing);
    dirX = f.x;
    dirY = f.y;
  } else {
    dirX /= inLen;
    dirY /= inLen;
  }
  return {
    index: -1,
    aimX: from.pos.x + dirX * wantDist,
    aimY: from.pos.y + dirY * wantDist,
    score: 0,
  };
}

/**
 * D13：方向决定扇形，扇形内按各键的评分逻辑选人。
 * 没有方向输入时退回球员朝向 —— 站着不动也得能传球。
 */
function pickTarget(
  world: World,
  input: InputState,
  kind: PassKind,
  t: Tuning,
  wantDist: number,
): Candidate | null {
  const from = world.players[world.controlled]!;
  const cfg = t.pass[kind];

  let dirX = input.moveX;
  let dirY = input.moveY;
  const inLen = Math.hypot(dirX, dirY);
  if (inLen < 0.01) {
    const f = fromAngle(from.facing);
    dirX = f.x;
    dirY = f.y;
  } else {
    dirX /= inLen;
    dirY /= inLen;
  }

  const cosFan = Math.cos((t.pass.fanAngle * Math.PI) / 180);
  let best: Candidate | null = null;

  for (let i = 0; i < world.players.length; i++) {
    if (i === world.controlled) continue;
    const p = world.players[i]!;
    if (p.team !== from.team) continue; // 只传给自己人
    if (p.slot === 0) continue; // 别往门将脚下传

    // 直塞瞄的是队友【前方的空位】（D14）；所有传球都要预判他跑到哪（leadFactor）
    const spaceLead = kind === "through" ? cfg.lead * attackDirOf(from.team) : 0;
    const aim = aimPoint(p.pos, p.vel, spaceLead, from.pos, cfg, t);
    const aimX = aim.x;
    const aimY = aim.y;

    const dx = aimX - from.pos.x;
    const dy = aimY - from.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1.5 || dist > cfg.maxRange) continue;

    // 意图匹配：候选人方向与输入方向的夹角。
    //
    // 用【角度归一化后再取幂】而不是直接用 cos —— cos 在小角度附近太平坦，
    // 60° 外的队友只比 0° 的低一点点，很容易被线路/推进项翻盘，
    // 于是就出现"我明明指着这边，球却给了另一个人"。
    const cos = (dx * dirX + dy * dirY) / dist;
    if (cos < cosFan) continue;
    const angDeg = (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI;
    const intent = Math.pow(Math.max(0, 1 - angDeg / t.pass.fanAngle), t.pass.intentSharpness);

    // 线路阻挡：传球路径上有没有别人（M2 没有对手，挡路的只能是自己队友；
    // M3 加上对手后这一项才真正吃重）
    const lane = laneClearance(world, from.pos, aimX, aimY, i, from.team);
    const laneScore = clamp(lane / t.pass.laneRadius, 0, 1);

    // 推进价值：接球人比持球人往对方球门前进了多少
    const advance = clamp((aimX - from.pos.x) * attackDirOf(from.team) / 30, -1, 1);

    // 射程匹配：越接近【蓄力条指定的距离】越好。这就是力度条对传球的意义 ——
    // 按键决定弹道类型、蓄力决定传多远、方向决定给谁，三件事各管一件。
    const rangeScore = 1 - clamp(Math.abs(dist - wantDist) / cfg.maxRange, 0, 1);

    const score =
      intent * cfg.wIntent +
      laneScore * cfg.wLane +
      advance * cfg.wAdvance +
      rangeScore * cfg.wRange;

    // 直塞的两条硬性否决（D21）：线路被堵死、或者接球点已经越位。
    //
    // 越位是这套传球设计的承重墙（D4）：没有它，最优解就是把一个前锋
    // 永久停在对方门前然后一直吊长传，短传和直塞体系立刻死亡。
    if (kind === "through") {
      if (lane < t.pass.laneRadius * 0.4) continue;
      if (isOffside(world, from.team, aimX)) continue;
    }

    if (!best || score > best.score) {
      best = { index: i, aimX, aimY, score };
    }
  }
  return best;
}

/**
 * 瞄准点：接球人【球到的时候】会在哪，而不是他现在站哪。
 *
 * 球飞过去要时间，接球人一直在跑 —— 瞄当前位置的话，他得回头追球。
 * 实测这一项让接球人平均少跑一半的路。
 *
 * 飞行时间依赖距离、距离又依赖瞄准点，所以迭代两轮就收敛了。
 */
function aimPoint(
  pos: { x: number; y: number },
  vel: { x: number; y: number },
  spaceLead: number,
  from: { x: number; y: number },
  cfg: Tuning["pass"]["short"],
  t: Tuning,
): { x: number; y: number } {
  let x = pos.x + spaceLead;
  let y = pos.y;
  for (let iter = 0; iter < 2; iter++) {
    const dist = Math.hypot(x - from.x, y - from.y);
    const flight = flightTime(dist, cfg, t);
    x = pos.x + spaceLead + vel.x * flight * t.pass.leadFactor;
    y = pos.y + vel.y * flight * t.pass.leadFactor;
  }
  return { x: clamp(x, 1, PITCH_LENGTH - 1), y: clamp(y, 1, PITCH_WIDTH - 1) };
}

/** 球飞完 dist 需要多久。地滚球和高球是两套解析解，跟 launch() 里的出球公式一一对应 */
function flightTime(dist: number, cfg: Tuning["pass"]["short"], t: Tuning): number {
  if (cfg.loft > 0) {
    const th = (cfg.loft * Math.PI) / 180;
    const v = loftSpeed(dist, th, t);
    return (2 * v * Math.sin(th)) / t.ball.gravityZ;
  }
  // 地滚：v0 = D·r + a，滚过 D 的时间 t = ln((D·r + a) / a) / r
  const r = t.ball.groundFriction;
  const a = Math.max(cfg.arriveSpeed, 0.5);
  return Math.log((dist * r + a) / a) / r;
}

/** 高球包含空气阻力；不能用真空抛物线，否则长传总在目标前落地。 */
function loftSpeed(distance: number, angle: number, t: Tuning): number {
  let low = 0, high = 60;
  for (let i = 0; i < 24; i++) {
    const v = (low + high) / 2;
    const duration = 2 * v * Math.sin(angle) / t.ball.gravityZ;
    const drag = t.ball.airDrag;
    const travel = v * Math.cos(angle) * (drag > 0 ? -Math.expm1(-drag * duration) / drag : duration);
    if (travel < distance) low = v;
    else high = v;
  }
  return (low + high) / 2;
}

/**
 * 越位判定（D4 / D21）。
 *
 * 传球【出脚瞬间】冻结一帧：接球点如果比"对方倒数第二名球员"更靠近对方球门，
 * 且比球本身更靠前，就是越位。M2 里没有对手，这一条无从判起（§10.6），
 * 现在才真正生效。
 */
export function isOffside(world: World, team: 0 | 1, aimX: number): boolean {
  const dir = attackDirOf(team);
  const xs: number[] = [];
  for (const p of world.players) if (p.team !== team) xs.push(p.pos.x * dir);
  if (xs.length < 2) return false;
  xs.sort((a, b) => b - a); // 按"离对方球门由近到远"排
  const secondLast = xs[1]!;
  const ballX = world.ball.pos.x * dir;
  const target = aimX * dir;
  if ((aimX - PITCH_LENGTH / 2) * dir <= 0) return false;
  return target > secondLast + 0.2 && target > ballX + 0.2;
}

/**
 * 传球线路上"最碍事的那个人"离线段有多远。
 *
 * 对手和队友都算，但对手更严重：
 *  - 对手挡在线路上 = 丢球权
 *  - 队友挡在线路上 = 球给了错的人（还是本方球权，但不是你想传的那个）
 *
 * 曾经改成只算对手，结果队友完全不挡路了，传球开始从人堆里硬穿，
 * "被半路接走"的比例反而上升。两者都要算，只是权重不同。
 */
function laneClearance(
  world: World,
  from: { x: number; y: number },
  toX: number,
  toY: number,
  receiver: number,
  team: 0 | 1,
): number {
  const vx = toX - from.x;
  const vy = toY - from.y;
  const len2 = vx * vx + vy * vy;
  let min = Infinity;
  for (let i = 0; i < world.players.length; i++) {
    if (i === receiver || i === world.controlled) continue;
    const p = world.players[i]!;
    const tProj = len2 < 1e-6 ? 0 : clamp(((p.pos.x - from.x) * vx + (p.pos.y - from.y) * vy) / len2, 0, 1);
    const cx = from.x + vx * tProj;
    const cy = from.y + vy * tProj;
    // 队友要挡得更近才算数（等效距离放大一倍）
    const severity = p.team === team ? 2 : 1;
    min = Math.min(min, Math.hypot(p.pos.x - cx, p.pos.y - cy) * severity);
  }
  return min === Infinity ? 99 : min;
}

/**
 * 出球。速度由【要传多远】反解，而不是拍一个常数：
 *  - 地滚球带指数衰减，最远只能滚 v0 / groundFriction，所以近传远传必须不同力度
 *  - 高球是抛体，射程 v²·sin(2θ)/g
 * 这样"传丢"是因为选错了人或方向，而不是因为力度莫名其妙。
 */
function launch(
  world: World,
  target: Candidate,
  kind: PassKind,
  t: Tuning,
  wantDist: number,
  passer = world.controlled,
): void {
  const b = world.ball;
  const from = world.players[passer]!;
  const cfg = t.pass[kind];

  const dx = target.aimX - b.pos.x;
  const dy = target.aimY - b.pos.y;
  const dist = Math.max(Math.hypot(dx, dy), 0.5);
  const nx = dx / dist;
  const ny = dy / dist;

  // 蓄力选择传球距离/接球人；既然选中了队友，就按实际落点反解力度。
  const effDist = target.index >= 0 ? dist : wantDist;

  let speed: number;
  let vz = 0;
  if (cfg.loft > 0) {
    const th = (cfg.loft * Math.PI) / 180;
    // 抛体射程反解：v = sqrt(D·g / sin 2θ)
    speed = loftSpeed(effDist, th, t);
    vz = speed * Math.sin(th);
    speed = speed * Math.cos(th);
  } else {
    // 地滚：球速按 e^(-rt) 衰减，滚过 D 之后剩余速度正好是 v0 − D·r。
    speed = effDist * t.ball.groundFriction + cfg.arriveSpeed;
  }
  speed = clamp(speed, 4, 40);

  b.owner = null;
  b.stickyLock = t.dribble.shotCooldown;
  b.pickupBlockedPlayer = passer;
  b.vel.x = nx * speed;
  b.vel.y = ny * speed;
  b.z = 0;
  b.vz = vz;
  b.spin = 0;

  world.passes += 1;
  world.matchStats[from.team].passes += 1;
  // index < 0 是"传向空档"的兜底球，没有预定接球人 —— 让 AI 按最近原则去追
  world.receiver = target.index >= 0 ? target.index : null;
  world.passHold = from.team === 0 ? t.pass.controlHoldTime : 0;
  world.lastTouch = from.team;

  // 出球瞬间冻结一帧，记下此刻处于越位位置的己方球员（D4）。
  //
  // 直塞的目标筛选已经主动躲开越位的人，但短传/长传没有这个否决 ——
  // 玩家照样可以硬往越位的人身上传。那就该在他【接到球的时候】吹掉：
  // 越位不是传球时判的，是接球时判的。
  world.offsideFlags.length = 0;
  for (let i = 0; i < world.players.length; i++) {
    const q = world.players[i]!;
    if (q.team !== from.team || i === passer) continue;
    if (isOffside(world, from.team, q.pos.x)) world.offsideFlags.push(i);
  }

}

/** AI 使用与玩家相同的球物理、越位记录和传球统计，不借用玩家控制权。 */
export function fireAIPass(world: World, t: Tuning, passer: number, receiver: number): void {
  const from = world.players[passer];
  const to = world.players[receiver];
  if (world.phase !== "playing" || world.ball.owner !== passer || !from || !to || from.team !== to.team) return;
  const aim = aimPoint(to.pos, to.vel, 0, world.ball.pos, t.pass.short, t);
  const distance = Math.hypot(aim.x - world.ball.pos.x, aim.y - world.ball.pos.y);
  launch(world, { index: receiver, aimX: aim.x, aimY: aim.y, score: 0 }, "short", t, distance, passer);
  from.holdTime = 0;
}

/** D16：把控制权交给"预测接球点最近的队友" */
function handOverControl(world: World, t: Tuning): void {
  if (world.ball.owner !== null && world.players[world.ball.owner]?.team === 0) {
    world.controlled = world.ball.owner;
    return;
  }
  if (world.receiver !== null && world.players[world.receiver]?.team === 0) {
    world.controlled = world.receiver;
    return;
  }
  void t;
}
