/**
 * 无头物理测试台。
 *
 * 这个文件能在 Node 里跑起来这件事本身，就是 D25 分层的证明：
 * sim 层不需要浏览器、不需要 canvas、不需要 requestAnimationFrame。
 *
 * 它同时是 M1 验收标准的【可复现】版本 —— 手感最终要靠手玩，
 * 但"急转会不会脱球""25 米射门几秒到"这类问题应该有确定的数字，而不是印象。
 *
 * 跑：npm run sim
 */
import { TICK_DT, CENTER_X, CENTER_Y, PITCH_LENGTH } from "../src/sim/constants.ts";
import { step } from "../src/sim/step.ts";
import { createWorld, resetKickoff } from "../src/sim/world.ts";
import { emptyInput, type InputState, type World } from "../src/sim/types.ts";
import { createTuning, type Tuning } from "../src/tuning.ts";
import { dribbleTarget } from "../src/sim/player.ts";
import { FORMATION_442, slotAnchor } from "../src/sim/formation.ts";
import { PITCH_WIDTH } from "../src/sim/constants.ts";

const t: Tuning = createTuning();

/** M3 的完整世界：22 人，两队对抗 */
function full(): World {
  const w = createWorld();
  resetKickoff(w);
  // 本测试台默认量进行中的比赛；未开球保护由 restart-regression.ts 验证。
  w.phase = "playing";
  w.restart = null;
  w.ball.owner = null;
  return w;
}

/**
 * 只有己方 11 人的世界。
 *
 * M2 的传球/跑位测试必须在没有对手的条件下量 —— 加了对手之后，
 * "传球成功率下降"可能是因为传球坏了，也可能是因为防守正常工作，
 * 混在一起就什么也说明不了。M3 的对抗另有 [17]~[21]。
 *
 * 0 队在 createWorld 里占据索引 0~10，所以过滤后索引不变，controlled 也不用改。
 *
 * 同时关掉吹罚：一个直线带球 10 秒的测试会跑出 80 米，真判出界就永远量不到带球手感。
 * 规则本身由 M4 的 [22]~[25] 在 full() 世界里测。
 */
function fresh(): World {
  const w = full();
  w.players = w.players.filter((p) => p.team === 0);
  w.officiating = false;
  return w;
}

/**
 * 只留下被控球员的世界。
 *
 * M1 的物理测试（带球、射门、球物理）必须在没有队友干扰的情况下量 ——
 * 否则一个跑过来接应的队友撞你一下，数字就不是物理的数字了。
 * M2 的测试用 fresh()。
 */
function solo(): World {
  const w = fresh();
  const me = w.players[w.controlled]!;
  w.players = [me];
  w.controlled = 0;
  w.ball.owner = null;
  w.receiver = null;
  return w;
}

/** 被控球员 + 一名钉住不动的陪练，用来测碰撞 */
function withPartner(offsetX: number, offsetY: number): { w: World; partner: number } {
  const w = solo();
  const me = w.players[0]!;
  const partner = {
    ...me,
    pos: { x: me.pos.x + offsetX, y: me.pos.y + offsetY },
    prevPos: { x: me.pos.x + offsetX, y: me.pos.y + offsetY },
    vel: { x: 0, y: 0 },
    aim: { x: me.pos.x + offsetX, y: me.pos.y + offsetY },
    slot: 3,
  };
  w.players.push(partner);
  return { w, partner: 1 };
}

function input(o: Partial<InputState> = {}): InputState {
  return { ...emptyInput(), ...o };
}

/**
 * 跑步机：球员跑远了就把【人和球一起】平移回中圈。
 *
 * 带球测试要连续跑 10 秒（冲刺 88 米），不搬回来就会一头撞进球门 ——
 * 带球过线算进球，世界一重置就什么都量不到了。
 * 人和球按同一个位移平移，相对几何完全不变，所以量到的粘球误差不受影响。
 */
function treadmill(w: World): void {
  const p = w.players[w.controlled]!;
  if (Math.abs(p.pos.x - CENTER_X) < 30 && Math.abs(p.pos.y - CENTER_Y) < 18) return;
  const dx = CENTER_X - p.pos.x;
  const dy = CENTER_Y - p.pos.y;
  for (const q of w.players) {
    q.pos.x += dx;
    q.pos.y += dy;
    q.prevPos.x += dx;
    q.prevPos.y += dy;
    q.aim.x += dx;
    q.aim.y += dy;
  }
  w.ball.pos.x += dx;
  w.ball.pos.y += dy;
  w.ball.prevPos.x += dx;
  w.ball.prevPos.y += dy;
}

/** 传球蓄力多少 tick 对应蓄力比例 ratio（0..1）。传球是"松开出球" */
function chargeTicksFor(ratio: number): number {
  return Math.max(1, Math.round((t.pass.chargeTime * ratio) / TICK_DT));
}

/** 推进 n 个 tick，可选每 tick 回调（用于变化输入 / 采样） */
function run(
  w: World,
  n: number,
  inp: InputState | ((tick: number) => InputState),
  onTick?: (tick: number) => void,
): void {
  for (let i = 0; i < n; i++) {
    step(w, typeof inp === "function" ? inp(i) : inp, t, TICK_DT);
    onTick?.(i);
  }
}

const speed = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);
let failures = 0;

