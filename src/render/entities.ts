import { BALL_RADIUS } from "../sim/constants.ts";
import { chargeRatio } from "../sim/action.ts";
import type { Ball, ChargeKind, LungeKind, Player, World } from "../sim/types.ts";
import { lerp, lerpAngle } from "../sim/vec.ts";
import type { Tuning } from "../tuning.ts";
import { PALETTE } from "./palette.ts";
import { PPM } from "./viewport.ts";

/**
 * 球员是纯几何图形（DESIGN.md D28）：圆形/矩形拼的小人 + 地面朝向标 + 椭圆影子。
 * M4 之前不引入任何精灵图 —— 好看的精灵会让你误以为手感变好了。
 *
 * 2.5D 的画法：脚底锚定在世界坐标 (x, y)，身体朝【屏幕上方】画。
 * 球用同一套投影画在 (x, y - z*PPM)，所以人和球的高度感是一致的。
 */

/** 渲染插值（D26）：在 prev 和 curr 之间按 alpha 取值 */
interface Interp {
  x: number;
  y: number;
  facing: number;
}

function interpPlayer(p: Player, alpha: number): Interp {
  return {
    x: lerp(p.prevPos.x, p.pos.x, alpha),
    y: lerp(p.prevPos.y, p.pos.y, alpha),
    facing: lerpAngle(p.prevFacing, p.facing, alpha),
  };
}

export function drawEntities(
  ctx: CanvasRenderingContext2D,
  world: World,
  t: Tuning,
  alpha: number,
  showDebug: boolean,
  nextDefender: number | null = null,
  switchKey = "J",
): void {
  drawRestartSpot(ctx, world);
  if (showDebug) drawAimPoints(ctx, world);
  const drawn = world.players.map((p) => ({ p, i: interpPlayer(p, alpha) }));

  // 1) 全部影子和地面标记 —— 先画完，避免影子盖住别人的身体
  for (const { p, i } of drawn) {
    drawGroundMarks(ctx, i, p === world.players[world.controlled], p.lunge, p.lungeKind, p.dive);
  }
  drawBallShadow(ctx, world.ball, alpha);

  // 2) 身体按 y 排序：y 大的（靠近镜头下方）后画，实现前后遮挡
  drawn.sort((a, b) => a.i.y - b.i.y);
  for (const { p, i } of drawn) drawBody(ctx, p, i, world.time);

  // 控球人和预定接球人使用不同的标记，切人时不会失去方向。
  const controlled = drawn.find((d) => d.p === world.players[world.controlled]);
  if (controlled) {
    const x = Math.round(controlled.i.x * PPM);
    const y = Math.round(controlled.i.y * PPM) - 22;
    ctx.fillStyle = PALETTE.accent;
    ctx.beginPath();
    ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4); ctx.fill();
  }
  if (nextDefender !== null && nextDefender !== world.controlled) {
    const next = drawn.find(d => d.p === world.players[nextDefender]);
    if (next) {
      ctx.save();
      const x = Math.round(next.i.x * PPM);
      const y = Math.round(next.i.y * PPM) - 22;
      ctx.strokeStyle = "#eff2e8";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 4); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = "#eff2e8";
      ctx.font = "5px monospace";
      ctx.textAlign = "center";
      ctx.fillText(switchKey, x, y - 2);
      ctx.restore();
    }
  }
  if (world.receiver !== null && world.receiver !== world.controlled && world.players[world.receiver]?.team === 0) {
    const receiver = drawn.find((d) => d.p === world.players[world.receiver!]);
    if (receiver) {
      const x = Math.round(receiver.i.x * PPM);
      const y = Math.round(receiver.i.y * PPM) - 20;
      ctx.strokeStyle = PALETTE.chargeLow;
      ctx.strokeRect(x - 3, y - 3, 6, 6);
    }
  }

  // 3) 球最后画：任何情况下都不能被挡住
  drawBall(ctx, world.ball, alpha);

  // 4) 蓄力条跟在人头顶，眼睛不用离开球。射门和三种传球共用（action.ts）
  if (world.charge.kind !== null) {
    const me = drawn.find((d) => d.p === world.players[world.controlled]);
    if (me) drawChargeBar(ctx, me.i, chargeRatio(world, t), world.charge.kind);
  }
}

