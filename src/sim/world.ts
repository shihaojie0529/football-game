import {
  BALL_RADIUS,
  CENTER_X,
  CENTER_Y,
  MATCH_LENGTH,
  PLAYER_RADIUS,
} from "./constants.ts";
import { FORMATION_442, slotAnchor } from "./formation.ts";
import { attackDirOf, emptyTeamStats, type Ball, type Player, type World } from "./types.ts";
import { clone, vec } from "./vec.ts";

const KICKOFF_TUNING = { spreadGain: 0.28, followScale: 1, defensiveDrop: 0 };

function makePlayer(x: number, y: number, slot: number, team: 0 | 1): Player {
  const pos = vec(x, y);
  return {
    pos,
    prevPos: clone(pos),
    vel: vec(),
    facing: team === 0 ? 0 : Math.PI,
    prevFacing: team === 0 ? 0 : Math.PI,
    radius: PLAYER_RADIUS,
    slot,
    team,
    aim: vec(x, y),
    stun: 0,
    lunge: 0,
    lungeKind: null,
    tackleCooldown: 0,
    holdTime: 0,
    pressTime: 0,
    dive: 0,
  };
}

function makeBall(x: number, y: number): Ball {
  const pos = vec(x, y);
  return {
    pos,
    prevPos: clone(pos),
    vel: vec(),
    z: 0,
    prevZ: 0,
    vz: 0,
    spin: 0,
    owner: null,
    stickyLock: 0,
    pickupBlockedPlayer: null,
  };
}

/**
 * M3 场景（DESIGN.md §5）：22 人。
 * 0~10 是玩家的队伍（朝 +x 进攻），11~21 是对手（朝 -x）。
 * 索引布局固定，`world.players[i].team` 才是判断依据 —— 别靠索引范围写逻辑。
 */
export function createWorld(): World {
  const ballStart = vec(CENTER_X, CENTER_Y);
  const players: Player[] = [];
  for (const team of [0, 1] as const) {
    FORMATION_442.forEach((slot, i) => {
      const a = slotAnchor(slot, ballStart, KICKOFF_TUNING, undefined, attackDirOf(team));
      players.push(makePlayer(a.x, a.y, i, team));
    });
  }

  const world: World = {
    matchStats: [emptyTeamStats(), emptyTeamStats()],
    players,
    // 开球默认控中前卫，离球最近、不是门将
    controlled: 6,
    ball: makeBall(ballStart.x, ballStart.y),
    charge: { kind: null, time: 0 },
    actionWasHeld: { shot: false, short: false, through: false, long: false },
    goals: [0, 0],
    shots: 0,
    tackles: 0,
    tacklesWon: 0,
    passes: 0,
    passHold: 0,
    switchLock: 0,
    switchInputLock: 0,
    switchManualChain: 0,
    switchLooseUsed: false,
    receiver: null,
    goalFlash: 0,
    lastScorer: 0,
    officiating: true,
    phase: "playing",
    restart: null,
    restartTimer: 0,
    clock: MATCH_LENGTH,
    lastTouch: null,
    offsideFlags: [],
    eventLabel: "",
    eventTimer: 0,
    time: 0,
  };
  resetKickoff(world);
  return world;
}

/**
 * 全队回到阵型位置，球回中圈。
 *
 * 进球后和手动重置都走这里。`fullReset` 为 true 时连比分和时钟一起清 ——
 * 进球只需要重新开球，不该把比分抹掉。
 */
export function resetKickoff(world: World, fullReset = false, matchLength = MATCH_LENGTH): void {
  const b = world.ball;
  b.pos.x = CENTER_X;
  b.pos.y = CENTER_Y;
  b.prevPos.x = b.pos.x;
  b.prevPos.y = b.pos.y;
  b.vel.x = 0;
  b.vel.y = 0;
  b.z = 0;
  b.prevZ = 0;
  b.vz = 0;
  b.spin = 0;
  b.owner = null;
  b.stickyLock = 0;
  b.pickupBlockedPlayer = null;

  for (const p of world.players) {
    const a = slotAnchor(
      FORMATION_442[p.slot]!,
      b.pos,
      KICKOFF_TUNING,
      undefined,
      attackDirOf(p.team),
    );
    p.pos.x = a.x;
    p.pos.y = a.y;
    p.prevPos.x = a.x;
    p.prevPos.y = a.y;
    p.aim.x = a.x;
    p.aim.y = a.y;
    p.vel.x = 0;
    p.vel.y = 0;
    p.facing = p.team === 0 ? 0 : Math.PI;
    p.prevFacing = p.facing;
    p.stun = 0;
    p.lunge = 0;
    p.lungeKind = null;
    p.tackleCooldown = 0;
    p.holdTime = 0;
    p.pressTime = 0;
    p.dive = 0;
  }

  // 开场和重置都先等待玩家开球，不能让 AI 直接开始逼抢。
  if (!world.players[world.controlled] || world.players[world.controlled]!.team !== 0 ||
      world.players[world.controlled]!.slot === 0) {
    world.controlled = world.players.findIndex((p) => p.team === 0 && p.slot !== 0);
  }
  const me = world.players[world.controlled]!;
  me.pos.x = CENTER_X - (PLAYER_RADIUS + BALL_RADIUS + 0.6);
  me.pos.y = CENTER_Y;
  me.prevPos.x = me.pos.x;
  me.prevPos.y = me.pos.y;

  world.charge.kind = null;
  world.charge.time = 0;
  world.passHold = 0;
  world.switchLock = 0;
  world.switchInputLock = 0;
  world.switchManualChain = 0;
  world.switchLooseUsed = false;
  world.receiver = null;
  world.lastTouch = null;
  world.offsideFlags.length = 0;
  world.phase = "restart";
  world.restart = {
    kind: "kickoff", team: 0, at: { x: CENTER_X, y: CENTER_Y },
    taker: world.controlled, label: "开球", stage: "ready", fetchTimeout: 0,
  };
  b.owner = world.controlled;
  world.eventLabel = "开球";
  world.actionWasHeld = { shot: false, short: false, through: false, long: false };
  world.restartTimer = 0;

  if (fullReset) {
    world.matchStats = [emptyTeamStats(), emptyTeamStats()];
    world.goalFlash = 0;
    world.goals[0] = 0;
    world.goals[1] = 0;
    world.shots = 0;
    world.passes = 0;
    world.tackles = 0;
    world.tacklesWon = 0;
    world.clock = matchLength;
    world.eventTimer = 0;
    world.time = 0;
  }
}
