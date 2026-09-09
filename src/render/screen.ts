import { VIEW_HEIGHT, VIEW_WIDTH } from "./viewport.ts";

/**
 * 内部分辨率固定 480×270，只允许【整数倍】放大（DESIGN.md §3）。
 * 非整数缩放会让像素糊掉，那是像素风最典型的翻车方式。
 */
export class Screen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  scale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = VIEW_WIDTH;
    canvas.height = VIEW_HEIGHT;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.fit();
    window.addEventListener("resize", () => this.fit());
    if (canvas.parentElement) new ResizeObserver(() => this.fit()).observe(canvas.parentElement);
  }

  fit(): void {
    // 按【容器】而不是窗口来算，否则调参面板会把画面挤出去
    const box = this.canvas.parentElement ?? document.body;
    const sx = box.clientWidth / VIEW_WIDTH;
    const sy = box.clientHeight / VIEW_HEIGHT;
    const available = Math.min(sx, sy);
    // 桌面保持整数倍；比内部画布更窄的窗口按比例缩小，避免裁掉半个球场。
    this.scale = available < 1 ? Math.max(0.1, available) : Math.floor(available);
    this.canvas.style.width = `${VIEW_WIDTH * this.scale}px`;
    this.canvas.style.height = `${VIEW_HEIGHT * this.scale}px`;
  }
}
