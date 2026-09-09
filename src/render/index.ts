import type { DefenderSelection } from "../sim/switching.ts";
import type { World } from "../sim/types.ts";
import type { Tuning } from "../tuning.ts";
import type { Camera } from "./camera.ts";
import { drawEntities } from "./entities.ts";
import { drawHud, type HudStats } from "./hud.ts";
import { PALETTE } from "./palette.ts";
import { drawGoals, drawPitch } from "./pitch.ts";
import { drawRadar } from "./radar.ts";
import { PPM, VIEW_HEIGHT, VIEW_WIDTH } from "./viewport.ts";

/**
 * 渲染层的唯一入口。
 *
 * 它只【读】world，从不写。sim 层完全不知道这个文件存在（DESIGN.md D25）——
 * 这是将来能换 PixiJS/WebGL 而不重写的全部保证。
 */
export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  tuning: Tuning,
  alpha: number,
  stats: HudStats,
  selection?: DefenderSelection,
): void {
  ctx.fillStyle = PALETTE.outfieldDark;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

  ctx.save();
  // 相机取整到整数像素：不取整的话草地条纹和白线会在移动时抖动、糊边
  const ox = Math.round(VIEW_WIDTH / 2 - camera.x * PPM);
  const oy = Math.round(VIEW_HEIGHT / 2 - camera.y * PPM);
  ctx.translate(ox, oy);

  drawPitch(ctx);
  drawGoals(ctx);
  drawEntities(ctx, world, tuning, alpha, stats.showDebug, selection?.next ?? null, stats.switchKey ?? "J");

  ctx.restore();

  drawRadar(ctx, world, camera);
  drawHud(ctx, world, stats);
}
