import type { World } from "../sim/types.ts";
import { nextDefender, type DefenderSelection, type DefenderView } from "../sim/switching.ts";
import type { Tuning } from "../tuning.ts";
import type { Camera } from "./camera.ts";
import { RADAR_RECT } from "./radar.ts";
import { PPM, VIEW_WIDTH, VIEW_HEIGHT } from "./viewport.ts";

/** 与实际画面使用同一个取整偏移，并给球员身体和头顶标记留出边距。 */
export function defenderView(camera: Camera): DefenderView {
  const ox = Math.round(VIEW_WIDTH / 2 - camera.x * PPM);
  const oy = Math.round(VIEW_HEIGHT / 2 - camera.y * PPM);
  return {
    bounds: { minX: (8 - ox) / PPM, maxX: (VIEW_WIDTH - 8 - ox) / PPM,
      minY: (30 - oy) / PPM, maxY: (VIEW_HEIGHT - 8 - oy) / PPM },
    obscured: [{ minX: (RADAR_RECT.x - 8 - ox) / PPM,
      maxX: (RADAR_RECT.x + RADAR_RECT.width + 8 - ox) / PPM,
      minY: (RADAR_RECT.y - 4 - oy) / PPM,
      maxY: (RADAR_RECT.y + RADAR_RECT.height + 24 - oy) / PPM }],
  };
}

export function defenderSelection(world: World, camera: Camera, t: Tuning): DefenderSelection {
  const view = defenderView(camera);
  return { view, controlled: world.controlled, next: nextDefender(world, t, view) };
}
