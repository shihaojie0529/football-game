import GUI from "lil-gui";
import { restoreTuningDefaults, tuningForTeam, type Tuning } from "../tuning.ts";

/**
 * 运行时调参面板（DESIGN.md D27）。
 *
 * 这个面板存在的意义是 M1 验收标准 4：
 * 把任一参数拖到极端值，你必须能立刻说出它改变了什么。说不出来的就删掉。
 * 所以每个控件的范围都刻意开得比"合理值"宽，好让极端值真的能拖到。
 */
export function createTuningGui(tuning: Tuning, onReset: () => void, onDefaults: (team?: 0 | 1) => void = () => {}): GUI {
  const container = document.getElementById("panel") ?? undefined;
  const gui = new GUI({
    title: "球员与比赛参数",
    width: 300,
    ...(container ? { container } : {}),
  });

  const status = document.createElement("p");
  status.className = "tuning-status";
  status.setAttribute("role", "status");
  status.textContent = "两队独立调整，即时生效；比赛时长重开生效。";
  gui.domElement.insertBefore(status, gui.$children);
  const restore = (team?: 0 | 1): void => {
    restoreTuningDefaults(tuning, team);
    for (const control of gui.controllersRecursive()) control.updateDisplay();
    onDefaults(team);
    status.textContent = team === undefined
      ? "已恢复全部默认参数，当前比分保留；比赛时长重开生效。"
      : `已恢复${team === 0 ? "我方" : "对方"}默认参数，当前比分保留。`;
  };
  gui.add({ restore: () => restore() }, "restore").name("一键恢复全部默认");
  gui.add({ reset: onReset }, "reset").name("按当前参数重开一场");
  for (const [team, label] of [[0, "我方 · 红队"], [1, "对方 · 蓝队"]] as const) {
    const folder = gui.addFolder(label);
    folder.add({ restore: () => restore(team) }, "restore").name(`恢复${team === 0 ? "我方" : "对方"}默认`);
    addTeamControls(folder, tuningForTeam(tuning, team), team);
  }
  const common = gui.addFolder("公共 · 球物理 / 规则 / 相机");
  addCommonControls(common, tuning);
  common.close();
  return gui;
}