function drawGroundMarks(
  ctx: CanvasRenderingContext2D,
  i: Interp,
  isControlled: boolean,
  lunge: number,
  kind: LungeKind,
  dive: number,
): void {
  const sx = Math.round(i.x * PPM);
  const sy = Math.round(i.y * PPM);

  // 受控球员的地面指示环
  if (isControlled) {
    ctx.strokeStyle = PALETTE.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(sx + 0.5, sy + 0.5, 6, 3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 出脚判定窗口开着时，脚下画一个亮弧，看得出"这一脚已经出去了"。
  // 抢断和铲球用不同颜色和大小 —— 两种出脚的射程差一倍，看不出区别就没法判断距离
  if (lunge > 0 || dive > 0) {
    const isSlide = kind === "slide" || dive > 0;
    ctx.strokeStyle = isSlide ? PALETTE.homeShirt : PALETTE.chargeHigh;
    ctx.beginPath();
    ctx.ellipse(sx, sy, isSlide ? 15 : 9, isSlide ? 7.5 : 4.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 影子
  ctx.fillStyle = PALETTE.shadow;
  ctx.beginPath();
  ctx.ellipse(sx, sy, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // 朝向标：地面上的短箭头。俯视角下看不出人朝哪，这个标是唯一线索
  const dx = Math.cos(i.facing);
  const dy = Math.sin(i.facing) * 0.55; // 压扁，读起来像躺在地面上
  ctx.fillStyle = isControlled ? PALETTE.accent : PALETTE.lineFaint;
  ctx.beginPath();
  ctx.moveTo(sx + dx * 8, sy + dy * 8);
  ctx.lineTo(sx + dx * 4 - dy * 3, sy + dy * 4 + dx * 3);
  ctx.lineTo(sx + dx * 4 + dy * 3, sy + dy * 4 - dx * 3);
  ctx.closePath();
  ctx.fill();
}

function drawBody(ctx: CanvasRenderingContext2D, p: Player, i: Interp, time: number): void {
  const sx = Math.round(i.x * PPM);
  const sy = Math.round(i.y * PPM);
  // 22 个人在场上，颜色必须一眼分得出：己方红、对方白、两个门将各自另一色
  const isGK = p.slot === 0;
  const shirt = isGK
    ? p.team === 0
      ? PALETTE.gkHome
      : PALETTE.gkAway
    : p.team === 0
      ? PALETTE.homeShirt
      : PALETTE.awayShirt;
  const shirtDark = isGK
    ? p.team === 0
      ? PALETTE.gkHomeDark
      : PALETTE.gkAwayDark
    : p.team === 0
      ? PALETTE.homeShirtDark
      : PALETTE.awayShirtDark;

  // 铲球中 / 铲完趴在地上：整个人压扁躺倒，一眼能看出"这人现在动不了"
  // 铲球中 / 门将鱼跃中 / 趴在地上起不来：都画成横躺的姿势
  const grounded = p.lungeKind === "slide" || p.dive > 0 || (p.stun > 0 && p.stun > 0.5);
  if (grounded) {
    const dx = Math.cos(i.facing);
    const dy = Math.sin(i.facing) * 0.55;
    ctx.fillStyle = shirt;
    ctx.fillRect(sx - 3, sy - 4, 6, 4);
    ctx.fillStyle = PALETTE.skin;
    ctx.fillRect(Math.round(sx + dx * 4) - 2, Math.round(sy + dy * 4) - 3, 4, 3);
    ctx.fillStyle = PALETTE.boots;
    ctx.fillRect(Math.round(sx - dx * 4) - 2, Math.round(sy - dy * 4) - 2, 4, 2);
    if (p.stun > 0) {
      ctx.fillStyle = PALETTE.stun;
      ctx.fillRect(sx - 1, sy - 9, 3, 2);
    }
    return;
  }

  // 腿
  const stride = Math.hypot(p.vel.x, p.vel.y) > 0.5 ? Math.round(Math.sin(time * 18 + p.slot) * 2) : 0;
  ctx.fillStyle = PALETTE.boots;
  ctx.fillRect(sx - 2, sy - 3 + stride, 2, 3);
  ctx.fillRect(sx, sy - 3 - stride, 2, 3);
  ctx.fillStyle = PALETTE.skin;
  ctx.fillRect(sx - 4, sy - 8 - stride, 1, 3);
  ctx.fillRect(sx + 3, sy - 8 + stride, 1, 3);

  // 躯干（下半段用暗色，给一点体积感）
  ctx.fillStyle = shirt;
  ctx.fillRect(sx - 3, sy - 9, 6, 6);
  ctx.fillStyle = shirtDark;
  ctx.fillRect(sx - 3, sy - 4, 6, 1);

  // 头
  ctx.fillStyle = PALETTE.skin;
  ctx.fillRect(sx - 2, sy - 13, 4, 4);
  ctx.fillStyle = PALETTE.hair;
  ctx.fillRect(sx - 2, sy - 13, 4, 1);

  // 硬直中：头顶画一颗灰点。铲球落空的代价必须看得见，否则玩家不会知道自己为什么动不了
  if (p.stun > 0) {
    ctx.fillStyle = PALETTE.stun;
    ctx.fillRect(sx - 1, sy - 17, 3, 2);
  }
}

function drawBallShadow(
  ctx: CanvasRenderingContext2D,
  b: Ball,
  alpha: number,
): void {
  const x = lerp(b.prevPos.x, b.pos.x, alpha);
  const y = lerp(b.prevPos.y, b.pos.y, alpha);
  const z = Math.max(0, lerp(b.prevZ, b.z, alpha));
  const sx = Math.round(x * PPM);
  const sy = Math.round(y * PPM);

  // 越高，影子越大越淡 —— 这是判断球高度和落点的唯一视觉线索（D8）
  const r = 2 + z * 0.22;
  ctx.fillStyle = `rgba(0,0,0,${(0.4 / (1 + z * 0.3)).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBall(ctx: CanvasRenderingContext2D, b: Ball, alpha: number): void {
  const x = lerp(b.prevPos.x, b.pos.x, alpha);
  const y = lerp(b.prevPos.y, b.pos.y, alpha);
  const z = Math.max(0, lerp(b.prevZ, b.z, alpha));
  const sx = Math.round(x * PPM);
  const sy = Math.round(y * PPM - z * PPM);

  // 物理半径 0.11m 只有 0.9px，画不出来 —— 视觉上放大到 3px，这是像素风的常规做法
  void BALL_RADIUS;
  ctx.fillStyle = PALETTE.ballShade;
  ctx.fillRect(sx - 2, sy - 2, 4, 4);
  ctx.fillStyle = PALETTE.ball;
  ctx.fillRect(sx - 2, sy - 2, 3, 3);
}

/** 力度条。颜色区分是在蓄射门还是蓄传球 —— 四个键共用一条，得看得出蓄的是哪个 */
function drawChargeBar(
  ctx: CanvasRenderingContext2D,
  i: Interp,
  ratio: number,
  kind: ChargeKind,
): void {
  const sx = Math.round(i.x * PPM);
  const sy = Math.round(i.y * PPM) - 18;
  const w = 18;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 5);
  ctx.fillStyle =
    kind === "shot"
      ? ratio > 0.75
        ? PALETTE.chargeHigh
        : PALETTE.chargeLow
      : PALETTE.accent;
  ctx.fillRect(sx - w / 2, sy, Math.round(w * Math.min(1, ratio)), 3);
}

/**
 * 调试：把每个 AI 的目标点画出来。
 *
 * "这个前锋为什么不插上" —— 看不见目标点就只能靠猜，
 * 而 D18/D19 选锚点方案而不是全场势场，图的就是行为可解释。
 */
function drawAimPoints(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.strokeStyle = "rgba(126, 224, 138, 0.45)";
  ctx.lineWidth = 1;
  for (let i = 0; i < world.players.length; i++) {
    if (i === world.controlled) continue;
    const p = world.players[i]!;
    const ax = Math.round(p.aim.x * PPM);
    const ay = Math.round(p.aim.y * PPM);
    ctx.beginPath();
    ctx.moveTo(ax - 2, ay);
    ctx.lineTo(ax + 2, ay);
    ctx.moveTo(ax, ay - 2);
    ctx.lineTo(ax, ay + 2);
    ctx.stroke();
    // 一条淡线连到本人，好看出"谁在往哪跑"
    ctx.strokeStyle = "rgba(126, 224, 138, 0.14)";
    ctx.beginPath();
    ctx.moveTo(Math.round(p.pos.x * PPM), Math.round(p.pos.y * PPM));
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.strokeStyle = "rgba(126, 224, 138, 0.45)";
  }
}

/**
 * 死球时在开球点画一圈虚线。
 *
 * 没有它，比赛停下来的时候玩家只看到一堆人突然瞬移，完全不知道发生了什么 ——
 * 判罚提示说"角球"，但角球在哪儿得看得见。
 */
function drawRestartSpot(ctx: CanvasRenderingContext2D, world: World): void {
  const r = world.restart;
  if (!r) return;
  const x = Math.round(r.at.x * PPM);
  const y = Math.round(r.at.y * PPM);
  ctx.strokeStyle = PALETTE.accent;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.arc(x + 0.5, y + 0.5, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}
