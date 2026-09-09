import type { Tuning } from "../tuning.ts";
import {
  BALL_RADIUS,
  PLAYER_HEIGHT,
  MARGIN,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from "./constants.ts";
import type { World } from "./types.ts";

/**
 * 圆-圆碰撞：把移动方推出去，并把速度中【朝向对方】的分量清掉。
 *
 * 清分量而不是清整个速度，是"绕着假人变向不会被卡住"的关键（M1 验收标准 3）：
 * 切向速度保留下来，球员会贴着假人滑过去，而不是撞上就定住。
 */
export function resolveCollisions(world: World, t: Tuning): void {
  // 全员两两推开。M1 只处理了"玩家 vs 静止假人"，M2 场上 11 个人都在跑，
  // 不做全对会看到队友互相穿模叠在一起。11 个人 55 对，代价可以忽略。
  const n = world.players.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = world.players[i]!;
      const b = world.players[j]!;
      const dx = a.pos.x - b.pos.x;
      const dy = a.pos.y - b.pos.y;
      const dist = Math.hypot(dx, dy);
      const minDist = a.radius + b.radius;
      if (dist >= minDist) continue;

      // 完全重合时随便挑个方向推开，避免除零
      const nx = dist > 1e-6 ? dx / dist : 1;
      const ny = dist > 1e-6 ? dy / dist : 0;
      const push = (minDist - dist) / 2;
      a.pos.x += nx * push;
      a.pos.y += ny * push;
      b.pos.x -= nx * push;
      b.pos.y -= ny * push;

      // 速度里"朝对方去"的分量清掉，切向保留 —— 这样是贴着滑过去，不是撞上就定住
      const van = a.vel.x * nx + a.vel.y * ny;
      if (van < 0) {
        a.vel.x -= nx * van;
        a.vel.y -= ny * van;
      }
      const vbn = b.vel.x * -nx + b.vel.y * -ny;
      if (vbn < 0) {
        b.vel.x += nx * vbn;
        b.vel.y += ny * vbn;
      }
    }
  }

  // 自由球撞到人会弹开；被控球时球穿过人（否则带球时球会被自己人踢飞）
  const ball = world.ball;
  if (ball.owner === null && ball.z < PLAYER_HEIGHT) {
    for (let i = 0; i < n; i++) {
      if (ball.stickyLock > 0 && ball.pickupBlockedPlayer === i) continue;
      const other = world.players[i]!;
      const dx = ball.pos.x - other.pos.x;
      const dy = ball.pos.y - other.pos.y;
      const dist = Math.hypot(dx, dy);
      const minDist = other.radius + BALL_RADIUS;
      if (dist >= minDist) continue;
      const nx = dist > 1e-6 ? dx / dist : 1;
      const ny = dist > 1e-6 ? dy / dist : 0;
      ball.pos.x = other.pos.x + nx * minDist;
      ball.pos.y = other.pos.y + ny * minDist;
      const vn = ball.vel.x * nx + ball.vel.y * ny;
      if (vn < 0) {
        ball.vel.x -= nx * vn * 1.6;
        ball.vel.y -= ny * vn * 1.6;
        ball.stickyLock = Math.max(ball.stickyLock, t.dribble.detachCooldown);
        ball.pickupBlockedPlayer = null;
      }
    }
  }

  clampToBounds(world);
}

/**
 * 球员始终被限制在场地范围内。
 *
 * 球的围栏从 M4 起只是【安全网】：出界由 rules.ts 判罚，球一越线就死球，
 * 正常情况下根本碰不到围栏。留着它是防止死球期间或异常状态下球飞丢。
 */
function clampToBounds(world: World): void {
  const minX = -MARGIN;
  const maxX = PITCH_LENGTH + MARGIN;
  const minY = -MARGIN;
  const maxY = PITCH_WIDTH + MARGIN;

  for (const me of world.players) {
    if (me.pos.x < minX + me.radius) {
      me.pos.x = minX + me.radius;
      me.vel.x = Math.max(0, me.vel.x);
    }
    if (me.pos.x > maxX - me.radius) {
      me.pos.x = maxX - me.radius;
      me.vel.x = Math.min(0, me.vel.x);
    }
    if (me.pos.y < minY + me.radius) {
      me.pos.y = minY + me.radius;
      me.vel.y = Math.max(0, me.vel.y);
    }
    if (me.pos.y > maxY - me.radius) {
      me.pos.y = maxY - me.radius;
      me.vel.y = Math.min(0, me.vel.y);
    }
  }

  const b = world.ball;
  if (b.owner !== null) return;
  const restitution = 0.5;
  if (b.pos.x < minX + BALL_RADIUS) {
    b.pos.x = minX + BALL_RADIUS;
    b.vel.x = Math.abs(b.vel.x) * restitution;
  }
  if (b.pos.x > maxX - BALL_RADIUS) {
    b.pos.x = maxX - BALL_RADIUS;
    b.vel.x = -Math.abs(b.vel.x) * restitution;
  }
  if (b.pos.y < minY + BALL_RADIUS) {
    b.pos.y = minY + BALL_RADIUS;
    b.vel.y = Math.abs(b.vel.y) * restitution;
  }
  if (b.pos.y > maxY - BALL_RADIUS) {
    b.pos.y = maxY - BALL_RADIUS;
    b.vel.y = -Math.abs(b.vel.y) * restitution;
  }
}
