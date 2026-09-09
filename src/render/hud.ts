import type { World } from "../sim/types.ts";
import { PALETTE } from "./palette.ts";
import { VIEW_HEIGHT, VIEW_WIDTH } from "./viewport.ts";

export interface HudStats {
  fps: number;
  showDebug: boolean;
  shortKey?: string;
  switchKey?: string;
}

const MONO = "ui-monospace, Menlo, Consolas, monospace";

/**
 * HUD。
 *
 * 排版上只有一条硬规则：四个角各归各的 ——
 * 左上调试框、左下键位提示、右下雷达、顶部中间记分牌。
 * 中间留给判罚提示和终场，因为那是唯一需要打断你的东西。
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  world: World,
  stats: HudStats,
): void {
  ctx.font = `8px ${MONO}`;
  ctx.textBaseline = "top";
  const me = world.players[world.controlled];
  const b = world.ball;
  const hasBall = b.owner === world.controlled;

  if (stats.showDebug) drawScoreboard(ctx, world);

  if (stats.showDebug) {
    const speed = me ? Math.hypot(me.vel.x, me.vel.y) : 0;
    const ballSpeed = Math.hypot(b.vel.x, b.vel.y);
    const lines = [
      `${stats.fps.toFixed(0)}fps  ${world.phase}`,
      `shots ${world.shots}  pass ${world.passes}  tackle ${world.tacklesWon}/${world.tackles}`,
      `player ${speed.toFixed(2)} m/s`,
      `ball   ${ballSpeed.toFixed(2)} m/s   z ${b.z.toFixed(2)} m`,
      b.owner !== null
        ? `ball: ${world.players[b.owner]!.team === 0 ? "我方" : "对方"} #${b.owner}${hasBall ? " (you)" : ""}`
        : world.receiver !== null
          ? `in flight → #${world.receiver}`
          : "ball: free",
      me && me.stun > 0 ? `STUNNED ${me.stun.toFixed(2)}s` : "",
      world.offsideFlags.length > 0 ? `offside watch: ${world.offsideFlags.join(",")}` : "",
    ].filter((l) => l !== "");

    ctx.fillStyle = PALETTE.hudBg;
    ctx.fillRect(3, 18, 172, lines.length * 10 + 5);
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? PALETTE.hudText : PALETTE.hudDim;
      ctx.fillText(lines[i]!, 7, 22 + i * 10);
    }
  }

  drawCenterMessages(ctx, world, stats.shortKey ?? "J");
}

/** 顶部中间：比分 + 剩余时间。这是唯一一直都在的 UI */
function drawScoreboard(ctx: CanvasRenderingContext2D, world: World): void {
  const mins = Math.floor(world.clock / 60);
  const secs = Math.floor(world.clock % 60);
  const text = `我方 ${world.goals[0]} - ${world.goals[1]} 电脑   ${mins}:${secs.toString().padStart(2, "0")}`;
  ctx.font = `8px ${MONO}`;
  const w = Math.ceil(ctx.measureText(text).width) + 14;
  const x = Math.round((VIEW_WIDTH - w) / 2);

  ctx.fillStyle = PALETTE.hudBg;
  ctx.fillRect(x, 3, w, 13);
  ctx.fillStyle = world.clock <= 15 ? PALETTE.chargeHigh : PALETTE.hudText;
  ctx.textAlign = "center";
  ctx.fillText(text, VIEW_WIDTH / 2, 6);
  ctx.textAlign = "left";
}

/** 屏幕中间：进球、判罚提示、终场。只有需要打断你的东西才放这里 */
function drawCenterMessages(ctx: CanvasRenderingContext2D, world: World, shortKey: string): void {
  ctx.textAlign = "center";

  if (world.phase === "fullTime") {
    ctx.textAlign = "left";
    return;
  }

  if (world.goalFlash > 0) {
    const a = Math.min(1, world.goalFlash / 0.4);
    ctx.font = `16px ${MONO}`;
    ctx.fillStyle =
      world.lastScorer === 0
        ? `rgba(126, 224, 138, ${a.toFixed(2)})`
        : `rgba(224, 100, 100, ${a.toFixed(2)})`;
    ctx.fillText(world.lastScorer === 0 ? "GOAL" : "CONCEDED", VIEW_WIDTH / 2, VIEW_HEIGHT / 2 - 34);
  } else if ((world.eventTimer > 0 || world.phase === "restart") && world.eventLabel !== "") {
    // 判罚提示：出界/角球/越位/犯规。不说一声，玩家不知道比赛为什么停了
    // 死球全程都显示：捡球+摆球要两秒多，不说一声玩家不知道自己为什么按键没反应
    const a = world.phase === "restart" ? 1 : Math.min(1, world.eventTimer / 0.4);
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = `rgba(223, 230, 238, ${a.toFixed(2)})`;
    const r = world.restart;
    const kind = r ? { kickoff: "开球", throwIn: "界外球", corner: "角球", goalKick: "球门球", freeKick: "任意球" }[r.kind] : world.eventLabel;
    const label = r ? (r.team === 0 ? "我方 · " : "对方 · ") + kind : kind;
    ctx.fillStyle = PALETTE.hudBg;
    ctx.fillRect(VIEW_WIDTH / 2 - 60, 12, 120, 31);
    ctx.fillStyle = PALETTE.hudText;
    ctx.fillText(label, VIEW_WIDTH / 2, 17);
    ctx.font = `7px ${MONO}`;
    ctx.fillStyle = PALETTE.accent;
    const stage = !r ? "" : r.stage === "fetch" ? "正在取球" : r.stage === "carry" ? "正在摆球"
      : r.team === 0 ? `等待你出球 · ${shortKey} 短传` : "等待对方出球";
    ctx.fillText(stage, VIEW_WIDTH / 2, 31);
  }

  ctx.textAlign = "left";
}
