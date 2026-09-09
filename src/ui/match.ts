import { DEFAULT_LABELS, movementLabel, type Bindings } from "../input/bindings.ts";
import type { World } from "../sim/types.ts";

export type ScreenMode = "menu" | "playing" | "paused" | "results";

export function matchMessage(world: World, keys: Bindings = DEFAULT_LABELS): [string, string] {
  const r = world.restart;
  if (r) {
    const side = r.team === 0 ? "我方" : "对方";
    const kind = { kickoff: "开球", throwIn: "界外球", corner: "角球", goalKick: "球门球", freeKick: "任意球" }[r.kind];
    if (r.stage === "fetch") return [side + kind, "主罚球员正在取球 · 比赛计时暂停"];
    if (r.stage === "carry") return [side + kind, "正在摆球 · 双方准备重开"];
    if (r.team === 0) return [side + kind + " · 等你出球", `移动键瞄准，按住 ${keys.passShort} 或 ${keys.shoot}，松开出球 · 对方不能抢`];
    return [side + kind, "等待主罚球员出球"];
  }
  if (world.phase === "fullTime") return ["全场结束", "本场比赛数据已记录"];
  const keeper = world.ball.owner === null ? undefined : world.players[world.ball.owner];
  if (world.charge.kind && keeper?.slot === 0 && keeper.team === 0) {
    return ["门将发球蓄力中", `${keys.passShort} 短传 · ${keys.passLong} / ${keys.shoot} 大脚 · 松开出球`];
  }
  if (world.charge.kind) {
    const action = { shot: "射门", short: "短传", through: "直塞", long: "长传" }[world.charge.kind];
    return [action + "蓄力中", world.charge.kind === "shot" ? "蓄力增加球速 · 松开射门" : "轻点选近处队友，蓄力选远处 · 松开传球"];
  }
  if (keeper?.slot === 0) return [keeper.team === 0 ? "我方门将抱住球" : "对方门将抱住球", keeper.dive > 0 || keeper.stun > 0 ? "扑救落地 · 起身后组织进攻" : keeper.team === 0 ? `${movementLabel(keys)} 禁区内移动 · ${keys.passShort} 短传 · ${keys.passLong} / ${keys.shoot} 大脚 · 松开出球` : "准备开球，队友正在接应"];
  const p = world.players[world.controlled];
  if (p && p.stun > 0) return ["正在恢复平衡", "站稳后恢复行动"];
  const team = world.ball.owner === null ? null : world.players[world.ball.owner]?.team;
  if (team === 0) return ["我方控球 · 向右进攻 →", "找空档传切，靠近禁区后再射门"];
  if (team === 1) return ["对方控球 · 回防", `${keys.switchPlayer} 切到白色空心标记 · ${keys.tackle} 抢断 · ${keys.slide} 滑铲`];
  return ["争夺球权", world.receiver !== null && world.players[world.receiver]?.team === 0 ? "传球已出 · 黄框球员正在接应" : `靠近足球接球 · ${keys.sprint} 加速`];
}

export function possessionPercent(world: World): [number, number] {
  const total = world.matchStats[0].possession + world.matchStats[1].possession;
  const home = total > 0 ? Math.round(world.matchStats[0].possession / total * 100) : 50;
  return [home, 100 - home];
}