function addTeamControls(gui: GUI, tuning: Tuning, team: 0 | 1): void {
  const attack = gui.addFolder("进攻 AI");
  attack.add(tuning.attack, "decisionDelay", 0.2, 2, 0.05).name("传射前观察 s");
  attack.add(tuning.attack, "passDelay", 0.3, 3, 0.1).name("传球决策间隔 s");
  attack.add(tuning.attack, "shotRange", 10, 30, 1).name("起脚射程 m");
  attack.close();

  const move = gui.addFolder("移动");
  move.add(tuning.move, "maxSpeed", 1, 14, 0.1).name("最高速 m/s");
  move.add(tuning.move, "acceleration", 2, 60, 0.5).name("加速度");
  move.add(tuning.move, "deceleration", 2, 80, 0.5).name("减速度");
  move.add(tuning.move, "turnRate", 1, 30, 0.1).name("转向速率 rad/s");
  move.add(tuning.move, "sprintMultiplier", 1, 2.5, 0.01).name("冲刺倍数");
  move.add(tuning.move, "sprintAcceleration", 2, 60, 0.5).name("冲刺加速度");

  const dribble = gui.addFolder("粘球");
  dribble.add(tuning.dribble, "dribbleOffset", 0.2, 3, 0.05).name("球在脚前 m");
  dribble.add(tuning.dribble, "stickyRadius", 0.2, 4, 0.05).name("吸附半径 m");
  dribble.add(tuning.dribble, "maxDetachDistance", 0.5, 8, 0.05).name("补脚范围 m");
  dribble.add(tuning.dribble, "reattachRate", 1, 40, 0.5).name("修正增益 1/s");
  dribble.add(tuning.dribble, "maxCorrection", 0.5, 15, 0.1).name("修正速度上限 m/s");
  dribble.add(tuning.dribble, "touchAccel", 5, 120, 1).name("触球加速度 m/s²");
  dribble.add(tuning.dribble, "shotCooldown", 0, 1.5, 0.01).name("射门后锁定 s");
  dribble.add(tuning.dribble, "detachCooldown", 0, 1.5, 0.01).name("脱离后锁定 s");

  const shot = gui.addFolder("射门");
  shot.add(tuning.shot, "chargeTime", 0.1, 3, 0.05).name("蓄满时间 s");
  shot.add(tuning.shot, "minPower", 2, 40, 0.5).name("最小力度 m/s");
  shot.add(tuning.shot, "maxPower", 5, 60, 0.5).name("最大力度 m/s");
  shot.add(tuning.shot, "loftAngle", 0, 45, 0.5).name("仰角 度");
  shot.add(tuning.shot, "inheritVelocity", 0, 1, 0.01).name("继承球员速度");

  const pass = gui.addFolder("传球 (D13/D20/D21)");
  pass.add(tuning.pass, "fanAngle", 10, 120, 1).name("扇形半角 度");
  pass.add(tuning.pass, "laneRadius", 0.5, 8, 0.1).name("线路阻挡半径 m");
  if (team === 0) pass.add(tuning.pass, "controlHoldTime", 0, 2, 0.05).name("出脚后保持控制 s");
  pass.add(tuning.pass, "leadFactor", 0, 1.5, 0.05).name("提前量（预判接球点）");
  pass.add(tuning.pass, "chargeTime", 0.15, 2, 0.05).name("蓄满时间 s");
  pass.add(tuning.pass, "intentSharpness", 0.5, 8, 0.1).name("方向话语权（越大越只认方向）");
  pass.add(tuning.pass, "receiverPriority", 0, 1, 0.05).name("接球人优先权（防半路截胡）");
  for (const [key, label] of [
    ["short", "短传"],
    ["through", "直塞"],
    ["long", "长传"],
  ] as const) {
    const f = pass.addFolder(label);
    const k = tuning.pass[key];
    f.add(k, "maxRange", 5, 60, 0.5).name("最大射程 m");
    f.add(k, "minRange", 2, 40, 0.5).name("轻点时传多远 m");
    f.add(k, "loft", 0, 60, 0.5).name("仰角 度");
    f.add(k, "lead", 0, 20, 0.5).name("往前送多远 m");
    f.add(k, "arriveSpeed", 0, 20, 0.5).name("到脚下时球速 m/s");
    f.add(k, "wIntent", 0, 2, 0.05).name("权重·意图方向");
    f.add(k, "wLane", 0, 2, 0.05).name("权重·线路通畅");
    f.add(k, "wAdvance", 0, 2, 0.05).name("权重·往前推进");
    f.add(k, "wRange", 0, 2, 0.05).name("权重·射程匹配");
    f.close();
  }

  const tk = gui.addFolder("铲抢 (D12)");
  tk.add(tuning.tackle, "windowTime", 0.05, 1, 0.01).name("判定窗口 s");
  tk.add(tuning.tackle, "range", 0.5, 5, 0.1).name("断球半径 m");
  tk.add(tuning.tackle, "recovery", 0, 2, 0.05).name("落空硬直 s（防守博弈的来源）");
  tk.add(tuning.tackle, "lungeSpeed", 0, 12, 0.1).name("出脚前扑 m/s");
  tk.add(tuning.tackle, "knock", 0, 15, 0.5).name("断球捅出速度 m/s");
  tk.add(tuning.tackle, "knockFacing", 0, 1, 0.05).name("断球方向 0=解围 1=朝向");
  tk.add(tuning.tackle, "aiTriggerRange", 0.5, 5, 0.1).name("AI 出脚距离 m（越大越容易铲空）");

  const sl = gui.addFolder("铲球 / 滑铲");
  sl.add(tuning.slide, "windowTime", 0.1, 1.2, 0.02).name("判定窗口 s");
  sl.add(tuning.slide, "range", 1, 6, 0.1).name("断球半径 m");
  sl.add(tuning.slide, "recovery", 0.2, 3, 0.05).name("落空硬直 s（必须远长于抢断）");
  sl.add(tuning.slide, "speed", 3, 25, 0.5).name("滑出去的速度 m/s");
  sl.add(tuning.slide, "foulContact", 0, 2, 0.05).name("铲到人判定 m");
  sl.add(tuning.slide, "aiTriggerRange", 1, 8, 0.1).name("AI 用铲球的距离 m");

  const ai = gui.addFolder("球员 AI (D18/D19)");
  ai.add(tuning.ai, "followScale", 0, 2, 0.05).name("整体跟球强度");
  ai.add(tuning.ai, "spreadGain", 0, 1, 0.01).name("进攻展开/防守收缩");
  ai.add(tuning.ai, "activeRunners", 0, 10, 1).name("做局部跑位的人数");
  ai.add(tuning.ai, "runnerRadius", 1, 20, 0.5).name("跑位采样半径 m");
  ai.add(tuning.ai, "runnerSamples", 4, 32, 1).name("跑位采样点数");
  ai.add(tuning.ai, "wAdvance", 0, 3, 0.05).name("权重·往前推进");
  ai.add(tuning.ai, "wSpace", 0, 3, 0.05).name("权重·离人远");
  ai.add(tuning.ai, "wPassable", 0, 3, 0.05).name("权重·保持可传距离");
  ai.add(tuning.ai, "preferredPassDistance", 4, 40, 0.5).name("最舒服的接球距离 m");
  ai.add(tuning.ai, "arriveRadius", 0.5, 12, 0.1).name("到点减速半径 m");
  ai.add(tuning.ai, "defensiveDrop", 0, 30, 0.5).name("丢球权时回收 m");
  ai.add(tuning.ai, "markPull", 0, 1, 0.05).name("盯人强度");
  ai.add(tuning.ai, "markGoalSide", 0, 8, 0.1).name("站在对手身前 m");
  ai.add(tuning.ai, "coverDepth", 1, 20, 0.5).name("补位深度 m");
  if (team === 0) ai.add(tuning.ai, "autoSwitchCooldown", 0, 3, 0.05).name("自动切人冷却 s");
  if (team === 0) ai.add(tuning.ai, "manualSwitchLock", 0, 6, 0.1).name("手动切人后锁定 s");
  if (team === 0) ai.add(tuning.ai, "autoSwitchMargin", 0, 2, 0.05).name("自动切人迟滞 s（0=疯狂跳人）");
  ai.add(tuning.ai, "pressRadius", 0, 60, 1).name("逼抢半径 m（防守强度总闸）");
  ai.add(tuning.ai, "pressGoalSide", 0.3, 4, 0.05).name("逼抢贴身距离 m");
  ai.add(tuning.ai, "pressCommitDelay", 0, 3, 0.05).name("贴住多久才出脚 s");
  ai.add(tuning.ai, "looseTouch", 0.4, 3, 0.05).name("触球散开就出脚 m");
  ai.add(tuning.ai, "slideEscapeSpeed", 1, 10, 0.1).name("被拉开多快才铲球 m/s");
  const keeper = gui.addFolder("门将");
  keeper.add(tuning.ai, "gkLineDepth", 0, 8, 0.1).name("门将出击距离 m");
  keeper.add(tuning.ai, "gkSpeed", 1, 10, 0.1).name("门将移动速度 m/s");
  keeper.add(tuning.ai, "gkReaction", 0, 1.5, 0.02).name("门将反应时间 s");
  keeper.add(tuning.ai, "gkReach", 0.3, 4, 0.05).name("门将站着的手长 m");
  keeper.add(tuning.ai, "gkDiveReach", 0.5, 6, 0.1).name("鱼跃时的手长 m");
  keeper.add(tuning.ai, "gkCatchHeight", 0.5, 5, 0.1).name("能接多高的球 m");
  keeper.add(tuning.ai, "gkDiveSpeed", 2, 20, 0.5).name("鱼跃速度 m/s");
  keeper.add(tuning.ai, "gkDiveWindow", 0.1, 1.5, 0.05).name("鱼跃窗口 s");
  keeper.add(tuning.ai, "gkDiveRecovery", 0, 3, 0.05).name("鱼跃后趴地 s");
  keeper.add(tuning.ai, "gkDiveTrigger", 0, 6, 0.1).name("多远才鱼跃 m");
  keeper.add(tuning.ai, "gkClearDelay", 0, 3, 0.05).name("门将握球时间 s");
  keeper.add(tuning.ai, "gkClearLoft", 0, 60, 1).name("门将开球仰角 度");
  keeper.add(tuning.ai, "gkClearPower", 8, 45, 0.5).name("门将开球力度 m/s");

  for (const folder of gui.folders) folder.close();
}