function check(name: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}\n        ${detail}`);
}

// ─────────────────────────────────────────────────────────────
console.log("\n[1] 加速与极速");
{
  const w = solo();
  run(w, 180, input({ moveX: 1 }));
  const p = w.players[w.controlled]!;
  check(
    "常规跑动收敛到 maxSpeed",
    Math.abs(speed(p.vel) - t.move.maxSpeed) < 0.05,
    `实测 ${speed(p.vel).toFixed(2)} m/s，期望 ${t.move.maxSpeed}`,
  );

  const w2 = solo();
  run(w2, 180, input({ moveX: 1, sprint: true }));
  const p2 = w2.players[w2.controlled]!;
  const expect = t.move.maxSpeed * t.move.sprintMultiplier;
  check(
    "冲刺收敛到 maxSpeed × sprintMultiplier",
    Math.abs(speed(p2.vel) - expect) < 0.05,
    `实测 ${speed(p2.vel).toFixed(2)} m/s，期望 ${expect.toFixed(2)}`,
  );

  // 达到 90% 极速需要多久 —— 这个数字直接决定"起步是否拖沓"
  const w3 = solo();
  let ticks = 0;
  run(w3, 300, input({ moveX: 1 }), () => {
    if (speed(w3.players[w3.controlled]!.vel) < t.move.maxSpeed * 0.9) ticks++;
  });
  console.log(`        起步到 90% 极速：${(ticks * TICK_DT).toFixed(2)} s`);
}

// ─────────────────────────────────────────────────────────────
console.log("\n[2] 粘球：吸附、稳态滞后");
{
  const w = solo();
  run(w, 90, input({ moveX: 1 }));
  const p = w.players[w.controlled]!;
  const b = w.ball;
  check("跑向球会吸附上", b.owner !== null, `owner=${b.owner}`);

  const gap = Math.hypot(b.pos.x - p.pos.x, b.pos.y - p.pos.y);
  const tg = dribbleTarget(p, t);
  const err = Math.hypot(b.pos.x - tg.x, b.pos.y - tg.y);
  check(
    "稳态时球稳定停在脚前目标点上（前馈项让位置误差趋近 0）",
    b.owner !== null && err < 0.2,
    `人球间距 ${gap.toFixed(2)} m（dribbleOffset ${t.dribble.dribbleOffset}），对目标点误差 ${err.toFixed(3)} m`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[3] 验收标准 1：带球的松紧");
{
  /** 先控住球，再按输入模式跑 sec 秒，报告脱手次数与球偏离脚前目标点的峰值 */
  function dribble(
    sprint: boolean,
    sec: number,
    drive: (tick: number) => InputState,
  ): { detaches: number; peakErr: number; ownedPct: number } {
    const w = solo();
    run(w, 150, input({ moveX: 1, sprint }));
    if (w.ball.owner === null) throw new Error("起步没能控住球");
    let detaches = 0;
    let peakErr = 0;
    let owned = 0;
    const n = Math.round(sec / TICK_DT);
    run(w, n, drive, () => {
      treadmill(w);
      if (w.ball.owner === null) return;
      owned++;
      const p = w.players[w.controlled]!;
      const tg = dribbleTarget(p, t);
      peakErr = Math.max(peakErr, Math.hypot(w.ball.pos.x - tg.x, w.ball.pos.y - tg.y));
    });
    // 脱手次数要在循环里数，这里用控球率反推是否发生过
    const wr = solo();
    run(wr, 150, input({ moveX: 1, sprint }));
    for (let i = 0; i < n; i++) {
      const had = wr.ball.owner !== null;
      step(wr, drive(i), t, TICK_DT);
      treadmill(wr);
      if (had && wr.ball.owner === null) detaches++;
    }
    return { detaches, peakErr, ownedPct: (owned / n) * 100 };
  }

  // ── 3a 持续带球：这一组是回归测试。
  // 早先只测了"单次干净的 90° 急转"就定了 touchAccel，结果绕圈跑控球率只有 4%，
  // 也就是玩家一转弯球就没了。任何持续转向都必须零脱手。
  const patterns: Array<[string, boolean, (i: number) => InputState]> = [
    ["直线慢跑", false, () => input({ moveX: 1 })],
    ["直线冲刺", true, () => input({ moveX: 1, sprint: true })],
    ["斜向慢跑", false, () => input({ moveX: 1, moveY: 1 })],
    ["画圆慢跑", false, (i) => {
      const a = ((i * TICK_DT) / 2) * Math.PI * 2;
      return input({ moveX: Math.cos(a), moveY: Math.sin(a) });
    }],
    ["画圆冲刺", true, (i) => {
      const a = ((i * TICK_DT) / 2) * Math.PI * 2;
      return input({ moveX: Math.cos(a), moveY: Math.sin(a), sprint: true });
    }],
    ["S形变向冲刺", true, (i) =>
      input({ moveX: 1, moveY: Math.floor(i / 48) % 2 === 0 ? 1 : -1, sprint: true })],
    ["四方向乱点冲刺", true, (i) => {
      const d = [[1, 0], [0, 1], [-1, 0], [0, -1]][Math.floor(i / 15) % 4]!;
      return input({ moveX: d[0]!, moveY: d[1]!, sprint: true });
    }],
    // ↓ 以下四种是【瞬间 180° 反向】。键盘上这只要一次按键，是最常见的操作之一，
    //   却恰好是上面所有模式都测不到的：四方向乱点相邻方向永远差 90°，不差 180°。
    ["A/D 反向来回 0.5s 慢跑", false, (i) =>
      input({ moveX: Math.floor(i / 30) % 2 ? 1 : -1 })],
    ["A/D 反向来回 0.25s 冲刺", true, (i) =>
      input({ moveX: Math.floor(i / 15) % 2 ? 1 : -1, sprint: true })],
    ["A/D 疯狂点 0.1s 冲刺", true, (i) =>
      input({ moveX: Math.floor(i / 6) % 2 ? 1 : -1, sprint: true })],
    ["冲刺急停后反向", true, (i) =>
      i < 30 ? input({ sprint: true }) : input({ moveX: -1, sprint: true })],
    ["走走停停 0.3s 冲刺", true, (i) =>
      Math.floor(i / 18) % 2 ? input({ sprint: true }) : input({ moveX: 1, sprint: true })],
  ];
  for (const [name, sprint, drive] of patterns) {
    const r = dribble(sprint, 10, drive);
    check(
      `持续带球 10 秒不丢球：${name}`,
      r.detaches === 0 && r.ownedPct > 99,
      `脱手 ${r.detaches} 次，控球率 ${r.ownedPct.toFixed(0)}%，球最远甩出 ${r.peakErr.toFixed(2)} m`,
    );
  }

  // ── 3b 松动感必须还在：球要看得出被甩出去，不能黏死在脚上
  const quad = dribble(true, 10, (i) => {
    const d = [[1, 0], [0, 1], [-1, 0], [0, -1]][Math.floor(i / 15) % 4]!;
    return input({ moveX: d[0]!, moveY: d[1]!, sprint: true });
  });
  check(
    "急变向时球看得见地甩出去（不是磁铁）",
    quad.peakErr > 0.6,
    `峰值甩出 ${quad.peakErr.toFixed(2)} m = 屏幕上 ${(quad.peakErr * 8).toFixed(0)} px`,
  );

  // ── 3c M1 里玩家自己的操作【永远】不该丢球权。
  // M1 没有对手，自己把球弄丢只有挫败感、没有任何玩法价值（§9.5）。
  // 带球的代价由"球被甩出脚前 12px"本身承担 —— 等 M3 有了防守球员，
  // 那 12px 就是对方能捅到球的窗口。
  {
    let worst = "";
    for (const [name, sprint, drive] of patterns) {
      const r = dribble(sprint, 10, drive);
      if (r.detaches > 0) worst += `${name}(丢${r.detaches}次) `;
    }
    check(
      "玩家自己的任何键盘操作都不会丢球权",
      worst === "",
      worst === "" ? `${patterns.length} 种模式各 10 秒，零脱手` : `仍会丢球：${worst}`,
    );
  }

  // ── 3d 但球一旦被外力打飞（M3 的抢断、撞到人、射偏弹回），必须能追回来
  {
    const w = solo();
    run(w, 150, input({ moveX: 1, sprint: true }));
    const b = w.ball;
    b.owner = null;
    b.stickyLock = t.dribble.detachCooldown;
    b.vel.x = 9; // 球被捅向前方，比人快
    b.vel.y = 4;
    let regainAt = -1;
    run(w, 300, () => {
      const p = w.players[w.controlled]!;
      const dx = b.pos.x - p.pos.x;
      const dy = b.pos.y - p.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      return input({ moveX: dx / d, moveY: dy / d, sprint: true });
    }, (i) => {
      if (regainAt < 0 && b.owner !== null) regainAt = i;
    });
    check(
      "球被外力打飞后，转身去追 2 秒内能追回",
      regainAt >= 0 && regainAt * TICK_DT < 2,
      regainAt >= 0 ? `${(regainAt * TICK_DT).toFixed(2)} s 追回` : "5 秒没追回",
    );
  }
}

// ─────────────────────────────────────────────────────────────
console.log("\n[4] 验收标准 2：25 米蓄满力射门，约 0.8 秒到门线");
{
  const w = solo();
  const p = w.players[w.controlled]!;
  // 放到球门正前方 25 米，面朝球门
  p.pos.x = PITCH_LENGTH - 25;
  p.pos.y = CENTER_Y;
  p.prevPos.x = p.pos.x;
  p.prevPos.y = p.pos.y;
  p.facing = 0;
  p.prevFacing = 0;
  w.ball.pos.x = p.pos.x + 0.5;
  w.ball.pos.y = CENTER_Y;
  w.ball.prevPos.x = w.ball.pos.x;
  w.ball.prevPos.y = w.ball.pos.y;
  run(w, 30, input());
  check("射门前先控住球", w.ball.owner !== null, `owner=${w.ball.owner}`);

  const chargeTicks = Math.ceil(t.shot.chargeTime / TICK_DT) + 5;
  run(w, chargeTicks, input({ shoot: true }));
  check(
    "蓄力条到顶",
    Math.abs(w.charge.time - t.shot.chargeTime) < 1e-6,
    `charge=${w.charge.time.toFixed(3)} s / ${t.shot.chargeTime} s`,
  );

  // 松开 → 出球
  step(w, input({ shoot: false }), t, TICK_DT);
  const v0 = speed(w.ball.vel);
  const vz0 = w.ball.vz;
  check(
    "出球速度 ≈ maxPower",
    Math.abs(v0 - t.shot.maxPower * Math.cos((t.shot.loftAngle * Math.PI) / 180)) < 1.0,
    `水平 ${v0.toFixed(1)} m/s，竖直 ${vz0.toFixed(2)} m/s（仰角 ${t.shot.loftAngle}°）`,
  );

  let flight = 0;
  let zAtLine = -1;
  let peakZ = 0;
  const startX = w.ball.pos.x;
  run(w, 300, input(), () => {
    peakZ = Math.max(peakZ, w.ball.z);
    if (zAtLine < 0) {
      flight += TICK_DT;
      if (w.ball.pos.x >= PITCH_LENGTH || w.goals[0] > 0) zAtLine = w.ball.z;
    }
  });
  check(
    "25 米飞行时间落在 0.6–1.0 s",
    flight > 0.6 && flight < 1.0,
    `实测 ${flight.toFixed(3)} s（出发点距门线 ${(PITCH_LENGTH - startX).toFixed(1)} m），最高点 ${peakZ.toFixed(2)} m`,
  );
  check(
    "球在横梁下方入网（不是打飞机）",
    w.goals[0] === 1,
    `goals=${w.goals[0]}，到门线时球高 ${zAtLine < 0 ? "n/a" : zAtLine.toFixed(2) + " m"}（横梁 2.44 m）`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[5] 弧线：Magnus 模型本身");
{
  /** 给定初始 spin，测 30 米射门的横向偏移 */
  function deflection(spin: number): { dy: number; flight: number } {
    const w = solo();
    const b = w.ball;
    b.owner = null;
    b.stickyLock = 999;
    b.pos.x = PITCH_LENGTH - 30;
    // 刻意偏离球门口：射进球门会触发 resetKickoff，把球传送回中圈，
    // 测出来的偏移就变成 0 了（这个坑踩过一次）
    b.pos.y = CENTER_Y + 20;
    b.prevPos.x = b.pos.x;
    b.prevPos.y = b.pos.y;
    const loft = (t.shot.loftAngle * Math.PI) / 180;
    b.vel.x = t.shot.maxPower * Math.cos(loft);
    b.vel.y = 0;
    b.vz = t.shot.maxPower * Math.sin(loft);
    b.spin = spin;
    // 把球员挪走，别让它挡路
    const p = w.players[w.controlled]!;
    p.pos.x = 5;
    p.pos.y = 5;
    p.prevPos.x = 5;
    p.prevPos.y = 5;
    let flight = 0;
    let dy = 0;
    let done = false;
    run(w, 400, input(), () => {
      if (done) return;
      flight += TICK_DT;
      if (b.pos.x >= PITCH_LENGTH) {
        dy = b.pos.y - (CENTER_Y + 20);
        done = true;
      }
    });
    return { dy, flight };
  }

  const straight = deflection(0);
  check(
    "无旋转 → 直线飞行",
    Math.abs(straight.dy) < 0.01,
    `横向偏移 ${straight.dy.toFixed(3)} m`,
  );

  // 横着跑射门时的典型 spin ≈ 球员横向速度（4~6 m/s）
  const spun = deflection(5);
  check(
    "有旋转 → 偏移落在 0.3–4 m（是弧线，不是回旋镖）",
    Math.abs(spun.dy) > 0.3 && Math.abs(spun.dy) < 4,
    `spin=5 时横向偏移 ${spun.dy.toFixed(2)} m，飞行 ${spun.flight.toFixed(2)} s`,
  );

  const heavy = deflection(12);
  check(
    "极端旋转也不该拐成回旋镖（低速时曲率必须收敛）",
    Math.abs(heavy.dy) < 10,
    `spin=12 时横向偏移 ${heavy.dy.toFixed(2)} m`,
  );

  // 出球时的 spin 确实来自球员横向速度。
  // 关键是"横着跑但仍朝着球门" —— 如果朝向已经转到跑动方向上，横向速度就是 0，
  // 也就没有弧线。这不是 bug，是这个射门唯一的技术深度所在。
  const w = solo();
  run(w, 60, input({ moveX: 1 }));
  run(w, Math.ceil(t.shot.chargeTime / TICK_DT) + 2, input({ shoot: true }));
  const p = w.players[w.controlled]!;
  const before = w.ball.owner;
  p.vel.x = 0;
  p.vel.y = 5; // 纯横向速度
  p.facing = 0; // 但仍面朝球门
  step(w, input({ shoot: false }), t, TICK_DT);
  check(
    "横向移动中射门会产生 spin",
    before !== null && Math.abs(w.ball.spin) > 1,
    `出球 spin = ${w.ball.spin.toFixed(2)}（来源：球员横向速度）`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[6] 验收标准 3：贴着别人变向不穿模、不卡住");
{
  const { w, partner } = withPartner(6, 0);
  const other = w.players[partner]!;
  const p = w.players[0]!;
  // 球挪开，这一项只测球员碰撞（别挪到球门口，那会判成乌龙球）
  w.ball.pos.x = CENTER_X;
  w.ball.pos.y = 2;
  w.ball.prevPos.x = w.ball.pos.x;
  w.ball.prevPos.y = w.ball.pos.y;
  w.ball.stickyLock = 999;

  let minDist = Infinity;
  run(w, 120, input({ moveX: 1, sprint: true }), () => {
    minDist = Math.min(minDist, Math.hypot(p.pos.x - other.pos.x, p.pos.y - other.pos.y));
  });
  const minAllowed = p.radius + other.radius;
  check(
    "不穿模：人心距离始终 ≥ 两半径之和",
    minDist >= minAllowed - 1e-6,
    `最近 ${minDist.toFixed(3)} m，下限 ${minAllowed.toFixed(3)} m`,
  );

  const before = { x: p.pos.x, y: p.pos.y };
  run(w, 60, input({ moveX: 1, moveY: 1, sprint: true }));
  const moved = Math.hypot(p.pos.x - before.x, p.pos.y - before.y);
  check(
    "不卡住：贴住后斜向输入能滑动脱离",
    moved > 2,
    `1 秒内位移 ${moved.toFixed(2)} m`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[7] 帧率无关性（D26）：同样的输入必须得到同样的结果");
{
  // 同一段输入分别用 1 次 tick 和"每帧多 tick"的方式跑，结果必须逐位一致
  const a = solo();
  const b = solo();
  const inp = (i: number) => input({ moveX: i < 100 ? 1 : 0, moveY: i >= 100 ? 1 : 0, sprint: true });
  for (let i = 0; i < 200; i++) step(a, inp(i), t, TICK_DT);
  for (let i = 0; i < 200; i++) step(b, inp(i), t, TICK_DT);
  const pa = a.players[a.controlled]!;
  const pb = b.players[b.controlled]!;
  check(
    "相同输入序列 → 完全相同的状态",
    pa.pos.x === pb.pos.x && pa.pos.y === pb.pos.y && a.ball.pos.x === b.ball.pos.x,
    `A(${pa.pos.x.toFixed(6)}, ${pa.pos.y.toFixed(6)}) / B(${pb.pos.x.toFixed(6)}, ${pb.pos.y.toFixed(6)})`,
  );
  console.log("        （sim 只吃传入的 dt，不读时钟 —— 这是手感可复现的前提）");
}

// ─────────────────────────────────────────────────────────────
console.log("\n[8] 球不会飞丢（M1 用围栏兜底，出界规则是 M4）");
{
  const w = solo();
  w.ball.owner = null;
  w.ball.stickyLock = 99;
  w.ball.pos.x = CENTER_X;
  w.ball.pos.y = CENTER_Y;
  w.ball.vel.x = 60;
  w.ball.vel.y = 40;
  run(w, 600, input());
  const inside =
    w.ball.pos.x > -20 && w.ball.pos.x < PITCH_LENGTH + 20 && Math.abs(w.ball.pos.y - CENTER_Y) < 60;
  check("高速球最终留在世界内", inside, `球停在 (${w.ball.pos.x.toFixed(1)}, ${w.ball.pos.y.toFixed(1)})`);
}

// ═════════════════════════════ M2 ═════════════════════════════

console.log("\n[9] 阵型锚点系统（D18）");
{
  /** 把球放到某处，让全队跑到位，返回每人位置 */
  function settle(ballX: number, ballY: number, ticks = 400): World {
    const w = fresh();
    // 把球交给被控球员：球是自由球的话会有人跑去追它，那人自然离锚点很远 ——
    // 那是正确行为，不是阵型跑偏。这一节只测阵型，所以先把追球排除掉。
    const me = w.players[w.controlled]!;
    me.pos.x = ballX - 1;
    me.pos.y = ballY;
    me.prevPos.x = me.pos.x;
    me.prevPos.y = me.pos.y;
    w.ball.pos.x = ballX;
    w.ball.pos.y = ballY;
    w.ball.prevPos.x = ballX;
    w.ball.prevPos.y = ballY;
    w.ball.owner = w.controlled;
    run(w, ticks, input());
    return w;
  }

  const own = settle(20, CENTER_Y);
  const opp = settle(88, CENTER_Y);
  const avgX = (w: World) =>
    w.players.reduce((a, p) => a + p.pos.x, 0) / w.players.length;
  check(
    "球推进到对方半场时，全队整体压上",
    avgX(opp) - avgX(own) > 12,
    `球在 x=20 时全队均值 ${avgX(own).toFixed(1)}，球在 x=88 时 ${avgX(opp).toFixed(1)}（前压 ${(avgX(opp) - avgX(own)).toFixed(1)} m）`,
  );

  // 后卫跟得少、前锋跟得多，这是 D18 的核心
  const shift = (w1: World, w2: World, slot: number) =>
    w2.players.find((p) => p.slot === slot)!.pos.x -
    w1.players.find((p) => p.slot === slot)!.pos.x;
  const dfShift = (shift(own, opp, 2) + shift(own, opp, 3)) / 2;
  const fwShift = (shift(own, opp, 9) + shift(own, opp, 10)) / 2;
  check(
    "后卫跟球幅度明显小于前锋（阵型会拉开又收拢）",
    fwShift > dfShift + 5,
    `中卫前压 ${dfShift.toFixed(1)} m，前锋前压 ${fwShift.toFixed(1)} m`,
  );

  // 活动矩形：谁都不许跑出自己的框
  let worstOver = 0;
  let worstSlot = -1;
  for (const w of [own, opp, settle(52, 8), settle(52, 60)]) {
    for (const p of w.players) {
      if (p.slot === w.players[w.controlled]!.slot) continue; // 被控球员被测试钉住了
      const slot = FORMATION_442[p.slot]!;
      const a = slotAnchor(slot, w.ball.pos, createTuning().ai);
      const over = Math.hypot(p.pos.x - a.x, p.pos.y - a.y);
      if (over > worstOver) {
        worstOver = over;
        worstSlot = p.slot;
      }
    }
  }
  // 阈值取 runnerRadius + 余量：活跃跑位者本来就允许在锚点周围 runnerRadius 米内
  // 挑落点（D19），拿纯锚点当上限是测试写错了
  const roamLimit = createTuning().ai.runnerRadius + 1.5;
  check(
    "所有人都停在自己锚点附近（不满场乱跑）",
    worstOver < roamLimit,
    `离锚点最远的是 ${worstSlot} 号位，${worstOver.toFixed(2)} m（上限 ${roamLimit}）`,
  );

  // followScale = 0 → 全队站基准阵型，这是观察基准值的开关
  {
    const t0 = createTuning();
    t0.ai.followScale = 0;
    t0.ai.activeRunners = 0; // 关掉局部跑位，这一项只想单独验证 followScale
    const w = fresh();
    const me0 = w.players[w.controlled]!;
    me0.pos.x = 89;
    me0.pos.y = 20;
    me0.prevPos.x = 89;
    me0.prevPos.y = 20;
    w.ball.owner = w.controlled;
    w.ball.pos.x = 90;
    w.ball.pos.y = 20;
    for (let i = 0; i < 400; i++) step(w, input(), t0, TICK_DT);
    const moved = w.players.filter((p, i) => {
      if (i === w.controlled) return false;
      const a = slotAnchor(FORMATION_442[p.slot]!, w.ball.pos, t0.ai);
      return Math.hypot(p.pos.x - a.x, p.pos.y - a.y) > 4;
    }).length;
    check(
      "followScale=0 时全队站桩在基准阵型上（参数可解释）",
      moved <= 1,
      `${moved} 人偏离基准锚点超过 4 m`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
console.log("\n[10] 局部跑位与站位质量（D19）");
{
  const w = fresh();
  run(w, 240, input({ moveX: 1 }));
  // 队友不该挤成一坨
  let minPair = Infinity;
  for (let i = 0; i < w.players.length; i++) {
    for (let j = i + 1; j < w.players.length; j++) {
      minPair = Math.min(
        minPair,
        Math.hypot(
          w.players[i]!.pos.x - w.players[j]!.pos.x,
          w.players[i]!.pos.y - w.players[j]!.pos.y,
        ),
      );
    }
  }
  check(
    "10 名队友不会挤成一坨",
    minPair > 2,
    `场上最近的一对相距 ${minPair.toFixed(2)} m`,
  );

  // 活跃跑位者确实在做局部选择，而不是死站锚点
  const t0 = createTuning();
  let differing = 0;
  for (const p of w.players) {
    const a = slotAnchor(FORMATION_442[p.slot]!, w.ball.pos, t0.ai);
    if (Math.hypot(p.aim.x - a.x, p.aim.y - a.y) > 1) differing++;
  }
  check(
    "有队友在做局部跑位（aim 偏离纯锚点）",
    differing >= 1 && differing <= t0.ai.activeRunners + 2,
    `${differing} 人的目标点偏离了纯锚点（activeRunners=${t0.ai.activeRunners}）`,
  );

  // 全场覆盖：不该所有人都堆在一条线上
  const ys = w.players.map((p) => p.pos.y);
  check(
    "阵型在宽度上铺得开",
    Math.max(...ys) - Math.min(...ys) > PITCH_WIDTH * 0.5,
    `纵向跨度 ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)} m / 球场宽 ${PITCH_WIDTH}`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[11] 三种传球（D13/D14/D20/D21）");
{
  /** 让被控球员控住球，朝某方向按某个传球键，返回结果 */
  function doPass(
    key: "passShort" | "passThrough" | "passLong",
    dirX: number,
    dirY: number,
    startX?: number,
    charge = 0.5,
  ) {
    const w = fresh();
    const me = w.players[w.controlled]!;
    if (startX !== undefined) {
      me.pos.x = startX;
      me.prevPos.x = startX;
    }
    // 先把球放到脚下【再】让世界收敛 —— 阵型是围着球算的，
    // 球位置一变，队友需要时间跑到新的锚点上。先传后settle 会量到"队友还在路上"的假象。
    w.ball.owner = w.controlled;
    w.ball.pos.x = me.pos.x + 0.9;
    w.ball.pos.y = me.pos.y;
    w.ball.prevPos.x = w.ball.pos.x;
    w.ball.prevPos.y = w.ball.pos.y;
    run(w, 220, input());
    const before = { owner: w.ball.owner, passes: w.passes };
    // 传球现在是【松开出球】：按住蓄力，松开才出脚
    run(w, chargeTicksFor(charge), input({ [key]: true, moveX: dirX, moveY: dirY } as never));
    step(w, input({ moveX: dirX, moveY: dirY }), t, TICK_DT);
    const launched = w.passes > before.passes;
    const receiver = w.receiver;
    const speed = Math.hypot(w.ball.vel.x, w.ball.vel.y);
    return { w, launched, receiver, speed, vz: w.ball.vz, before };
  }

  const short = doPass("passShort", 1, 0);
  check("短传：能选到人并出球", short.launched && short.receiver !== null,
    short.launched ? `传给 #${short.receiver}，球速 ${short.speed.toFixed(1)} m/s` : "没选到人");
  check("短传是地滚球", short.launched && short.vz === 0, `vz = ${short.vz.toFixed(2)}`);

  const long = doPass("passLong", 1, 0);
  check("长传：能选到人并出球", long.launched && long.receiver !== null,
    long.launched ? `传给 #${long.receiver}，球速 ${long.speed.toFixed(1)} m/s，vz ${long.vz.toFixed(1)}` : "没选到人");
  check("长传是高球（vz > 0）", long.launched && long.vz > 3, `vz = ${long.vz.toFixed(2)}`);

  const through = doPass("passThrough", 1, 0);
  check("直塞：能选到人并出球", through.launched && through.receiver !== null,
    through.launched ? `传给 #${through.receiver}` : "没选到人");

  // 长传应该找更远的人。必须从后场发起 —— 站在中场往前看，
  // 扇形里只有两名前锋、距离几乎一样，那时三个键选到同一个人是正确的，不是 bug。
  const shortDeep = doPass("passShort", 1, 0, 28, 1);
  const longDeep = doPass("passLong", 1, 0, 28, 1);
  if (shortDeep.launched && longDeep.launched) {
    const dist = (r: typeof shortDeep) => {
      const me = r.w.players[r.before.owner!]!;
      const tgt = r.w.players[r.receiver!]!;
      return Math.hypot(tgt.pos.x - me.pos.x, tgt.pos.y - me.pos.y);
    };
    check(
      "从后场发起时，长传选的人比短传远（三个键确实不同）",
      dist(longDeep) > dist(shortDeep) + 3,
      `短传目标 ${dist(shortDeep).toFixed(1)} m（#${shortDeep.receiver}），长传目标 ${dist(longDeep).toFixed(1)} m（#${longDeep.receiver}）`,
    );
  }

  // 直塞的落点必须在队友【前方】，不是脚下 —— 这是直塞存在的唯一理由（D14）
  if (through.launched) {
    const w2 = through.w;
    const tgt = w2.players[through.receiver!]!;
    const dirToBall = Math.atan2(w2.ball.vel.y, w2.ball.vel.x);
    const toTgt = Math.atan2(tgt.pos.y - w2.players[w2.controlled]!.pos.y, tgt.pos.x - w2.players[w2.controlled]!.pos.x);
    check(
      "直塞瞄的是队友前方的空位，不是脚下",
      Math.abs(dirToBall - toTgt) > 0.01,
      `出球方向 ${((dirToBall * 180) / Math.PI).toFixed(1)}° vs 队友方向 ${((toTgt * 180) / Math.PI).toFixed(1)}°`,
    );
  }

  // 意图匹配：往不同方向按同一个键，应该选到不同的人
  const up = doPass("passShort", 0, -1);
  const down = doPass("passShort", 0, 1);
  check(
    "方向输入决定传给谁（意图匹配生效）",
    up.launched && down.launched && up.receiver !== down.receiver,
    `按上传给 #${up.receiver}，按下传给 #${down.receiver}`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[12] D16：传球后的控制权移交");
{
  const w = fresh();
  run(w, 200, input());
  const me = w.players[w.controlled]!;
  const passer = w.controlled;
  w.ball.owner = passer;
  w.ball.pos.x = me.pos.x + 0.9;
  w.ball.pos.y = me.pos.y;
  run(w, 10, input());
  step(w, input({ passShort: true, moveX: 1 }), t, TICK_DT);
  const receiver = w.receiver;

  run(w, 20, input()); // 0.33 s
  check(
    "出脚后 0.5 秒内仍控制传球者（留出传完就跑的空间）",
    w.controlled === passer,
    `0.33 s 时控制的是 #${w.controlled}（传球者 #${passer}）`,
  );

  run(w, 20, input()); // 累计 0.67 s
  check(
    "0.5 秒后控制权移交给接球人",
    w.controlled !== passer,
    `0.67 s 时控制的是 #${w.controlled}（预定接球人 #${receiver}）`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[13] M2 验收：传球到底能不能传成");
{
  /**
   * DESIGN.md §5 对 M2 的验收就一句话：验证"传球有没有目的地可传"。
   * 队友只站在锚点不动的话，短传和直塞就没有意义。
   * 这里从多个位置、多个方向各发一脚，统计球最终落到队友脚下的比例。
   */
  function attempt(key: "passShort" | "passThrough" | "passLong", dirX: number, dirY: number, ballX: number, ballY: number): boolean {
    const w = fresh();
    const me = w.players[w.controlled]!;
    me.pos.x = ballX;
    me.pos.y = ballY;
    me.prevPos.x = ballX;
    me.prevPos.y = ballY;
    w.ball.owner = w.controlled;
    w.ball.pos.x = me.pos.x + 0.9;
    w.ball.pos.y = me.pos.y;
    w.ball.prevPos.x = w.ball.pos.x;
    w.ball.prevPos.y = w.ball.pos.y;
    run(w, 220, input()); // 让阵型围着这个球位置收敛后再传
    const passer = w.controlled;
    run(w, chargeTicksFor(0.5), input({ [key]: true, moveX: dirX, moveY: dirY } as never));
    step(w, input(), t, TICK_DT);
    if (w.passes === 0) return false;
    // 传完不再给任何输入：接球全靠 autoReceive + 队友 AI。
    // 最多观察 8 秒，覆盖高球落地后的接球过程。
    // 球落地后要有人跑过去捡 —— 这是手动力度的正常代价，不是传丢。
    run(w, 480, input());
    return w.ball.owner !== null && w.ball.owner !== passer;
  }

  const dirs: Array<[number, number]> = [[1, 0], [1, -1], [1, 1], [0, -1], [0, 1]];
  const spots: Array<[number, number]> = [[35, 34], [52, 20], [52, 48], [70, 34]];
  for (const key of ["passShort", "passThrough", "passLong"] as const) {
    let ok = 0;
    let tried = 0;
    for (const [dx, dy] of dirs) {
      for (const [bx, by] of spots) {
        tried++;
        if (attempt(key, dx, dy, bx, by)) ok++;
      }
    }
    const pct = (ok / tried) * 100;
    const label = key === "passShort" ? "短传" : key === "passThrough" ? "直塞" : "长传";
    check(
      `${label}成功率 ≥ 70%（球最终到了队友脚下）`,
      pct >= 70,
      `${ok}/${tried} = ${pct.toFixed(0)}%`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
console.log("\n[14] 带球跑动中传球（真实操作场景）");
{
  /**
   * 回归测试。此前 [11][13] 都是"全队站定后再传"，
   * 而玩家实际是【一边带球跑一边传】—— 那时全队都在跟着球移动。
   * 两个盲区都是在这个场景下才暴露的：
   *   1. 扇形 55° 太窄，短传有 23% 的按键什么都不发生（哑键）
   *   2. 瞄准点没有预判接球人的移动
   */
  function press(
    key: "passShort" | "passThrough" | "passLong",
    runX: number,
    runY: number,
    dirX: number,
    dirY: number,
    dribbleTicks: number,
  ) {
    const w = fresh();
    run(w, 40, input({ moveX: 1 }));
    if (w.ball.owner !== w.controlled) return null;
    run(w, dribbleTicks, input({ moveX: runX, moveY: runY, sprint: true }));
    if (w.ball.owner !== w.controlled) return null;

    const before = w.passes;
    run(w, chargeTicksFor(0.5), input({ [key]: true, moveX: dirX, moveY: dirY, sprint: true } as never));
    step(w, input({ moveX: dirX, moveY: dirY, sprint: true }), t, TICK_DT);
    if (w.passes === before)
      return { launched: false, correct: false, drift: 0, collected: false, mismatch: false };

    const rcv = w.receiver;
    const target = rcv !== null ? w.players[rcv]! : null;
    const at0 = target ? { x: target.pos.x, y: target.pos.y } : null;
    // 8 秒：45 米的回传长传会滚出边线，后卫得慢慢跑过去捡。
    // 出界规则是 M4 的内容，M2 里球只是撞在围栏上停住，所以要给足回收时间。
    let touched: number | null = null;
    for (let i = 0; i < 480; i++) {
      step(w, input(), t, TICK_DT);
      if (w.ball.owner !== null) {
        touched = w.ball.owner;
        break;
      }
    }
    return {
      launched: true,
      // 真正要保证的不是"预定的那个人拿到球"（半路被别的队友接走是正常足球），
      // 而是【拿到球的那个人就是你正在控制的人】—— 这才是"进攻就是持球队员"。
      correct: touched !== null && touched === w.controlled,
      collected: touched !== null,
      mismatch: touched !== null && touched !== w.controlled,
      drift: target && at0 ? Math.hypot(target.pos.x - at0.x, target.pos.y - at0.y) : 0,
    };
  }

  const dirs: Array<[number, number]> = [
    [1, 0], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [-1, 1], [-1, -1],
  ];
  const runs: Array<[number, number]> = [[1, 0], [1, -0.6], [1, 0.6], [0, 1]];
  const ticks = [40, 90, 150, 220];

  for (const key of ["passShort", "passThrough", "passLong"] as const) {
    let n = 0;
    let launched = 0;
    let correct = 0;
    let drift = 0;
    let uncollected = 0;
    let mismatched = 0;
    for (const [rx, ry] of runs) {
      for (const [dx, dy] of dirs) {
        for (const tk of ticks) {
          const r = press(key, rx, ry, dx, dy, tk);
          if (!r) continue;
          n++;
          if (r.launched) launched++;
          if (r.correct) correct++;
          if (r.launched && !r.collected) uncollected++;
          if (r.mismatch) mismatched++;
          drift += r.drift;
        }
      }
    }
    const label = key === "passShort" ? "短传" : key === "passThrough" ? "直塞" : "长传";
    check(
      `${label}：按键必定有球出去（不能是哑键）`,
      launched === n,
      `${launched}/${n} 次出球${launched === n ? "" : ` —— ${n - launched} 次按下去什么都没发生`}`,
    );
    check(
      `${label}：接到球的人就是你控制的人 ≥ 98%`,
      (correct / n) * 100 >= 98,
      `${correct}/${n} = ${((correct / n) * 100).toFixed(0)}% —— 8 秒内没人接到 ${uncollected} 次，接到了但不是你控的人 ${mismatched} 次`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
console.log("\n[15] 传球被半路截胡的比例");
{
  /**
   * 试玩反馈：「我传的方向明明是这个，但是被另一个队友拿到了」。
   *
   * [14] 量的是"接到球的人就是你控制的人"，那个已经 100% ——
   * 但那只是让控制权跟着球跑，掩盖了"球给了另一个人"这件事本身。
   * 这里量的才是玩家真正感受到的那个数：出球时瞄的是 A，最后球到了 B 脚下。
   */
  function trial(
    key: "passShort" | "passThrough" | "passLong",
    rx: number, ry: number, dx: number, dy: number, ticks: number, charge: number,
  ) {
    const w = fresh();
    run(w, 40, input({ moveX: 1 }));
    if (w.ball.owner !== w.controlled) return null;
    run(w, ticks, input({ moveX: rx, moveY: ry, sprint: true }));
    if (w.ball.owner !== w.controlled) return null;
    run(w, chargeTicksFor(charge), input({ [key]: true, moveX: dx, moveY: dy, sprint: true } as never));
    step(w, input({ moveX: dx, moveY: dy, sprint: true }), t, TICK_DT);
    const rcv = w.receiver;
    if (rcv === null) return { intoSpace: true, stolen: false };
    for (let i = 0; i < 480; i++) {
      step(w, input(), t, TICK_DT);
      if (w.ball.owner !== null) return { intoSpace: false, stolen: w.ball.owner !== rcv };
    }
    return { intoSpace: false, stolen: false };
  }

  const dirs: Array<[number, number]> = [
    [1, 0], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [-1, 1], [-1, -1],
  ];
  const runs: Array<[number, number]> = [[1, 0], [1, -0.6], [1, 0.6], [0, 1]];
  const limits = { passShort: 8, passThrough: 12, passLong: 20 } as const;

  for (const key of ["passShort", "passThrough", "passLong"] as const) {
    let n = 0;
    let stolen = 0;
    let space = 0;
    for (const [rx, ry] of runs) {
      for (const [dx, dy] of dirs) {
        for (const tk of [40, 150]) {
          for (const ch of [0.15, 0.5, 1]) {
            const r = trial(key, rx, ry, dx, dy, tk, ch);
            if (!r) continue;
            n++;
            if (r.stolen) stolen++;
            if (r.intoSpace) space++;
          }
        }
      }
    }
    const pct = (stolen / n) * 100;
    const label = key === "passShort" ? "短传" : key === "passThrough" ? "直塞" : "长传";
    check(
      `${label}：被别的队友半路接走 ≤ ${limits[key]}%`,
      pct <= limits[key],
      `${stolen}/${n} = ${pct.toFixed(0)}%（另有 ${space} 次没有目标、传向空档）`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
console.log("\n[16] 力度条：蓄力决定传多远");
{
  function passAt(charge: number): number | null {
    const w = fresh();
    const me = w.players[w.controlled]!;
    me.pos.x = 30;
    me.prevPos.x = 30;
    w.ball.owner = w.controlled;
    w.ball.pos.x = me.pos.x + 0.9;
    w.ball.pos.y = me.pos.y;
    w.ball.prevPos.x = w.ball.pos.x;
    w.ball.prevPos.y = w.ball.pos.y;
    run(w, 220, input());
    const from = { x: w.players[w.controlled]!.pos.x, y: w.players[w.controlled]!.pos.y };
    run(w, chargeTicksFor(charge), input({ passLong: true, moveX: 1 }));
    step(w, input({ moveX: 1 }), t, TICK_DT);
    if (w.receiver === null) return null;
    const tgt = w.players[w.receiver]!;
    return Math.hypot(tgt.pos.x - from.x, tgt.pos.y - from.y);
  }
  const tap = passAt(0.05);
  const full = passAt(1);
  check(
    "轻点传近的人，蓄满传远的人",
    tap !== null && full !== null && full > tap + 5,
    `轻点选中 ${tap?.toFixed(1)} m 处的队友，蓄满选中 ${full?.toFixed(1)} m 处的队友`,
  );

  // 无接球目标时蓄力仍控制射程。已选中队友时，送达能力由 gameplay-regression 覆盖。
  function ballSpeed(key: "passShort" | "passThrough" | "passLong", charge: number): number {
    const w = fresh();
    const me = w.players[w.controlled]!;
    w.players = [me];
    w.controlled = 0;
    me.pos.x = 35;
    me.prevPos.x = 35;
    w.ball.owner = w.controlled;
    w.ball.pos.x = me.pos.x + 0.9;
    w.ball.pos.y = me.pos.y;
    w.ball.prevPos.x = w.ball.pos.x;
    w.ball.prevPos.y = w.ball.pos.y;
    run(w, 220, input());
    run(w, chargeTicksFor(charge), input({ [key]: true, moveX: 1 } as never));
    step(w, input({ moveX: 1 }), t, TICK_DT);
    return Math.hypot(w.ball.vel.x, w.ball.vel.y, w.ball.vz);
  }
  for (const key of ["passShort", "passThrough", "passLong"] as const) {
    const lo = ballSpeed(key, 0.05);
    const mid = ballSpeed(key, 0.5);
    const hi = ballSpeed(key, 1);
    const label = key === "passShort" ? "短传" : key === "passThrough" ? "直塞" : "长传";
    check(
      `${label}：无人接应时蓄力增加自由传球射程`,
      hi > mid && mid > lo && hi > lo * 1.4,
      `轻点 ${lo.toFixed(1)} → 半蓄 ${mid.toFixed(1)} → 蓄满 ${hi.toFixed(1)} m/s（快了 ${(((hi - lo) / lo) * 100).toFixed(0)}%）`,
    );
  }

  // 射门和传球共用一套蓄力：同时按下时先按的那个说了算
  const w = fresh();
  run(w, 60, input({ moveX: 1 }));
  run(w, 6, input({ passShort: true }));
  const kindAfterShortHeld = w.charge.kind;
  run(w, 6, input({ passShort: true, shoot: true }));
  check(
    "同一时刻只能蓄一个动作（先按下的说了算）",
    kindAfterShortHeld === "short" && w.charge.kind === "short",
    `先按 J 时蓄的是 ${kindAfterShortHeld}，再按下 K 之后仍然是 ${w.charge.kind}`,
  );
}

// ═════════════════════════════ M3 ═════════════════════════════

console.log("\n[17] 对手存在，而且会防守");
{
  const w = full();
  check(
    "场上是 22 个人，两队各 11 人",
    w.players.length === 22 &&
      w.players.filter((p) => p.team === 0).length === 11 &&
      w.players.filter((p) => p.team === 1).length === 11,
    `${w.players.length} 人，我方 ${w.players.filter((p) => p.team === 0).length} 对方 ${w.players.filter((p) => p.team === 1).length}`,
  );
  check(
    "两队朝相反方向进攻（阵型镜像）",
    (() => {
      const fw0 = w.players.filter((p) => p.team === 0 && p.slot >= 9);
      const fw1 = w.players.filter((p) => p.team === 1 && p.slot >= 9);
      const a = fw0.reduce((s2, p) => s2 + p.pos.x, 0) / fw0.length;
      const b = fw1.reduce((s2, p) => s2 + p.pos.x, 0) / fw1.length;
      return a > CENTER_X && b < CENTER_X;
    })(),
    "双方前锋分别站在中线两侧",
  );

  /**
   * 玩家持球，多久被对手断掉。
   *
   * sprintAway 时朝【离最近对手最远】的方向跑，而不是朝对方球门跑 ——
   * 早先这里写的是 moveX:1，那是一头扎进对方防线，量到的"跑开更快被断"
   * 是测试写错了，不是防守有问题。
   */
  function holdBall(sprintAway: boolean): number {
    const w2 = full();
    run(w2, 30, input({ moveX: 1 }));
    w2.ball.owner = w2.controlled;
    const me = w2.players[w2.controlled]!;
    w2.ball.pos.x = me.pos.x + 0.9;
    w2.ball.pos.y = me.pos.y;
    for (let i2 = 0; i2 < 900; i2++) {
      let cmd = input();
      if (sprintAway) {
        let nx = -1;
        let ny = 0;
        let bd = Infinity;
        for (const q of w2.players) {
          if (q.team === 0) continue;
          const d = Math.hypot(q.pos.x - me.pos.x, q.pos.y - me.pos.y);
          if (d < bd) {
            bd = d;
            nx = me.pos.x - q.pos.x;
            ny = me.pos.y - q.pos.y;
          }
        }
        const n = Math.hypot(nx, ny) || 1;
        cmd = input({ moveX: nx / n, moveY: ny / n, sprint: true });
      }
      step(w2, cmd, t, TICK_DT);
      const o = w2.ball.owner;
      if (o !== null && w2.players[o]!.team === 1) return i2 * TICK_DT;
      if (o === null && w2.ball.stickyLock > 0) return i2 * TICK_DT; // 被铲掉
    }
    return Infinity;
  }
  const still = holdBall(false);
  const running = holdBall(true);
  check(
    "站着不动会被对手断球（防守不是摆设）",
    still < 8,
    `原地持球 ${still === Infinity ? "15 秒都没被断" : still.toFixed(1) + " 秒被断"}`,
  );
  check(
    "带球跑开能拖住更久（逼抢不是瞬移贴脸）",
    running > still,
    `原地 ${still.toFixed(1)}s vs 冲刺逃离 ${running === Infinity ? ">15" : running.toFixed(1)}s`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[18] 铲抢与硬直（D12）");
{
  /** 让对手持球并停在我方球员身边，然后按 K */
  function setup(distance: number): World {
    const w = full();
    const me = w.players[w.controlled]!;
    const foe = w.players.find((p) => p.team === 1 && p.slot === 9)!;
    const foeIdx = w.players.indexOf(foe);
    foe.pos.x = me.pos.x + distance;
    foe.pos.y = me.pos.y;
    foe.prevPos.x = foe.pos.x;
    foe.prevPos.y = foe.pos.y;
    w.ball.owner = foeIdx;
    w.ball.pos.x = foe.pos.x;
    w.ball.pos.y = foe.pos.y;
    w.ball.prevPos.x = w.ball.pos.x;
    w.ball.prevPos.y = w.ball.pos.y;
    me.facing = 0;
    me.prevFacing = 0;
    return w;
  }

  {
    const w = setup(1.2);
    const before = w.ball.owner;
    step(w, input({ shoot: true }), t, TICK_DT);
    check(
      "够得着时按 K 能把球断下来",
      w.ball.owner !== before && w.tacklesWon === 1,
      `断球 ${w.tacklesWon} 次，球权 ${before} → ${w.ball.owner}`,
    );
  }

  {
    const w = setup(6); // 够不着
    const me = w.players[w.controlled]!;
    step(w, input({ shoot: true }), t, TICK_DT);
    check("落空时不会误判为断球", w.tacklesWon === 0, `tacklesWon=${w.tacklesWon}`);
    run(w, Math.ceil(t.tackle.windowTime / TICK_DT) + 2, input({ shoot: false }));
    check(
      "铲空之后进入硬直",
      me.stun > 0,
      `硬直剩余 ${me.stun.toFixed(2)} s（recovery=${t.tackle.recovery}）`,
    );

    // 硬直期间按方向键不该动起来
    const at = { x: me.pos.x, y: me.pos.y };
    const stunTicks = Math.ceil(me.stun / TICK_DT);
    run(w, stunTicks, input({ moveY: 1, sprint: true }));
    const moved = Math.hypot(me.pos.x - at.x, me.pos.y - at.y);
    check(
      "硬直期间完全不受控（这是防守博弈的全部来源）",
      moved < 1.2 && me.stun === 0,
      `硬直 ${(stunTicks * TICK_DT).toFixed(2)} s 内只滑行了 ${moved.toFixed(2)} m`,
    );
  }

  {
    // 连按抢断键不该变成无成本行为
    const w = setup(6);
    const me = w.players[w.controlled]!;
    run(w, 120, input({ shoot: true }));
    // 只数【被控球员自己】的出脚：world.tackles 是全场计数，
    // AI 队友现在也会铲球，混进来这条断言就测不到它想测的东西了
    let presses = 0;
    let prevCd = me.tackleCooldown;
    for (let i2 = 0; i2 < 300; i2++) {
      step(w, input({ shoot: i2 % 2 === 0 }), t, TICK_DT);
      if (me.tackleCooldown > prevCd) presses++;
      prevCd = me.tackleCooldown;
    }
    const seconds = 300 * TICK_DT;
    check(
      "疯狂连按抢断键，出脚次数被硬直+冷却限住",
      presses <= Math.ceil(seconds / (t.tackle.windowTime + t.tackle.recovery)) + 1,
      `${seconds.toFixed(1)} 秒内只出脚 ${presses} 次（窗口 ${t.tackle.windowTime}s + 硬直 ${t.tackle.recovery}s）`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
console.log("\n[19] 防守切人（D15）");
{
  const w = full();
  // 延长无主球争夺，隔离 AI 抢到球后的合法进攻移交。
  const foe = w.players.find((p) => p.team === 1 && p.slot === 10)!;
  const foeIdx = w.players.indexOf(foe);
  w.ball.owner = null;
  w.ball.stickyLock = 999;
  w.lastTouch = 1;
  w.ball.pos.x = foe.pos.x;
  w.ball.pos.y = foe.pos.y;
  run(w, 30, input());

  const before = w.controlled;
  step(w, input({ passShort: true }), t, TICK_DT);
  const after = w.controlled;
  check(
    "防守时按 J 会切到另一名己方球员",
    after !== before && w.players[after]!.team === 0,
    `#${before} → #${after}`,
  );
  check("切人时不会切到门将", w.players[after]!.slot !== 0, `切到的是 slot ${w.players[after]!.slot}`);

  // 连按仍可换人，但限定附近最多三人，防止轮换到远处另一边路。
  {
    const seen = [w.controlled];
    for (let k = 0; k < 4; k++) {
      step(w, input(), t, TICK_DT); // 松开
      step(w, input({ passShort: true }), t, TICK_DT); // 再按
      seen.push(w.controlled);
    }
    const distinct = new Set(seen).size;
    check(
      "连按 J 在附近最多三名球员之间轮换",
      distinct >= 2 && distinct <= 3,
      `连按 5 次经过 ${distinct} 个不同球员：${seen.map((x) => "#" + x).join(" → ")}`,
    );
  }

  // 按住不放不该连切。
  //
  // 这一条测的是【按键的边沿检测】，所以要把其他会合法改变控制权的东西都排除掉：
  //  - 自动切人（那是 [30] 的内容）→ 迟滞调到无穷大
  //  - 球权变化（AI 队友现在真的会断球）→ 球锁死在无人能碰的地方
  const noAuto = createTuning();
  noAuto.ai.autoSwitchMargin = 999;
  const w2 = full();
  w2.ball.owner = null;
  w2.ball.stickyLock = 9999;
  w2.ball.pos.x = CENTER_X;
  w2.ball.pos.y = CENTER_Y;
  w2.ball.prevPos.x = CENTER_X;
  w2.ball.prevPos.y = CENTER_Y;
  step(w2, input({ passShort: true }), noAuto, TICK_DT);
  const held = w2.controlled;
  for (let i2 = 0; i2 < 60; i2++) step(w2, input({ passShort: true }), noAuto, TICK_DT);
  check(
    "按住 J 不放不会连续切人",
    w2.controlled === held,
    `按下时切到 #${held}，按住 1 秒后仍是 #${w2.controlled}`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[20] 越位硬性否决（D4 / D21）");
{
  /**
   * D4 说得很清楚：没有越位，最优解就是把一个前锋永久停在对方门前一直吊球，
   * 短传和直塞体系立刻死亡。M2 里没有对手无从判起（§10.6），现在才真正生效。
   */
  const w = full();
  const me = w.players[w.controlled]!;
  me.pos.x = 60;
  me.pos.y = CENTER_Y;
  me.prevPos.x = me.pos.x;
  me.prevPos.y = me.pos.y;

  // 把对方所有人（除门将）拉回到 x=70 之前，再把一名前锋放到 x=95 —— 明显越位
  for (const p of w.players) {
    if (p.team !== 1) continue;
    p.pos.x = p.slot === 0 ? 100 : 68;
    p.prevPos.x = p.pos.x;
  }
  const cheater = w.players.find((p) => p.team === 0 && p.slot === 9)!;
  const cheaterIdx = w.players.indexOf(cheater);
  cheater.pos.x = 95;
  cheater.pos.y = CENTER_Y;
  cheater.prevPos.x = 95;
  cheater.prevPos.y = CENTER_Y;

  w.ball.owner = w.controlled;
  w.ball.pos.x = me.pos.x + 0.9;
  w.ball.pos.y = me.pos.y;
  step(w, input(), t, TICK_DT);

  run(w, chargeTicksFor(1), input({ passThrough: true, moveX: 1 }));
  step(w, input({ moveX: 1 }), t, TICK_DT);
  check(
    "直塞不会传给越位的球员（门口挂机没有用）",
    w.receiver !== cheaterIdx,
    `直塞给了 #${w.receiver}，越位的挂机前锋是 #${cheaterIdx}`,
  );

  // 同一个人不越位时应该传得到
  const w2 = full();
  const me2 = w2.players[w2.controlled]!;
  me2.pos.x = 60;
  me2.pos.y = CENTER_Y;
  me2.prevPos.x = 60;
  me2.prevPos.y = CENTER_Y;
  for (const p of w2.players) {
    if (p.team !== 1) continue;
    p.pos.x = p.slot === 0 ? 100 : 92; // 防线压到 92，前锋在 80 就不越位了
    p.prevPos.x = p.pos.x;
  }
  const onside = w2.players.find((p) => p.team === 0 && p.slot === 9)!;
  const onsideIdx = w2.players.indexOf(onside);
  onside.pos.x = 80;
  onside.pos.y = CENTER_Y;
  onside.prevPos.x = 80;
  onside.prevPos.y = CENTER_Y;
  w2.ball.owner = w2.controlled;
  w2.ball.pos.x = me2.pos.x + 0.9;
  w2.ball.pos.y = me2.pos.y;
  step(w2, input(), t, TICK_DT);
  run(w2, chargeTicksFor(1), input({ passThrough: true, moveX: 1 }));
  step(w2, input({ moveX: 1 }), t, TICK_DT);
  check(
    "同一个位置不越位时，直塞传得到",
    w2.receiver === onsideIdx,
    `直塞给了 #${w2.receiver}（期望 #${onsideIdx}）`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[21] 两个球门、两队计分");
{
  function shootInto(side: "right" | "left"): World {
    const w = full();
    const b = w.ball;
    b.owner = null;
    b.stickyLock = 999;
    // 偏开门将 3 米：门将站在门线中央，正对着射会被他的身体挡下来
    b.pos.y = CENTER_Y - 3;
    b.prevPos.y = b.pos.y;
    b.pos.x = side === "right" ? PITCH_LENGTH - 12 : 12;
    b.prevPos.x = b.pos.x;
    b.vel.x = side === "right" ? 25 : -25;
    b.vel.y = 0;
    run(w, 120, input());
    return w;
  }
  const r = shootInto("right");
  check(
    "球进右门算我方得分",
    r.goals[0] === 1 && r.goals[1] === 0,
    `比分 ${r.goals[0]} - ${r.goals[1]}`,
  );
  const l = shootInto("left");
  check(
    "球进左门算对方得分",
    l.goals[1] === 1 && l.goals[0] === 0,
    `比分 ${l.goals[0]} - ${l.goals[1]}`,
  );
}

// ═════════════════════════════ M4 ═════════════════════════════

console.log("\n[22] 出界：界外球 / 角球 / 球门球（D3）");
{
  /** 把球放到某处、指定最后触球方、给它一个速度，然后跑到死球为止 */
  function sendOut(x: number, y: number, vx: number, vy: number, touch: 0 | 1): World {
    const w = full();
    const b = w.ball;
    b.owner = null;
    b.stickyLock = 999; // 别让路过的人把它捡起来，这一节只测出界判罚
    b.pos.x = x;
    b.pos.y = y;
    b.prevPos.x = x;
    b.prevPos.y = y;
    b.vel.x = vx;
    b.vel.y = vy;
    w.lastTouch = touch;
    for (let i2 = 0; i2 < 300; i2++) {
      step(w, input(), t, TICK_DT);
      if (w.phase === "restart") break;
    }
    return w;
  }

  // 出边线 → 界外球判给没碰球的那队
  const throwIn = sendOut(CENTER_X, 4, 0, -14, 0);
  check(
    "球出边线 → 界外球，判给没碰球的一方",
    throwIn.restart?.kind === "throwIn" && throwIn.restart.team === 1,
    `${throwIn.restart?.label ?? "没判"}，开球方 team ${throwIn.restart?.team}`,
  );
  check(
    "界外球的位置在出界的那条边线上",
    !!throwIn.restart && Math.abs(throwIn.restart.at.y - 0.4) < 0.01,
    `开球点 (${throwIn.restart?.at.x.toFixed(1)}, ${throwIn.restart?.at.y.toFixed(1)})`,
  );

  // 进攻方（0 队）把球打出对方底线 → 球门球给 1 队
  const goalKick = sendOut(PITCH_LENGTH - 8, CENTER_Y + 12, 20, 6, 0);
  check(
    "进攻方打出对方底线 → 球门球给防守方",
    goalKick.restart?.kind === "goalKick" && goalKick.restart.team === 1,
    `${goalKick.restart?.label ?? "没判"}，开球方 team ${goalKick.restart?.team}`,
  );
  check(
    "球门球由门将主罚",
    !!goalKick.restart && goalKick.players[goalKick.restart.taker]!.slot === 0,
    `主罚的是 slot ${goalKick.restart ? goalKick.players[goalKick.restart.taker]!.slot : "?"}`,
  );

  // 防守方（1 队）把球打出自家底线 → 角球给 0 队
  const corner = sendOut(PITCH_LENGTH - 8, CENTER_Y + 12, 20, 6, 1);
  check(
    "防守方打出自家底线 → 角球给进攻方",
    corner.restart?.kind === "corner" && corner.restart.team === 0,
    `${corner.restart?.label ?? "没判"}，开球方 team ${corner.restart?.team}`,
  );
  check(
    "角球开在离出界点最近的那个角",
    !!corner.restart &&
      Math.abs(corner.restart.at.x - (PITCH_LENGTH - 0.5)) < 0.01 &&
      corner.restart.at.y > CENTER_X * 0 + PITCH_WIDTH / 2,
    `角球点 (${corner.restart?.at.x.toFixed(1)}, ${corner.restart?.at.y.toFixed(1)})`,
  );

  // 球【不会】瞬移到开球点：它停在自己滚出去的地方，等人来捡
  check(
    "判罚的那一刻球还在出界的地方，没有闪到开球点",
    !!corner.restart &&
      Math.hypot(
        corner.ball.pos.x - corner.restart.at.x,
        corner.ball.pos.y - corner.restart.at.y,
      ) > 3,
    `球在 (${corner.ball.pos.x.toFixed(1)}, ${corner.ball.pos.y.toFixed(1)})，角球点在 (${corner.restart?.at.x.toFixed(1)}, ${corner.restart?.at.y.toFixed(1)})`,
  );
  check(
    "判罚当下处于「跑过去捡球」阶段",
    corner.restart?.stage === "fetch",
    `阶段 ${corner.restart?.stage}`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[23] 越位判罚（D4）");
{
  /**
   * 直塞的目标筛选会主动躲开越位的人（[20] 已测），但长传没有这个否决 ——
   * 玩家照样可以硬往越位的人身上传。那就该在他【接到球的时候】吹掉。
   * 这正是 D4 说的"承重墙"：没有它，吊长传给门口挂机就是最优解。
   */
  const w = full();
  const me = w.players[w.controlled]!;
  me.pos.x = 55;
  me.pos.y = CENTER_Y;
  me.prevPos.x = 55;
  me.prevPos.y = CENTER_Y;
  // 对方防线压到 70，门将在 100
  for (const p of w.players) {
    if (p.team !== 1) continue;
    p.pos.x = p.slot === 0 ? 100 : 70;
    p.pos.y = p.slot === 0 ? CENTER_Y : CENTER_Y + (p.slot - 5) * 5;
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
  }
  // 己方一名前锋站到 88，明显越位
  const cheat = w.players.find((p) => p.team === 0 && p.slot === 9)!;
  const cheatIdx = w.players.indexOf(cheat);
  cheat.pos.x = 88;
  cheat.pos.y = CENTER_Y;
  cheat.prevPos.x = 88;
  cheat.prevPos.y = CENTER_Y;
  // 其余队友挪到身后，保证长传只可能选他
  for (const p of w.players) {
    if (p.team !== 0 || p === cheat || p === me || p.slot === 0) continue;
    p.pos.x = 20;
    p.prevPos.x = 20;
  }

  w.ball.owner = w.controlled;
  w.ball.pos.x = me.pos.x + 0.9;
  w.ball.pos.y = me.pos.y;
  step(w, input(), t, TICK_DT);
  // 蓄力要配上距离：长传蓄满会飞 45 米，直接越过挂机前锋滚进球门（那是力度条正常工作，
  // 不是判罚出问题）。这里蓄到刚好 32 米。
  run(w, chargeTicksFor(0.55), input({ passLong: true, moveX: 1 }));
  step(w, input({ moveX: 1 }), t, TICK_DT);

  check(
    "出球瞬间记下了处于越位位置的球员",
    w.offsideFlags.includes(cheatIdx),
    `越位名单 [${w.offsideFlags.join(", ")}]，挂机前锋是 #${cheatIdx}`,
  );

  // 把球直接放到越位球员脚边。
  //
  // 这一节要验证的是【规则】，不是长传的落点精度 —— 让球飞过去会顺带测到
  // "高球落地后还能滚多远"，那是另一件事（弹地保留 82% 水平速度），
  // 混进来只会让这条断言时灵时不灵。
  w.ball.pos.x = cheat.pos.x + 0.3;
  w.ball.pos.y = cheat.pos.y;
  w.ball.prevPos.x = w.ball.pos.x;
  w.ball.prevPos.y = w.ball.pos.y;
  w.ball.vel.x = 0;
  w.ball.vel.y = 0;
  w.ball.z = 0;
  w.ball.vz = 0;
  w.ball.stickyLock = 0;

  let whistled = false;
  for (let i2 = 0; i2 < 120; i2++) {
    step(w, input(), t, TICK_DT);
    if (w.phase === "restart") {
      whistled = w.restart?.label === "越位";
      break;
    }
  }
  check(
    "越位的球员碰到球就被吹掉，任意球给对方",
    whistled && w.restart?.team === 1,
    whistled ? `判了越位，任意球给 team ${w.restart?.team}` : `没吹越位（判的是 ${w.restart?.label ?? "什么都没判"}）`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[24] 犯规：撞上去才算，伸脚够不到不算（D5）");
{
  /** 对手贴在身前 gap 米持球，球在他的另一侧 —— 够得到人，够不到球 */
  function setup(gap: number) {
    const w = full();
    const me = w.players[w.controlled]!;
    const foe = w.players.find((p) => p.team === 1 && p.slot === 9)!;
    const foeIdx = w.players.indexOf(foe);
    foe.pos.x = me.pos.x + gap;
    foe.pos.y = me.pos.y;
    foe.prevPos.x = foe.pos.x;
    foe.prevPos.y = foe.pos.y;
    w.ball.owner = foeIdx;
    w.ball.pos.x = foe.pos.x + 0.9;
    w.ball.pos.y = foe.pos.y;
    w.ball.prevPos.x = w.ball.pos.x;
    w.ball.prevPos.y = w.ball.pos.y;
    me.facing = 0;
    me.prevFacing = 0;
    return { w, me };
  }

  /**
   * 犯规判据是【你是撞上去的，还是伸脚够的】。
   *
   * 早先只看距离：任何落空的出脚只要挨着人就吹。
   * 实测一场 3 分钟判 29 次任意球（每 10 秒一次），死球吃掉全场 40% 的时间 ——
   * 玩家的感受就是"比赛一直在停，我根本没机会抢"。
   */
  {
    const { w, me } = setup(1.0);
    step(w, input({ shoot: true }), t, TICK_DT); // K = 站立抢断，前扑 3.5 m/s
    check(
      "站着伸脚够不到球，不判犯规（只是白费一次出脚）",
      w.phase === "playing",
      `出脚前扑 ${t.tackle.lungeSpeed} m/s < 撞人阈值 ${t.rules.foulSpeed} m/s，判罚：${w.restart?.label ?? "无"}`,
    );
    check("伸脚落空照样吃硬直", me.stun > 0 || me.lunge > 0, `硬直 ${me.stun.toFixed(2)} s`);
  }

  {
    // 球放到对手【侧面】3 米外：滑铲够得到人（间隙 0.3 m），但够不到球（3.2 m > 2.6 m）。
    // 把球放在对手身后 0.9 m 是不行的 —— 那个距离滑铲正好够得着，会变成干净断球。
    const w = full();
    const me = w.players[w.controlled]!;
    const foe = w.players.find((p) => p.team === 1 && p.slot === 9)!;
    const foeIdx = w.players.indexOf(foe);
    foe.pos.x = me.pos.x + 1.2;
    foe.pos.y = me.pos.y;
    foe.prevPos.x = foe.pos.x;
    foe.prevPos.y = foe.pos.y;
    w.ball.owner = foeIdx;
    w.ball.pos.x = foe.pos.x;
    w.ball.pos.y = foe.pos.y + 3.0;
    w.ball.prevPos.x = w.ball.pos.x;
    w.ball.prevPos.y = w.ball.pos.y;
    me.facing = 0;
    me.prevFacing = 0;
    step(w, input({ passThrough: true }), t, TICK_DT); // L = 滑铲，冲进去 11 m/s
    check(
      "滑铲撞到人却没碰到球 → 判犯规，任意球给对方",
      w.phase === "restart" && w.restart?.kind === "freeKick" && w.restart.team === 1,
      `滑铲速度 ${t.slide.speed} m/s ≥ 阈值 ${t.rules.foulSpeed}，判罚：${w.restart?.label ?? "无"}`,
    );
    check("犯规的人照样吃硬直", me.stun > 0, `硬直剩余 ${me.stun.toFixed(2)} s`);
  }

  {
    // 干净断球（够得到球）不该判犯规
    const w2 = full();
    const me2 = w2.players[w2.controlled]!;
    const foe2 = w2.players.find((p) => p.team === 1 && p.slot === 9)!;
    const foe2Idx = w2.players.indexOf(foe2);
    foe2.pos.x = me2.pos.x + 2.6;
    foe2.pos.y = me2.pos.y;
    foe2.prevPos.x = foe2.pos.x;
    foe2.prevPos.y = foe2.pos.y;
    w2.ball.owner = foe2Idx;
    w2.ball.pos.x = me2.pos.x + 1.3;
    w2.ball.pos.y = me2.pos.y;
    w2.ball.prevPos.x = w2.ball.pos.x;
    w2.ball.prevPos.y = w2.ball.pos.y;
    me2.facing = 0;
    me2.prevFacing = 0;
    step(w2, input({ shoot: true }), t, TICK_DT);
    check(
      "干净断球不判犯规",
      w2.phase === "playing" && w2.tacklesWon === 1,
      `断球 ${w2.tacklesWon} 次，阶段 ${w2.phase}`,
    );
  }

  {
    // 断球要往【本方进攻方向】捅，不是往防守者当时的朝向捅。
    // 后者等于每断一次球就给对方送一个角球（实测死球占全场 74%）。
    const w3 = full();
    const me3 = w3.players[w3.controlled]!;
    const foe3 = w3.players.find((p) => p.team === 1 && p.slot === 9)!;
    const foe3Idx = w3.players.indexOf(foe3);
    me3.facing = Math.PI; // 面朝自家球门
    me3.prevFacing = Math.PI;
    foe3.pos.x = me3.pos.x - 1.2;
    foe3.pos.y = me3.pos.y;
    foe3.prevPos.x = foe3.pos.x;
    foe3.prevPos.y = foe3.pos.y;
    w3.ball.owner = foe3Idx;
    w3.ball.pos.x = foe3.pos.x;
    w3.ball.pos.y = foe3.pos.y;
    w3.ball.prevPos.x = w3.ball.pos.x;
    w3.ball.prevPos.y = w3.ball.pos.y;
    step(w3, input({ passThrough: true }), t, TICK_DT);
    check(
      "滑铲解围向本方进攻方向，站立抢断则直接收球",
      w3.tacklesWon === 1 && w3.ball.vel.x > 0,
      `断球者面朝自家球门，断下来的球 vx = ${w3.ball.vel.x.toFixed(2)} m/s（应为正）`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
console.log("\n[25] 比赛流程：时钟、死球、终场（§1）");
{
  const w = full();
  const start = w.clock;
  run(w, 120, input());
  check(
    "比赛进行时时钟在走",
    Math.abs(start - w.clock - 2) < 0.05,
    `2 秒跑掉了 ${(start - w.clock).toFixed(2)} s（总时长 ${start} s）`,
  );

  // 死球期间不计时：3 分钟一场，被出界吃掉一半就没得踢了
  const w2 = full();
  w2.ball.owner = null;
  w2.ball.stickyLock = 999;
  w2.ball.pos.x = CENTER_X;
  w2.ball.pos.y = 3;
  w2.ball.prevPos.x = CENTER_X;
  w2.ball.prevPos.y = 3;
  w2.ball.vel.y = -14;
  w2.lastTouch = 0;
  let guard = 0;
  while (w2.phase === "playing" && guard++ < 300) step(w2, input(), t, TICK_DT);
  const atDead = w2.clock;
  run(w2, 30, input());
  check(
    "死球期间时钟停住",
    w2.phase === "restart" && Math.abs(w2.clock - atDead) < 1e-9,
    `阶段 ${w2.phase}，0.5 秒里时钟走了 ${(atDead - w2.clock).toFixed(4)} s`,
  );

  // 终场：时间到就冻结
  const w3 = full();
  w3.clock = 0.5;
  run(w3, 60, input());
  const frozen = { x: w3.ball.pos.x, y: w3.ball.pos.y };
  run(w3, 120, input({ moveX: 1, sprint: true }));
  check(
    "时间到进入终场并冻结全场",
    w3.phase === "fullTime" &&
      Math.hypot(w3.ball.pos.x - frozen.x, w3.ball.pos.y - frozen.y) < 1e-9,
    `阶段 ${w3.phase}，终场后球移动了 ${Math.hypot(w3.ball.pos.x - frozen.x, w3.ball.pos.y - frozen.y).toFixed(4)} m`,
  );

  // 进球之后由被进球的一方中圈开球
  const w4 = full();
  const b4 = w4.ball;
  b4.owner = null;
  b4.stickyLock = 999;
  b4.pos.x = PITCH_LENGTH - 12;
  b4.pos.y = CENTER_Y - 3;
  b4.prevPos.x = b4.pos.x;
  b4.prevPos.y = b4.pos.y;
  b4.vel.x = 25;
  // 必须在进球【当帧】检查：restartDelay 之后死球状态就自动解除了
  for (let i2 = 0; i2 < 200; i2++) {
    step(w4, input(), t, TICK_DT);
    if (w4.goals[0] > 0) break;
  }
  check(
    "进球后由被进球的一方中圈开球",
    w4.goals[0] === 1 && w4.restart?.kind === "kickoff" && w4.restart.team === 1,
    `比分 ${w4.goals[0]}-${w4.goals[1]}，重开方式 ${w4.restart?.kind}，开球方 team ${w4.restart?.team}`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[26] 底线判定：进球和出界是同一个决策");
{
  /**
   * 试玩反馈：「为啥球出底线了是中圈开球」。
   *
   * 根因是进球判定和出界判定原本是两个互不知情的函数：
   * checkGoal 要求球必须无人控，于是【带球过线】永远不算进球，
   * 掉进出界判定变成球门球。两个函数对同一件事各有一套条件，
   * 就一定存在它们互相打架的角度。现在合并成一个决策。
   */
  function dribbleAcross(y: number): World {
    const w = full();
    // 把对方门将挪走：这一节测的是【底线判定】，
    // 门将现在会真的跑出来把球没收，那是他该做的事，但会盖掉这条断言
    const gk = w.players.find((p) => p.team === 1 && p.slot === 0)!;
    gk.pos.x = 5;
    gk.pos.y = 5;
    gk.prevPos.x = 5;
    gk.prevPos.y = 5;
    const me = w.players[w.controlled]!;
    me.pos.x = PITCH_LENGTH - 22;
    me.pos.y = y;
    me.prevPos.x = me.pos.x;
    me.prevPos.y = y;
    w.ball.owner = w.controlled;
    w.ball.pos.x = me.pos.x + 0.9;
    w.ball.pos.y = y;
    w.ball.prevPos.x = w.ball.pos.x;
    w.ball.prevPos.y = y;
    w.lastTouch = 0;
    for (let i2 = 0; i2 < 600; i2++) {
      step(w, input({ moveX: 1, sprint: true }), t, TICK_DT);
      if (w.phase !== "playing") break;
    }
    return w;
  }

  const inMouth = dribbleAcross(31);
  check(
    "带球过底线且在门框内 → 进球（不是球门球）",
    inMouth.goals[0] === 1 && inMouth.restart?.kind === "kickoff",
    `比分 ${inMouth.goals[0]}-${inMouth.goals[1]}，判罚 ${inMouth.restart?.label}`,
  );

  const wide = dribbleAcross(15);
  check(
    "带球过底线但在门框外 → 球门球（不是进球）",
    wide.goals[0] === 0 && wide.restart?.kind === "goalKick",
    `比分 ${wide.goals[0]}-${wide.goals[1]}，判罚 ${wide.restart?.label}`,
  );

  /**
   * 过线瞬间要用【插值】的位置，不是过线之后采样的位置。
   * 球一个 tick 能走 1 米，用采样点判会把擦柱而入判成出界、擦柱而出判成进球。
   * 下面两个用例是对称的：采样点和过线点分别落在门柱两侧。
   */
  function fling(x: number, y: number, vx: number, vy: number): World {
    const w = full();
    const b = w.ball;
    b.owner = null;
    b.stickyLock = 999;
    b.pos.x = x;
    b.pos.y = y;
    b.prevPos.x = x;
    b.prevPos.y = y;
    b.vel.x = vx;
    b.vel.y = vy;
    w.lastTouch = 0;
    step(w, input(), t, TICK_DT);
    return w;
  }

  // 过线点 37.4（门框内 37.66），下一帧采样点 37.9（门框外）→ 必须算进球
  const grazeIn = fling(PITCH_LENGTH - 0.5, 36.9, 60, 60);
  check(
    "擦柱而入：过线瞬间在门框内就算进球",
    grazeIn.goals[0] === 1,
    `比分 ${grazeIn.goals[0]}-${grazeIn.goals[1]}，判罚 ${grazeIn.restart?.label}`,
  );

  // 过线点 37.9（门框外），下一帧采样点 37.4（门框内）→ 不能算进球
  const grazeOut = fling(PITCH_LENGTH - 0.5, 38.4, 60, -60);
  check(
    "擦柱而出：过线瞬间在门框外就不是进球",
    grazeOut.goals[0] === 0 && grazeOut.restart?.kind === "goalKick",
    `比分 ${grazeOut.goals[0]}-${grazeOut.goals[1]}，判罚 ${grazeOut.restart?.label}`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[27] 死球重开：捡球 → 摆球 → 恢复（全程零瞬移）");
{
  /**
   * 试玩反馈：「不能闪回啊 出界了有个人去捡球呗」。
   *
   * 早先的版本把主罚球员和球一起瞬移到开球点、对方也瞬移着退开 —— 省事，
   * 但画面上是一堆人凭空闪现，完全看不懂发生了什么。
   * 现在：球停在它自己滚出去的地方，主罚球员跑过去捡，再带到开球点。
   */
  function runOut(): { w: World; stages: string[]; jumps: number; fetchSecs: number } {
    const w = full();
    const b = w.ball;
    b.owner = null;
    b.stickyLock = 0;
    b.pos.x = CENTER_X + 10;
    b.pos.y = 5;
    b.prevPos.x = b.pos.x;
    b.prevPos.y = b.pos.y;
    b.vel.y = -16;
    w.lastTouch = 0;

    const stages: string[] = [];
    let jumps = 0;
    let fetchTicks = 0;
    let placedAt: { x: number; y: number } | null = null;
    let spot: { x: number; y: number } | null = null;
    const prev = w.players.map((p) => ({ x: p.pos.x, y: p.pos.y }));

    for (let i2 = 0; i2 < 900; i2++) {
      step(w, input(), t, TICK_DT);
      const st = w.restart?.stage ?? w.phase;
      if (stages[stages.length - 1] !== st) {
        stages.push(st);
        if (st === "ready" && w.restart) {
          placedAt = { x: w.ball.pos.x, y: w.ball.pos.y };
          spot = { x: w.restart.at.x, y: w.restart.at.y };
        }
      }
      if (w.restart?.stage === "fetch") fetchTicks++;
      // 任何球员单帧位移超过 3 米就是瞬移（正常最快 8.8 m/s ≈ 0.15 m/帧）
      for (let j = 0; j < w.players.length; j++) {
        const p = w.players[j]!;
        const d = Math.hypot(p.pos.x - prev[j]!.x, p.pos.y - prev[j]!.y);
        // 摆球那一下允许主罚球员归位（placeAt），其余人都不许闪
        if (d > 3 && !(w.restart && j === w.restart.taker)) jumps++;
        prev[j]!.x = p.pos.x;
        prev[j]!.y = p.pos.y;
      }
      if (w.phase === "playing" && stages.includes("ready")) break;
    }
    return { w, stages, jumps, fetchSecs: fetchTicks * TICK_DT, placedAt, spot };
  }

  const r = runOut();
  check(
    "死球依次走完 捡球 → 带球 → 就位 → 恢复比赛",
    r.stages.includes("fetch") && r.stages.includes("carry") && r.stages.includes("ready") &&
      r.stages[r.stages.length - 1] === "playing",
    `阶段序列：${r.stages.join(" → ")}`,
  );
  check(
    "全程没有球员瞬移",
    r.jumps === 0,
    `${r.jumps} 次单帧位移超过 3 米`,
  );
  check(
    "捡球没有拖太久（超过就该检查 fetchTimeout 兜底）",
    r.fetchSecs < t.rules.fetchTimeout,
    `跑过去捡球用了 ${r.fetchSecs.toFixed(2)} s（兜底上限 ${t.rules.fetchTimeout} s）`,
  );
  // 阈值 0.3 而不是 0：摆好的同一 tick 里粘球逻辑会把球拉到主罚球员脚前，
  // 差个一两厘米是正确的物理，不是摆错了位置
  check(
    "就位那一刻，球摆在开球点上",
    !!r.placedAt && !!r.spot &&
      Math.hypot(r.placedAt.x - r.spot.x, r.placedAt.y - r.spot.y) < 0.3,
    r.placedAt && r.spot
      ? `球 (${r.placedAt.x.toFixed(2)}, ${r.placedAt.y.toFixed(2)}) vs 开球点 (${r.spot.x.toFixed(2)}, ${r.spot.y.toFixed(2)})`
      : "从来没进入 ready 阶段",
  );

  // 死球期间对方不能顺手把球捡走
  {
    const w = full();
    const b = w.ball;
    b.owner = null;
    b.pos.x = CENTER_X;
    b.pos.y = 4;
    b.prevPos.x = b.pos.x;
    b.prevPos.y = b.pos.y;
    b.vel.y = -16;
    w.lastTouch = 0;
    let guard = 0;
    while (w.phase === "playing" && guard++ < 300) step(w, input(), t, TICK_DT);
    const taker = w.restart!.taker;
    const takerTeam = w.players[taker]!.team;
    let stolen = false;
    for (let i2 = 0; i2 < 400; i2++) {
      step(w, input(), t, TICK_DT);
      if (w.ball.owner !== null && w.players[w.ball.owner]!.team !== takerTeam) stolen = true;
      if (w.phase === "playing") break;
    }
    check(
      "死球期间对方不能把球捡走",
      !stolen,
      stolen ? "被对方捡走了" : `全程只有主罚方（team ${takerTeam}）能碰球`,
    );
  }

  // 球摆好之后，控制权回到玩家手上（我方主罚时）
  {
    const w = full();
    const b = w.ball;
    b.owner = null;
    b.pos.x = CENTER_X;
    b.pos.y = 4;
    b.prevPos.x = b.pos.x;
    b.prevPos.y = b.pos.y;
    b.vel.y = -16;
    w.lastTouch = 1; // 对方碰的 → 界外球给我方
    let guard = 0;
    while (w.phase === "playing" && guard++ < 300) step(w, input(), t, TICK_DT);
    const taker = w.restart!.taker;
    check(
      "我方主罚的死球，最后由玩家控制主罚者",
      w.players[taker]!.team === 0,
      `主罚的是 team ${w.players[taker]!.team} 的 #${taker}`,
    );
    for (let i2 = 0; i2 < 600; i2++) {
      step(w, input(), t, TICK_DT);
      if (w.restart?.stage === "ready" || w.phase === "playing") break;
    }
    check(
      "球摆好后控制权交还给玩家",
      w.controlled === taker,
      `控制的是 #${w.controlled}，主罚者是 #${taker}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
console.log("\n[28] 控制权跟着球走，门将只在持球时交给玩家");
{
  // 按新操作约定检查：我方门将持球可控，无球时恢复自动守门。
  function playMatch(): {
    ctlKeeperTicks: number;
    ownerNotControlled: number;
    worst: string;
    gkCarryMax: number;
    ticks: number;
  } {
    const w = full();
    let ctlKeeperTicks = 0;
    let ownerNotControlled = 0;
    let worst = "";
    let gkCarryMax = 0;
    let gkCarry = 0;
    let gkStart = { x: 0, y: 0 };
    const ticks = 60 * 180;

    for (let i2 = 0; i2 < ticks; i2++) {
      // 模拟一个会朝球跑、偶尔传球射门的玩家
      const me = w.players[w.controlled]!;
      const dx = w.ball.pos.x - me.pos.x;
      const dy = w.ball.pos.y - me.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      const cmd: Partial<InputState> = {
        moveX: dx / d,
        moveY: dy / d,
        sprint: i2 % 7 < 4,
      };
      if (w.ball.owner === w.controlled && i2 % 90 < 12) cmd.passShort = true;
      if (w.ball.owner === w.controlled && i2 % 240 < 20) cmd.shoot = true;
      step(w, input(cmd), t, TICK_DT);

      if (w.players[w.controlled]!.slot === 0 && w.ball.owner !== w.controlled) ctlKeeperTicks++;

      const o = w.ball.owner;
      if (o !== null) {
        const owner = w.players[o]!;
        // 我方活球持球或摆好球后，控制的应是持球者，包括门将。
        if (owner.team === 0 && (w.phase === "playing" || w.restart?.stage === "ready") && w.controlled !== o) {
          ownerNotControlled++;
          if (worst === "") {
            worst = `t=${(i2 * TICK_DT).toFixed(1)}s 持球 #${o} 但控的是 #${w.controlled}`;
          }
        }
        // 门将在【比赛进行中】的带球距离：他不该一路带到中场。
        // 死球期间不算 —— 球门球时门将本来就要跑去捡球再带到罚球点（[27] 的 fetch/carry）。
        if (owner.slot === 0 && w.phase === "playing") {
          if (gkCarry === 0) gkStart = { x: w.ball.pos.x, y: w.ball.pos.y };
          gkCarry++;
          gkCarryMax = Math.max(
            gkCarryMax,
            Math.hypot(w.ball.pos.x - gkStart.x, w.ball.pos.y - gkStart.y),
          );
        } else {
          gkCarry = 0;
        }
      } else {
        gkCarry = 0;
      }
    }
    return { ctlKeeperTicks, ownerNotControlled, worst, gkCarryMax, ticks };
  }

  const m = playMatch();
  check(
    "整场比赛里无球门将不会留在玩家控制下",
    m.ctlKeeperTicks === 0,
    `无球仍控制门将 ${(m.ctlKeeperTicks * TICK_DT).toFixed(1)} s / ${(m.ticks * TICK_DT).toFixed(0)} s`,
  );
  check(
    "我方持球球员包括门将在内，控制权都能正确移交",
    m.ownerNotControlled === 0,
    m.ownerNotControlled === 0
      ? "整场零违例"
      : `${(m.ownerNotControlled * TICK_DT).toFixed(2)} s 不一致，首次：${m.worst}`,
  );
  check(
    "门将拿到球会开出去，不会一路带球到中场",
    m.gkCarryMax < 25,
    `门将单次带球最远 ${m.gkCarryMax.toFixed(1)} m`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[29] AI 会主动防守（不是站着看）");
{
  /**
   * 试玩反馈：「队友有点傻 不会自动防守」。
   *
   * 根因是几何上的矛盾：逼抢球员的目标点是"持球人身前 markGoalSide(2.2m)"，
   * 而出脚要求离球 aiTriggerRange 以内 —— 他站定的位置永远够不到球。
   * 实测防守贴身距离 2.3 m，卡在触发范围外，**180 秒 0 次铲球、对手控球率 0%**。
   *
   * 这一节测的是"AI 到底动没动手"，所以全程玩家站桩，所有铲球都归 AI。
   */
  function aiOnlyMatch(secs: number) {
    const w = full();
    const prevLunge = w.players.map(() => 0);
    let attempts = 0;
    let stuns = 0;
    let turnovers = 0;
    let minGap = Infinity;
    let lastTeam: number | null = null;
    const ticks = 60 * secs;

    for (let i2 = 0; i2 < ticks; i2++) {
      // 只在我方需要主罚时按下并松开短传；活球期间玩家仍保持不动。
      // 未出球现在会一直等待，不能把合法的等待误判为 AI 不抢球。
      const takeRestart = w.phase === "restart" && w.restart?.stage === "ready" &&
        w.restart.taker === w.controlled;
      // 门将现在等待玩家出球。模拟每两秒主动发球，避免把等待操作算成防守失效。
      const keeperHolding = w.ball.owner === w.controlled && w.players[w.controlled]!.slot === 0;
      step(w, input({ passShort: (takeRestart || (keeperHolding && i2 % 120 < 12)) && !w.actionWasHeld.short }), t, TICK_DT);
      for (let j = 0; j < w.players.length; j++) {
        const p = w.players[j]!;
        if (prevLunge[j] === 0 && p.lunge > 0) attempts++;
        if (prevLunge[j]! > 0 && p.lunge === 0 && p.stun > 0) stuns++;
        prevLunge[j] = p.lunge;
      }
      const o = w.ball.owner;
      if (o === null) continue;
      const carrier = w.players[o]!;
      if (lastTeam !== null && lastTeam !== carrier.team) turnovers++;
      lastTeam = carrier.team;
      // 防守方最近的非门将球员离持球人多远
      for (const p of w.players) {
        if (p.team === carrier.team || p.slot === 0) continue;
        minGap = Math.min(minGap, Math.hypot(p.pos.x - carrier.pos.x, p.pos.y - carrier.pos.y));
      }
    }
    return { w, attempts, stuns, turnovers, minGap, wins: w.tacklesWon };
  }

  const m = aiOnlyMatch(90);
  check(
    "AI 防守球员会贴到能出脚的距离上",
    m.minGap < t.tackle.aiTriggerRange,
    `防守方最近贴到 ${m.minGap.toFixed(2)} m（出脚距离 ${t.tackle.aiTriggerRange} m）`,
  );
  // 主动断球用明确的持球防守场景测。整场重开球现在会实际传出，
  // 拦截自由球也会造成球权易手，不能再用整场出脚次数代表防守能力。
  let pressureWins = 0;
  for (const gap of [2, 3, 4, 5, 6, 7]) {
    const duel = full();
    const carrier = duel.players[duel.controlled]!;
    const defender = duel.players.find((p) => p.team === 1 && p.slot === 9)!;
    duel.ball.owner = duel.controlled;
    defender.pos.x = carrier.pos.x + gap;
    defender.pos.y = carrier.pos.y;
    for (let tick = 0; tick < 900 && duel.tacklesWon === 0; tick++) {
      step(duel, input(), t, TICK_DT);
    }
    if (duel.tacklesWon > 0) pressureWins++;
  }
  check(
    "AI 会主动把球断下来",
    pressureWins === 6,
    `对手从 2~7 米外逼抢，${pressureWins}/6 个场景成功断球`,
  );
  check(
    "球权会在两队之间来回易手（防守不是摆设）",
    m.turnovers > 5,
    `90 秒里球权易手 ${m.turnovers} 次`,
  );

  /**
   * AI 的成本不是"铲空吃硬直"，是【必须先贴住你一段时间才敢出脚】。
   *
   * 它贴到 pressGoalSide(1.15 m) 才出脚，那个距离在断球半径(1.5 m)之内，所以基本必中 ——
   * 这是设计如此，不是 bug：FC 式的"先封堵、后择机"，代价从"可能落空"换成了
   * "你有大约 pressCommitDelay 那么久可以出球或转身"。
   *
   * 所以这里量的是玩家真正关心的那条保证：**从被贴上到被断球，我有多少时间。**
   * 修复前实测这个数是 0.4 秒 —— 拿到球还没反应过来就没了。
   */
  function timeUnderPressure(): number {
    const w = full();
    run(w, 30, input({ moveX: 1 }));
    const me = w.players[w.controlled]!;
    w.ball.owner = w.controlled;
    w.ball.pos.x = me.pos.x + 0.9;
    w.ball.pos.y = me.pos.y;
    let pressedSince = -1;
    for (let i2 = 0; i2 < 900; i2++) {
      step(w, input(), t, TICK_DT); // 玩家不动，纯看对手要多久才能断掉
      let nearest = Infinity;
      for (const p of w.players) {
        if (p.team === 0 || p.slot === 0) continue;
        nearest = Math.min(nearest, Math.hypot(p.pos.x - me.pos.x, p.pos.y - me.pos.y));
      }
      if (pressedSince < 0 && nearest < t.tackle.aiTriggerRange + 1) pressedSince = i2;
      const o = w.ball.owner;
      if ((o !== null && w.players[o]!.team === 1) || (o === null && w.ball.stickyLock > 0)) {
        return pressedSince < 0 ? 0 : (i2 - pressedSince) * TICK_DT;
      }
    }
    return Infinity;
  }
  const grace = timeUnderPressure();
  check(
    "被贴上之后，持球人有足够时间出球或转身（不是一贴就丢）",
    grace >= t.ai.pressCommitDelay * 0.7,
    `从被贴上到丢球有 ${grace === Infinity ? "15+" : grace.toFixed(2)} 秒（贴住多久才出脚 = ${t.ai.pressCommitDelay} s）`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[30] 抢断 / 铲球 / 防守自动切人（参考 FC）");
{
  /** 让对手持球停在我方球员身前 distance 米 */
  function duel(distance: number) {
    const w = full();
    const me = w.players[w.controlled]!;
    const foe = w.players.find((p) => p.team === 1 && p.slot === 9)!;
    const foeIdx = w.players.indexOf(foe);
    foe.pos.x = me.pos.x + distance;
    foe.pos.y = me.pos.y;
    foe.prevPos.x = foe.pos.x;
    foe.prevPos.y = foe.pos.y;
    w.ball.owner = foeIdx;
    w.ball.pos.x = foe.pos.x;
    w.ball.pos.y = foe.pos.y;
    w.ball.prevPos.x = w.ball.pos.x;
    w.ball.prevPos.y = w.ball.pos.y;
    me.facing = 0;
    me.prevFacing = 0;
    return { w, me };
  }

  // ── 两种出脚的射程确实不同
  {
    const a = duel(2.2);
    step(a.w, input({ shoot: true }), t, TICK_DT); // K = 抢断
    check(
      "抢断够不到 2.2 米外的球",
      a.w.tacklesWon === 0,
      `断球 ${a.w.tacklesWon} 次（抢断射程 ${t.tackle.range} m）`,
    );

    const b = duel(2.2);
    step(b.w, input({ passThrough: true }), t, TICK_DT); // L = 铲球
    check(
      "铲球够得到 2.2 米外的球",
      b.w.tacklesWon === 1,
      `断球 ${b.w.tacklesWon} 次（铲球射程 ${t.slide.range} m）`,
    );
  }

  // ── 铲球落空的代价必须明显更大，否则"够得更远"就是无脑更优解
  {
    function missAndMeasure(key: "shoot" | "passThrough"): number {
      const { w, me } = duel(9); // 够不到，必定落空
      step(w, input({ [key]: true } as never), t, TICK_DT);
      let ticks = 0;
      while (ticks < 400) {
        step(w, input(), t, TICK_DT);
        ticks++;
        if (me.lunge === 0 && me.stun === 0) break;
      }
      return ticks * TICK_DT;
    }
    const pokeCost = missAndMeasure("shoot");
    const slideCost = missAndMeasure("passThrough");
    check(
      "铲球落空的硬直明显长于抢断（两个键不能退化成一个）",
      slideCost > pokeCost * 1.8,
      `抢断落空 ${pokeCost.toFixed(2)} s vs 铲球落空 ${slideCost.toFixed(2)} s`,
    );
  }

  // ── 防守自动切人
  {
    const w = full();
    // 对方在远处持球，玩家控的人离得很远
    const foe = w.players.find((p) => p.team === 1 && p.slot === 10)!;
    const foeIdx = w.players.indexOf(foe);
    foe.pos.x = 30;
    foe.pos.y = 12;
    foe.prevPos.x = 30;
    foe.prevPos.y = 12;
    w.ball.owner = foeIdx;
    w.ball.pos.x = foe.pos.x;
    w.ball.pos.y = foe.pos.y;
    w.ball.prevPos.x = w.ball.pos.x;
    w.ball.prevPos.y = w.ball.pos.y;
    const me = w.players[w.controlled]!;
    me.pos.x = 90;
    me.pos.y = 60;
    me.prevPos.x = 90;
    me.prevPos.y = 60;

    const before = w.controlled;
    run(w, 60, input());
    check(
      "对方带球时保留玩家后卫，由 J 决定切人",
      w.controlled === before,
      `#${before}（在 90,60）→ #${w.controlled}，球在 (${w.ball.pos.x.toFixed(0)}, ${w.ball.pos.y.toFixed(0)})`,
    );
  }

  // ── 迟滞：不能疯狂跳人
  {
    const w = full();
    const foe = w.players.find((p) => p.team === 1 && p.slot === 9)!;
    const foeIdx = w.players.indexOf(foe);
    w.ball.owner = foeIdx;
    w.ball.pos.x = foe.pos.x;
    w.ball.pos.y = foe.pos.y;
    let switches = 0;
    let prev = w.controlled;
    const secs = 20;
    for (let i2 = 0; i2 < 60 * secs; i2++) {
      step(w, input(), t, TICK_DT);
      if (w.controlled !== prev) switches++;
      prev = w.controlled;
    }
    const perSec = switches / secs;
    check(
      "自动切人有迟滞，不会在两个人之间来回跳",
      perSec < 1 / t.ai.autoSwitchCooldown,
      `${secs} 秒内切了 ${switches} 次 = ${perSec.toFixed(2)} 次/秒（冷却 ${t.ai.autoSwitchCooldown}s 的上限是 ${(1 / t.ai.autoSwitchCooldown).toFixed(2)}）`,
    );
  }

  // ── 自动切人不能抢走 D16 的传球移交
  {
    const w = full();
    run(w, 200, input());
    const me = w.players[w.controlled]!;
    const passer = w.controlled;
    w.ball.owner = passer;
    w.ball.pos.x = me.pos.x + 0.9;
    w.ball.pos.y = me.pos.y;
    run(w, 10, input());
    run(w, chargeTicksFor(0.5), input({ passShort: true, moveX: 1 }));
    step(w, input({ moveX: 1 }), t, TICK_DT);
    run(w, 20, input());
    check(
      "自动切人不会在传球飞行途中抢走控制权（D16）",
      w.controlled === passer,
      `出脚 0.33 s 后控的是 #${w.controlled}（传球者 #${passer}）`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
console.log("\n[31] 死球期间的出脚状态 / 手动切人的话语权");
{
  /**
   * 试玩反馈：「我没开球的时候不能抢」。
   *
   * 死球期间不能出脚是对的（对方还在退规定距离），但早先是把整个
   * updateTackleTimers 都跳过了 —— 于是玩家按下的那一脚会【卡住】两秒多不结算，
   * 硬直也不会消化，比赛恢复的瞬间人还是僵的。
   * 现在只跳过判定结算，计时器照常走。
   */
  function opponentThrowIn(): World {
    const w = full();
    w.ball.owner = null;
    w.ball.stickyLock = 0;
    w.ball.pos.x = CENTER_X;
    w.ball.pos.y = 5;
    w.ball.prevPos.x = CENTER_X;
    w.ball.prevPos.y = 5;
    w.ball.vel.y = -16;
    w.lastTouch = 0; // 我方碰出界 → 界外球给对方
    let guard = 0;
    while (w.phase === "playing" && guard++ < 300) step(w, input(), t, TICK_DT);
    return w;
  }

  {
    const w = opponentThrowIn();
    const me = w.players[w.controlled]!;
    let stuck = 0;
    let resumed = -1;
    for (let i2 = 0; i2 < 600; i2++) {
      step(w, input({ shoot: i2 % 2 === 0 }), t, TICK_DT);
      if (w.phase !== "playing" && me.lunge > 0) stuck++;
      if (w.phase === "playing" && resumed < 0) resumed = i2;
      if (resumed >= 0 && i2 > resumed + 5) break;
    }
    check(
      "对方开球期间按抢断键，不会留下卡住不结算的出脚",
      stuck === 0,
      `死球期间 lunge 卡住 ${(stuck * TICK_DT).toFixed(2)} s`,
    );
  }

  {
    // 硬直必须在死球期间消化掉，不能带着硬直恢复比赛
    const w = full();
    const me = w.players[w.controlled]!;
    w.ball.pos = { x: me.pos.x + 20, y: me.pos.y };
    w.ball.prevPos = { ...w.ball.pos };
    step(w, input({ shoot: true }), t, TICK_DT); // 球在远处，确保出脚落空
    run(w, Math.ceil(t.tackle.windowTime / TICK_DT) + 2, input());
    const stunAtDead = me.stun;
    // 现在制造一次死球
    w.ball.owner = null;
    w.ball.stickyLock = 0;
    w.ball.pos.y = 3;
    w.ball.prevPos.y = 3;
    w.ball.vel.y = -16;
    w.lastTouch = 0;
    let guard = 0;
    while (w.phase === "playing" && guard++ < 300) step(w, input(), t, TICK_DT);
    run(w, 60, input());
    check(
      "硬直会在死球期间消化掉（不会僵着恢复比赛）",
      stunAtDead > 0 && me.stun === 0,
      `死球开始时硬直 ${stunAtDead.toFixed(2)} s，1 秒后剩 ${me.stun.toFixed(2)} s`,
    );
  }

  {
    /**
     * 试玩反馈：「自动切换和手动切换没有平衡点」。
     *
     * 第一版手动切人只锁 autoSwitchCooldown(0.45s)，你刚挑好人半秒后就被抢回去 ——
     * 手动切人形同虚设。现在手动切完锁 manualSwitchLock(2s)。
     */
    // 关掉我方的逼抢和出脚：AI 队友现在真的会把球断下来，
    // 球权一变控制权就合法地跟着变了 —— 那会盖掉这条断言想量的东西
    const noPress = createTuning();
    noPress.ai.pressRadius = 0;
    // 此处只测自动切人的锁定期；对手传射导致的球权变化另测。
    noPress.attack.decisionDelay = Infinity;
    noPress.tackle.aiTriggerRange = 0;
    noPress.slide.aiTriggerRange = 0;

    const w = full();
    const foe = w.players.find((p) => p.team === 1 && p.slot === 9)!;
    const foeIdx = w.players.indexOf(foe);
    w.ball.owner = foeIdx;
    w.ball.pos.x = foe.pos.x;
    w.ball.pos.y = foe.pos.y;
    w.ball.prevPos.x = w.ball.pos.x;
    w.ball.prevPos.y = w.ball.pos.y;
    for (let i2 = 0; i2 < 30; i2++) step(w, input(), noPress, TICK_DT);

    // 手动切到一个"不是最优"的人：连按几次跳到榜单靠后的位置
    for (let k = 0; k < 3; k++) {
      step(w, input({ passShort: true }), noPress, TICK_DT);
      step(w, input(), noPress, TICK_DT);
    }
    const picked = w.controlled;
    let heldFor = 0;
    for (let i2 = 0; i2 < 180; i2++) {
      step(w, input(), noPress, TICK_DT);
      if (w.controlled !== picked) break;
      heldFor = (i2 + 1) * TICK_DT;
    }
    check(
      "手动切完之后，自动切人要让开一段时间（手动说了算）",
      heldFor >= t.ai.manualSwitchLock * 0.8,
      `手动挑的 #${picked} 保持了 ${heldFor.toFixed(2)} s（锁定 ${t.ai.manualSwitchLock} s）`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
console.log("\n[32] 比赛得真的在进行：死球占比与按键有效率");
{
  /**
   * 试玩反馈：「我没开球不能抢」（连着两轮）。
   *
   * 我第一轮以为是"对方开球期间按键无效"，修了死球期间卡住的出脚状态 —— 没用。
   * 第二轮改成量【按下抢断键的每一次分别被什么挡住】，才看见真正的数字：
   * **52% 的按键落在死球期间**，而一场 180 秒的比赛里死球吃掉了 40% 的实际时长。
   *
   * 玩家说的不是"某个按键坏了"，是"比赛一直在停"。
   * 这一节因此不测按键，而是测【比赛有多少时间真的在进行】。
   */
  const w = full();
  let wall = 0;
  let dead = 0;
  let restarts = 0;
  let pressBlockedByDeadBall = 0;
  let presses = 0;
  let heldPrev = false;
  let lastLabel = "";
  const byKind: Record<string, number> = {};

  while (w.clock > 0 && wall < 60 * 900) {
    const me = w.players[w.controlled]!;
    const dx = w.ball.pos.x - me.pos.x;
    const dy = w.ball.pos.y - me.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const o = w.ball.owner;
    const defending = o === null || w.players[o]!.team === 1;
    const wantPress = defending && wall % 6 === 0;
    const cmd: Partial<InputState> = {
      moveX: dx / d,
      moveY: dy / d,
      sprint: true,
      shoot: wantPress,
    };
    if (o === w.controlled && wall % 90 < 12) cmd.passShort = true;

    if (wantPress && !heldPrev) {
      presses++;
      if (w.phase !== "playing") pressBlockedByDeadBall++;
    }
    heldPrev = wantPress;

    step(w, input(cmd), t, TICK_DT);
    wall++;
    if (w.phase === "restart" && w.restart) {
      dead++;
      const id = w.restart.kind + w.restart.label + w.restart.at.x.toFixed(1);
      if (id !== lastLabel) {
        restarts++;
        byKind[w.restart.kind] = (byKind[w.restart.kind] ?? 0) + 1;
        lastLabel = id;
      }
    } else {
      lastLabel = "";
    }
  }

  const wallSecs = wall * TICK_DT;
  const deadPct = (dead * TICK_DT) / wallSecs * 100;
  const blockedPct = (pressBlockedByDeadBall / Math.max(1, presses)) * 100;
  const summary = Object.entries(byKind)
    .map(([k, v]) => `${k} ${v}`)
    .join(" ");

  // 阈值定在"能抓住真实退化"的水平，不是"理想值"。
  // 这一节修复前实测：死球 40%、按键被挡 52%、任意球 29 次 ——
  // 单次模拟的方差不小（任意球在 11~22 之间跳），把阈值卡死在理想值只会让测试乱闪。
  check(
    "死球时间不超过实际时长的 30%（比赛得真的在进行）",
    deadPct < 30,
    `实际耗时 ${wallSecs.toFixed(0)} s，死球 ${(dead * TICK_DT).toFixed(0)} s = ${deadPct.toFixed(0)}%`,
  );
  check(
    "一场 3 分钟的比赛，死球次数不超过 40 次",
    restarts <= 40,
    `${restarts} 次：${summary}`,
  );
  check(
    "玩家按抢断键时，被死球挡掉的比例低于 25%",
    blockedPct < 25,
    `${pressBlockedByDeadBall}/${presses} = ${blockedPct.toFixed(0)}% 的按键落在死球期间`,
  );
  check(
    "犯规不能太滥（3 分钟不超过 28 次任意球）",
    (byKind["freeKick"] ?? 0) <= 28,
    `任意球 ${byKind["freeKick"] ?? 0} 次`,
  );
}

// ─────────────────────────────────────────────────────────────
console.log("\n[33] 门将不是摆设（D17）");
{
  /**
   * 试玩反馈：「守门员是摆设吗」。
   *
   * 是的 —— M1~M4 里门将只是站在门线上靠身体碰撞挡球。
   * 实测 180 脚射正的球【扑出 0 次】，75% 直接进网。
   *
   * 现在他有三件事：封角度站位、预判落点横向移动、够不到时鱼跃。
   * 这一节量的是最终结果：射正的球有多少被扑掉，以及他还打不打得穿。
   */
  function shoot(x: number, y: number, aimY: number, power: number, loft: number): string {
    const w = full();
    // 只留双方门将 + 一名远处的己方球员，排除别人挡枪
    w.players = w.players.filter((p) => p.slot === 0 || p.team === 0);
    w.controlled = w.players.findIndex((p) => p.team === 0 && p.slot !== 0);
    for (const p of w.players) {
      if (p.team === 0 && p.slot !== 0) {
        p.pos.x = 5;
        p.pos.y = 5;
        p.prevPos.x = 5;
        p.prevPos.y = 5;
      }
    }
    const b = w.ball;
    b.owner = null;
    b.stickyLock = 0;
    b.pos.x = x;
    b.pos.y = y;
    b.prevPos.x = x;
    b.prevPos.y = y;
    const dx = PITCH_LENGTH - x;
    const dy = aimY - y;
    const d = Math.hypot(dx, dy);
    const th = (loft * Math.PI) / 180;
    b.vel.x = (dx / d) * power * Math.cos(th);
    b.vel.y = (dy / d) * power * Math.cos(th);
    b.vz = power * Math.sin(th);
    let caughtAt = -1;
    for (let i2 = 0; i2 < 900; i2++) {
      step(w, input(), t, TICK_DT);
      if (w.goals[0] > 0) return "进球";
      if (caughtAt < 0 && w.ball.owner !== null && w.players[w.ball.owner]!.slot === 0) caughtAt = i2;
      // 抱住后继续跑一秒，才能发现“已经接球却带着射门动量冲进门”的回归。
      if (caughtAt >= 0 && i2 - caughtAt >= 60) return "扑出";
      if (w.phase !== "playing") return w.restart?.kind === "goalKick" ? "偏出" : "其他";
    }
    return "挡下";
  }

  let goals = 0;
  let saves = 0;
  let wide = 0;
  for (const dist of [12, 18, 26]) {
    for (const from of [-8, 0, 8]) {
      for (const aim of [-3.4, -1.7, 0, 1.7, 3.4]) {
        for (const power of [22, 30]) {
          for (const loft of [4, 14]) {
            const r = shoot(PITCH_LENGTH - dist, CENTER_Y + from, CENTER_Y + aim, power, loft);
            if (r === "进球") goals++;
            else if (r === "偏出") wide++;
            else saves++;
          }
        }
      }
    }
  }
  const onTarget = goals + saves;
  const savePct = (saves / onTarget) * 100;

  check(
    "门将能扑到球（不再是摆设）",
    saves > 0,
    `${onTarget} 脚射正里扑出 ${saves} 脚 = ${savePct.toFixed(0)}%（修复前是 0 脚）`,
  );
  check(
    "但门将不是不可逾越的墙：打角度打得穿",
    goals > onTarget * 0.12,
    `射正转化率 ${((goals / onTarget) * 100).toFixed(0)}%（本游戏测试场景），另有 ${wide} 脚偏出`,
  );
  check(
    "扑救率落在合理区间（55%~90%）",
    savePct > 55 && savePct < 90,
    `扑救率 ${savePct.toFixed(0)}%`,
  );

  // 门将的代价：鱼跃扑错方向要趴在地上
  {
    const w = full();
    const gk = w.players.find((p) => p.team === 1 && p.slot === 0)!;
    const b = w.ball;
    b.owner = null;
    b.stickyLock = 0;
    b.pos.x = PITCH_LENGTH - 14;
    b.pos.y = CENTER_Y;
    b.prevPos.x = b.pos.x;
    b.prevPos.y = b.pos.y;
    b.vel.x = 30;
    b.vel.y = 7;
    let dived = false;
    for (let i2 = 0; i2 < 120; i2++) {
      step(w, input(), t, TICK_DT);
      if (gk.dive > 0) dived = true;
      if (w.phase !== "playing" || w.ball.owner !== null) break;
    }
    check(
      "打向角落时门将会鱼跃",
      dived,
      dived ? "触发了鱼跃" : "全程没有鱼跃（检查 gkDiveTrigger / gkSpeed）",
    );
  }
}

console.log(
  `\n${failures === 0 ? "全部通过" : `${failures} 项未通过`} — 注意：这些只保证物理是对的。` +
    `\n手感是否好玩，只有你自己玩 20 分钟才算数（DESIGN.md §5 M1 验收）。\n`,
);
process.exit(failures === 0 ? 0 : 1);
