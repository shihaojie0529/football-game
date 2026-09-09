/**
 * 不可调的世界常量（DESIGN.md §3）。
 * 这些是设计约定，不是手感参数 —— 不要放进 tuning.ts，不要接 gui。
 *
 * sim 层的长度单位一律是【米】。转像素只发生在 render 层。
 */

/** 国际标准球场 */
export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;

/** 球场外围的草地宽度（M1 用作反弹围栏，避免球飞丢） */
export const MARGIN = 6;

export const GOAL_WIDTH = 7.32;
export const GOAL_HEIGHT = 2.44;
/** 球门深度，仅用于绘制 */
export const GOAL_DEPTH = 2.0;

export const CENTER_X = PITCH_LENGTH / 2;
export const CENTER_Y = PITCH_WIDTH / 2;
export const CENTER_CIRCLE_R = 9.15;
export const PENALTY_BOX_DEPTH = 16.5;
export const PENALTY_BOX_WIDTH = 40.32;
export const GOAL_BOX_DEPTH = 5.5;
export const GOAL_BOX_WIDTH = 18.32;
export const PENALTY_SPOT_DIST = 11;

/** 球员碰撞半径（俯视占地），不是身高 */
export const PLAYER_RADIUS = 0.45;
export const BALL_RADIUS = 0.11;
/** 球员身高：球飞得比这个高就直接越过头顶，不碰撞 */
export const PLAYER_HEIGHT = 1.8;

/** 一场比赛的长度，秒（DESIGN.md §1：一场 3 分钟的完整比赛） */
export const MATCH_LENGTH = 180;

/** DESIGN.md D26：sim 固定 60Hz */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