function addCommonControls(gui: GUI, tuning: Tuning): void {
  const ball = gui.addFolder("球物理");
  ball.add(tuning.ball, "groundFriction", 0, 4, 0.01).name("地面摩擦 1/s");
  ball.add(tuning.ball, "airDrag", 0, 2, 0.01).name("空气阻力 1/s");
  ball.add(tuning.ball, "gravityZ", 1, 30, 0.1).name("重力 m/s²");
  ball.add(tuning.ball, "bounceRestitution", 0, 1, 0.01).name("反弹系数");
  ball.add(tuning.ball, "bounceFriction", 0, 1, 0.01).name("落地水平保留");
  ball.add(tuning.ball, "curveFactor", 0, 5, 0.05).name("弧线强度");
  ball.add(tuning.ball, "spinDecayAir", 0, 5, 0.05).name("旋转空中衰减 1/s");
  ball.add(tuning.ball, "spinDecayBounce", 0, 1, 0.01).name("落地旋转保留");

  const rules = gui.addFolder("规则与流程 (D3/D5)");
  rules.add(tuning.rules, "matchLength", 30, 600, 10).name("一场时长 s（重开生效）");
  rules.add(tuning.rules, "restartDelay", 0.2, 4, 0.1).name("死球等待 s");
  rules.add(tuning.rules, "deadBallDamping", 0, 12, 0.5).name("死球时球的减速 1/s");
  rules.add(tuning.rules, "restartClearance", 2, 15, 0.5).name("对方退开距离 m");
  rules.add(tuning.rules, "foulContact", 0, 1.5, 0.05).name("撞人判定距离 m");
  rules.add(tuning.rules, "foulSpeed", 0, 15, 0.5).name("撞人判定速度 m/s（越小越爱吹）");
  rules.add(tuning.rules, "eventBannerTime", 0.5, 5, 0.1).name("判罚提示时长 s");

  const cam = gui.addFolder("相机");
  cam.add(tuning.camera, "lerp", 0.5, 30, 0.1).name("跟随速率 1/s");
  cam.add(tuning.camera, "lookahead", 0, 1.5, 0.01).name("前瞻 s");
  cam.add(tuning.camera, "maxLookahead", 0, 30, 0.5).name("前瞻上限 m");

  for (const folder of gui.folders) folder.close();
}
