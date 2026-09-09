import { MARGIN, PITCH_LENGTH, PITCH_WIDTH } from "../sim/constants.ts";
import type { World } from "../sim/types.ts";
import { clamp } from "../sim/vec.ts";
import type { Tuning } from "../tuning.ts";
import { VIEW_METERS_X, VIEW_METERS_Y } from "./viewport.ts";

/**
 * 跟随球的相机 + 前瞻偏移（DESIGN.md D9）。
 *
 * 相机是【表现】不是【模拟】，所以它活在 render 层，用真实帧 dt 更新 ——
 * 这样高刷屏上镜头更顺滑，而物理仍然是 60Hz 固定步。
 *
 * 刻意不做死死居中：镜头朝球的运动方向提前一点，长传/射门时能先看到落点。
 */
export class Camera {
  /** 相机中心，世界坐标（米） */
  x = PITCH_LENGTH / 2;
  y = PITCH_WIDTH / 2;

  update(world: World, t: Tuning, dt: number): void {
    const b = world.ball;
    const lead = Math.min(t.camera.lookahead, 1);
    let tx = b.pos.x + b.vel.x * lead;
    let ty = b.pos.y + b.vel.y * lead;

    const dx = tx - b.pos.x;
    const dy = ty - b.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > t.camera.maxLookahead) {
      tx = b.pos.x + (dx / d) * t.camera.maxLookahead;
      ty = b.pos.y + (dy / d) * t.camera.maxLookahead;
    }

    // 与帧率无关的指数逼近
    const k = 1 - Math.exp(-t.camera.lerp * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.clampToWorld();
  }

  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.clampToWorld();
  }

  private clampToWorld(): void {
    const halfW = VIEW_METERS_X / 2;
    const halfH = VIEW_METERS_Y / 2;
    const minX = -MARGIN + halfW;
    const maxX = PITCH_LENGTH + MARGIN - halfW;
    const minY = -MARGIN + halfH;
    const maxY = PITCH_WIDTH + MARGIN - halfH;
    this.x = minX > maxX ? PITCH_LENGTH / 2 : clamp(this.x, minX, maxX);
    this.y = minY > maxY ? PITCH_WIDTH / 2 : clamp(this.y, minY, maxY);
  }
}
