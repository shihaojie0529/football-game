/** 渲染层的尺寸约定（DESIGN.md §3）。sim 层不知道像素的存在。 */
export const VIEW_WIDTH = 480;
export const VIEW_HEIGHT = 270;

/** 1 米 = 8 内部像素 */
export const PPM = 8;

/** 可视范围：60 × 33.75 米 */
export const VIEW_METERS_X = VIEW_WIDTH / PPM;
export const VIEW_METERS_Y = VIEW_HEIGHT / PPM;
