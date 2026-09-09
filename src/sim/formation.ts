import {
  CENTER_X,
  CENTER_Y,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from "./constants.ts";
import type { Vec2 } from "./vec.ts";
import { clamp } from "./vec.ts";

/**
 * 阵型锚点系统（DESIGN.md D18）。
 *
 * 每个位置有一个归一化基准点 + 一个"活动矩形"限制它能漂多远。
 * 球的位置决定整个阵型的平移：离球近的位置跟得多，后卫跟得少。
 * 进攻时横向展开，防守时纵向压缩。
 *
 * 选这个方案而不是全场势场，是因为它便宜且【行为可解释】——
 * 球员做出奇怪跑位时你能立刻说清是哪个数导致的。
 */

export type Role = "GK" | "DF" | "MF" | "FW";

export interface FormationSlot {
  role: Role;
  /** 归一化基准点，(0,0) 是本方球门左角，(1,1) 是对方球门右角 */
  base: Vec2;
  /** 活动矩形半宽/半高，米。限制这个位置能漂出基准点多远 */
  roam: Vec2;
  /**
   * 跟球权重 (x, y)。0 = 完全不跟（门将钉在门线），1 = 完全跟着球走。
   * 后卫小、前锋大，于是球推进时阵型自然拉开又收拢。
   */
  follow: Vec2;
}

/** 4-4-2。索引 0 永远是门将。 */
/**
 * 基准点是"球在中圈时全队应该站哪"，不是"最深的防守站位"。
 *
 * 第一版把后卫基准放在 0.16（球场 17 米处），结果球在中圈时后卫线离中场 25 米，
 * 整支球队被扯成两段，中场往前一看谁都够不着。
 * 真实 4-4-2 在球处于中圈时，后卫线大约在 1/3 处、中场在中线附近、锋线略靠前。
 */
export const FORMATION_442: FormationSlot[] = [
  { role: "GK", base: { x: 0.05, y: 0.5 }, roam: { x: 4, y: 7 }, follow: { x: 0.05, y: 0.10 } },

  { role: "DF", base: { x: 0.30, y: 0.18 }, roam: { x: 13, y: 10 }, follow: { x: 0.34, y: 0.26 } },
  { role: "DF", base: { x: 0.27, y: 0.39 }, roam: { x: 12, y: 9 }, follow: { x: 0.32, y: 0.22 } },
  { role: "DF", base: { x: 0.27, y: 0.61 }, roam: { x: 12, y: 9 }, follow: { x: 0.32, y: 0.22 } },
  { role: "DF", base: { x: 0.30, y: 0.82 }, roam: { x: 13, y: 10 }, follow: { x: 0.34, y: 0.26 } },

  { role: "MF", base: { x: 0.50, y: 0.15 }, roam: { x: 15, y: 12 }, follow: { x: 0.50, y: 0.40 } },
  { role: "MF", base: { x: 0.46, y: 0.40 }, roam: { x: 14, y: 11 }, follow: { x: 0.48, y: 0.34 } },
  { role: "MF", base: { x: 0.46, y: 0.60 }, roam: { x: 14, y: 11 }, follow: { x: 0.48, y: 0.34 } },
  { role: "MF", base: { x: 0.50, y: 0.85 }, roam: { x: 15, y: 12 }, follow: { x: 0.50, y: 0.40 } },

  { role: "FW", base: { x: 0.66, y: 0.38 }, roam: { x: 16, y: 12 }, follow: { x: 0.60, y: 0.42 } },
  { role: "FW", base: { x: 0.66, y: 0.62 }, roam: { x: 16, y: 12 }, follow: { x: 0.60, y: 0.42 } },
];

/** 进攻方向：+1 = 朝 x 增大的球门打，-1 = 反过来。0 号队伍永远是 +1 */
export type AttackDir = 1 | -1;

export interface FormationTuning {
  /**
   * 进攻时横向展开 / 防守时纵向压缩的强度。
   * 0 = 阵型宽度恒定；调大 → 压到对方半场时球队拉得很开，回防时缩成一团。
   */
  spreadGain: number;
  /** 整体跟球强度的总倍率。调到 0 → 全队站桩不动，是观察基准阵型的好办法 */
  followScale: number;
  /** m — 本方没有球权时，整条阵线朝自家球门回收多少 */
  defensiveDrop: number;
}

/**
 * 算出某个位置此刻的阵型锚点（世界坐标，米）。
 *
 * 纯函数，不读 world —— 好处是渲染层想画出锚点做调试时可以直接调它。
 */
export function slotAnchor(
  slot: FormationSlot,
  ball: Vec2,
  ft: FormationTuning,
  out: Vec2 = { x: 0, y: 0 },
  dir: AttackDir = 1,
  hasPossession = true,
): Vec2 {
  // 1 号队伍朝反方向打，基准点整体镜像
  const normX = dir === 1 ? slot.base.x : 1 - slot.base.x;
  const baseX = normX * PITCH_LENGTH - (hasPossession ? 0 : ft.defensiveDrop * dir);
  const baseY = slot.base.y * PITCH_WIDTH;

  // -1 = 球在本方底线，+1 = 球在对方底线（对两队都成立）
  const attacking = clamp(((ball.x - CENTER_X) / (PITCH_LENGTH / 2)) * dir, -1, 1);
  // 进攻展开、防守收缩：把 y 相对中线的距离整体缩放
  const spread = 1 + attacking * ft.spreadGain;

  const fx = slot.follow.x * ft.followScale;
  const fy = slot.follow.y * ft.followScale;

  const wantX = baseX + (ball.x - CENTER_X) * fx;
  const wantY = CENTER_Y + (baseY - CENTER_Y) * spread + (ball.y - CENTER_Y) * fy;

  // 活动矩形：每个位置只能在自己的基准点附近活动，不许满场乱跑
  out.x = clamp(wantX, baseX - slot.roam.x, baseX + slot.roam.x);
  out.y = clamp(wantY, baseY - slot.roam.y, baseY + slot.roam.y);
  // 别跑出场外
  out.x = clamp(out.x, 1, PITCH_LENGTH - 1);
  out.y = clamp(out.y, 1, PITCH_WIDTH - 1);
  return out;
}
