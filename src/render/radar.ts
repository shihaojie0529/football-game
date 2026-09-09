import {
  CENTER_X,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from "../sim/constants.ts";
import type { World } from "../sim/types.ts";
import type { Camera } from "./camera.ts";
import { PALETTE } from "./palette.ts";
import { VIEW_HEIGHT, VIEW_METERS_X, VIEW_METERS_Y, VIEW_WIDTH } from "./viewport.ts";

const W = 138;
const H = Math.round((W * PITCH_WIDTH) / PITCH_LENGTH); // 89
const MARGIN = 5;
export const RADAR_RECT = { x: VIEW_WIDTH - W - MARGIN, y: VIEW_HEIGHT - H - MARGIN, width: W, height: H };

/**
 * 雷达小地图（DESIGN.md D10）。
 *
 * 这不是装饰品。可视范围只有 60×34 米而球场宽 68 米 ——
 * 你永远看不到对面边路的队友。没有雷达，长传和直塞就只能瞎蒙。
 *
 * 顺带画出当前镜头框，因为"我看得见的那块在全场的哪儿"同样是瞎蒙的来源。
 */
export function drawRadar(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
): void {
  const x0 = RADAR_RECT.x;
  const y0 = RADAR_RECT.y;
  const sx = W / PITCH_LENGTH;
  const sy = H / PITCH_WIDTH;
  const px = (mx: number) => x0 + Math.round(mx * sx);
  const py = (my: number) => y0 + Math.round(my * sy);

  ctx.fillStyle = "rgba(10, 26, 14, 0.78)";
  ctx.fillRect(x0, y0, W, H);
  ctx.strokeStyle = PALETTE.lineFaint;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, W - 1, H - 1);
  ctx.beginPath();
  ctx.moveTo(px(CENTER_X) + 0.5, y0);
  ctx.lineTo(px(CENTER_X) + 0.5, y0 + H);
  ctx.stroke();

  // 当前镜头框
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.strokeRect(
    px(camera.x - VIEW_METERS_X / 2) + 0.5,
    py(camera.y - VIEW_METERS_Y / 2) + 0.5,
    Math.round(VIEW_METERS_X * sx),
    Math.round(VIEW_METERS_Y * sy),
  );

  for (let i = 0; i < world.players.length; i++) {
    const p = world.players[i]!;
    const isMe = i === world.controlled;
    ctx.fillStyle = isMe
      ? PALETTE.accent
      : p.slot === 0
        ? p.team === 0
          ? PALETTE.gkHome
          : PALETTE.gkAway
        : p.team === 0
          ? PALETTE.homeShirt
          : PALETTE.awayShirt;
    const r = isMe ? 2 : 1;
    ctx.fillRect(px(p.pos.x) - r, py(p.pos.y) - r, r * 2 + 1, r * 2 + 1);
  }

  // 球最后画，永远看得见
  ctx.fillStyle = PALETTE.ball;
  ctx.fillRect(px(world.ball.pos.x) - 1, py(world.ball.pos.y) - 1, 3, 3);
}
