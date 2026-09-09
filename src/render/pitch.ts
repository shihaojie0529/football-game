import {
  CENTER_CIRCLE_R,
  CENTER_X,
  CENTER_Y,
  GOAL_BOX_DEPTH,
  GOAL_BOX_WIDTH,
  GOAL_DEPTH,
  GOAL_HEIGHT,
  GOAL_WIDTH,
  MARGIN,
  PENALTY_BOX_DEPTH,
  PENALTY_BOX_WIDTH,
  PENALTY_SPOT_DIST,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from "../sim/constants.ts";
import { PALETTE } from "./palette.ts";
import { PPM } from "./viewport.ts";

const STRIPES = 20;

/**
 * 球场是纯 canvas 绘制，零美术资源（D28）。
 * 上下文已经被 translate 到相机原点，这里全部用世界米坐标 × PPM。
 */
export function drawPitch(ctx: CanvasRenderingContext2D): void {
  // 外围草地
  ctx.fillStyle = PALETTE.outfieldDark;
  ctx.fillRect(
    m(-MARGIN),
    m(-MARGIN),
    m(PITCH_LENGTH + MARGIN * 2),
    m(PITCH_WIDTH + MARGIN * 2),
  );

  // 场内割草条纹
  const stripeW = PITCH_LENGTH / STRIPES;
  for (let i = 0; i < STRIPES; i++) {
    ctx.fillStyle = i % 2 === 0 ? PALETTE.grassDark : PALETTE.grassLight;
    const x0 = Math.round(i * stripeW * PPM);
    const x1 = Math.round((i + 1) * stripeW * PPM);
    ctx.fillRect(x0, 0, x1 - x0, m(PITCH_WIDTH));
  }

  ctx.strokeStyle = PALETTE.line;
  ctx.lineWidth = 1;

  strokeRect(ctx, 0, 0, PITCH_LENGTH, PITCH_WIDTH);

  // 中线 + 中圈 + 中点
  line(ctx, CENTER_X, 0, CENTER_X, PITCH_WIDTH);
  circle(ctx, CENTER_X, CENTER_Y, CENTER_CIRCLE_R);
  dot(ctx, CENTER_X, CENTER_Y);

  for (const side of [0, 1] as const) {
    const flip = side === 0 ? 1 : -1;
    const baseX = side === 0 ? 0 : PITCH_LENGTH;

    strokeRect(
      ctx,
      side === 0 ? 0 : PITCH_LENGTH - PENALTY_BOX_DEPTH,
      CENTER_Y - PENALTY_BOX_WIDTH / 2,
      PENALTY_BOX_DEPTH,
      PENALTY_BOX_WIDTH,
    );
    strokeRect(
      ctx,
      side === 0 ? 0 : PITCH_LENGTH - GOAL_BOX_DEPTH,
      CENTER_Y - GOAL_BOX_WIDTH / 2,
      GOAL_BOX_DEPTH,
      GOAL_BOX_WIDTH,
    );
    dot(ctx, baseX + flip * PENALTY_SPOT_DIST, CENTER_Y);

    // 角球弧
    cornerArc(ctx, baseX, 0, flip, 1);
    cornerArc(ctx, baseX, PITCH_WIDTH, flip, -1);
  }
}

/**
 * 球门（2.5D 的关键道具）。
 *
 * 门柱从地面向【屏幕上方】延伸 GOAL_HEIGHT × PPM，横梁就是球门线整体上移同样距离。
 * 因为球也是画在 (x, y - z*PPM)，两者用的是同一套投影 ——
 * 于是"球从横梁下方钻过去"和"打飞机"在画面上是自洽的，不需要额外的判定提示。
 */
export function drawGoals(ctx: CanvasRenderingContext2D): void {
  for (const side of [0, 1] as const) {
    const gx = side === 0 ? 0 : PITCH_LENGTH;
    const outward = side === 0 ? -GOAL_DEPTH : GOAL_DEPTH;
    const y0 = CENTER_Y - GOAL_WIDTH / 2;
    const y1 = CENTER_Y + GOAL_WIDTH / 2;
    const barH = GOAL_HEIGHT * PPM;

    // 球门内的地面（网底）
    ctx.fillStyle = PALETTE.net;
    ctx.fillRect(m(Math.min(gx, gx + outward)), m(y0), m(GOAL_DEPTH), m(GOAL_WIDTH));

    // 网面（球门线上移一份高度，形成"立面"）
    ctx.fillStyle = PALETTE.net;
    ctx.fillRect(
      m(Math.min(gx, gx + outward)),
      m(y0) - barH,
      m(GOAL_DEPTH),
      m(GOAL_WIDTH),
    );

    ctx.strokeStyle = PALETTE.post;
    ctx.lineWidth = 1;
    // 两根门柱
    lineRaw(ctx, m(gx), m(y0), m(gx), m(y0) - barH);
    lineRaw(ctx, m(gx), m(y1), m(gx), m(y1) - barH);
    // 横梁
    lineRaw(ctx, m(gx), m(y0) - barH, m(gx), m(y1) - barH);
    // 地面上的门线
    ctx.strokeStyle = PALETTE.lineFaint;
    lineRaw(ctx, m(gx), m(y0), m(gx), m(y1));
  }
}

const m = (v: number): number => Math.round(v * PPM);
const h = (v: number): number => Math.round(v * PPM) + 0.5;

function strokeRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  hh: number,
): void {
  ctx.strokeRect(h(x), h(y), Math.round(w * PPM), Math.round(hh * PPM));
}

function line(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  lineRaw(ctx, h(x0), h(y0), h(x1), h(y1));
}

function lineRaw(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.arc(h(x), h(y), r * PPM, 0, Math.PI * 2);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = PALETTE.line;
  ctx.fillRect(m(x) - 1, m(y) - 1, 2, 2);
}

function cornerArc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
): void {
  const start = Math.atan2(dirY, 0);
  ctx.strokeStyle = PALETTE.lineFaint;
  ctx.beginPath();
  ctx.arc(
    h(x),
    h(y),
    1 * PPM,
    dirY > 0 ? (dirX > 0 ? 0 : Math.PI / 2) : dirX > 0 ? -Math.PI / 2 : Math.PI,
    dirY > 0 ? (dirX > 0 ? Math.PI / 2 : Math.PI) : dirX > 0 ? 0 : Math.PI * 1.5,
  );
  ctx.stroke();
  ctx.strokeStyle = PALETTE.line;
  void start;
}
