import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import { emptyInput, type World } from "../src/sim/types.ts";
import { createTuning } from "../src/tuning.ts";
import { TICK_DT } from "../src/sim/constants.ts";
import { firePass } from "../src/sim/pass.ts";
import { updateBall } from "../src/sim/ball.ts";

const t = createTuning();
function place(w: World, i: number, x: number, y: number): void {
  const p = w.players[i]!;
  p.pos = { x, y }; p.prevPos = { x, y }; p.vel = { x: 0, y: 0 };
}
function live(): World {
  const w = createWorld();
  w.phase = "playing"; w.restart = null; w.ball.owner = null;
  return w;
}
function own(w: World, i: number): void {
  const p = w.players[i]!;
  w.ball.owner = i;
  w.ball.pos = { x: p.pos.x + (p.team === 0 ? 0.9 : -0.9), y: p.pos.y };
  w.ball.prevPos = { ...w.ball.pos };
  w.ball.vel = { ...p.vel };
}

test("真实 AI 先带球再射门，门将能够扑住一部分角度球", () => {
  let saves = 0, shots = 0, dives = 0;
  for (const x of [16, 20, 24]) for (const y of [30, 34, 38]) {
    const w = live();
    w.players = [w.players[0]!, w.players[6]!, w.players[20]!, w.players[11]!];
    w.controlled = 1;
    place(w, 0, 1.6, 34); place(w, 1, 95, 60);
    place(w, 2, x, y); place(w, 3, 103.4, 34);
    own(w, 2);
    let shot = false, dived = false, caughtAt = -1;
    for (let tick = 0; tick < 600; tick++) {
      step(w, emptyInput(), t, TICK_DT);
      if (w.matchStats[1].shots > 0) shot = true;
      if (w.players[0]!.dive > 0) dived = true;
      if (shot && w.ball.owner === 0 && caughtAt < 0) caughtAt = tick;
      if (caughtAt >= 0 && tick - caughtAt >= 60 && w.goals[1] === 0) { saves++; break; }
      if (w.goals[1] > 0 || w.phase !== "playing") break;
    }
    if (shot) shots++;
    if (dived) dives++;
  }
  console.log({ scenario: "AI 实际射门", shots, saves, dives });
  assert.ok(shots >= 6);
  assert.ok(saves >= 3, "不能让真实对抗里的每一脚射门都进");

});

test("已选中空位队友后，短传的轻点和蓄力都能把球送到接球区域", () => {
  const result = [];
  for (const distance of [12, 18, 24]) for (const ratio of [0, 0.5, 1]) {
    const w = live();
    w.players = [w.players[6]!, w.players[9]!];
    w.controlled = 0;
    place(w, 0, 35, 34); place(w, 1, 35 + distance, 34);
    own(w, 0);
    // 先走真实选人/出球，再单独推进球物理，排除接球人回跑掩盖射程误差。
    firePass(w, emptyInput(), "short", t, ratio);
    assert.equal(w.receiver, 1);
    let closest = Infinity;
    for (let tick = 0; tick < 360; tick++) {
      updateBall(w.ball, t, TICK_DT);
      closest = Math.min(closest, Math.hypot(w.ball.pos.x - w.players[1]!.pos.x, w.ball.pos.y - w.players[1]!.pos.y));
    }
    result.push({ distance, ratio, closest: Number(closest.toFixed(2)) });
  }
  console.log({ scenario: "短传落点", result });
  assert.ok(result.every((r) => r.closest < 0.4), "选中了队友就应当传到附近，而不是要求队友替力度误差兜底");
});

test("玩家从正侧面追到合理出脚距离，站立抢断能把球留给自己", () => {
  let won = 0;
  for (const gap of [1.2, 1.5, 1.8]) {
    const w = live();
    w.players = [w.players[6]!, w.players[20]!];
    w.controlled = 0;
    place(w, 0, 50, 34 + gap); place(w, 1, 50, 34);
    w.players[0]!.facing = -Math.PI / 2;
    w.players[1]!.facing = Math.PI;
    own(w, 1);
    step(w, { ...emptyInput(), shoot: true, moveY: -1 }, t, TICK_DT);
    for (let tick = 0; tick < 45; tick++) {
      const me = w.players[w.controlled]!;
      const dx = w.ball.pos.x - me.pos.x, dy = w.ball.pos.y - me.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      step(w, { ...emptyInput(), moveX: dx / d, moveY: dy / d }, t, TICK_DT);
      if (w.ball.owner === 0) { won++; break; }
    }
  }
  console.log({ scenario: "贴身抢断后拿到球", won, attempts: 3 });
  assert.ok(won >= 2, "有效出脚后应有机会控制足球，不能总被持球人立即拿回");
});

test("玩家逼近持球人时，另一名队友上前协防，第三人补位", () => {
  const w = live();
  for (let i = 0; i < w.players.length; i++) place(w, i, w.players[i]!.team === 0 ? 12 : 85, 5 + i * 2);
  place(w, w.controlled, 45, 34);
  place(w, 20, 47, 34); own(w, 20);
  place(w, 5, 43, 39); place(w, 3, 37, 30);
  // 用真实持球队员，但延后传射，单独观察队友如何协防这个持球威胁。
  const tuning = createTuning(); tuning.attack.decisionDelay = 20;
  let assistDistance = Infinity, coverGoalSide = false;
  for (let tick = 0; tick < 120; tick++) {
    const me = w.players[w.controlled]!;
    const dx = w.ball.pos.x - me.pos.x, dy = w.ball.pos.y - me.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    step(w, { ...emptyInput(), moveX: dx / d, moveY: dy / d }, tuning, TICK_DT);
    assistDistance = Math.min(assistDistance, Math.hypot(w.players[5]!.pos.x - w.ball.pos.x, w.players[5]!.pos.y - w.ball.pos.y));
    const cover = w.players[3]!;
    if (cover.pos.x < w.ball.pos.x && Math.hypot(cover.pos.x - w.ball.pos.x, cover.pos.y - w.ball.pos.y) < 8) coverGoalSide = true;
  }
  console.log({ scenario: "协防", assistDistance, coverGoalSide, tackles: w.matchStats[0].tackles });
  assert.ok(assistDistance < 2.5 && coverGoalSide, "协防队友要真正形成第二道压力，后方有人保护球门");
});

test("门将面对远角球会实际横移鱼跃，接球后完成落地并恢复", () => {
  const w = live();
  w.players = [w.players[0]!, w.players[6]!]; w.controlled = 1;
  place(w, 0, 1.6, 34); place(w, 1, 90, 60);
  w.ball.pos = { x: 18, y: 34 }; w.ball.prevPos = { ...w.ball.pos };
  w.ball.vel = { x: -27, y: 5 }; w.lastTouch = 1;
  let dived = false, caught = false;
  for (let tick = 0; tick < 180; tick++) {
    step(w, emptyInput(), t, TICK_DT);
    dived ||= w.players[0]!.dive > 0;
    caught ||= w.ball.owner === 0;
  }
  assert.ok(dived, "跑不及的远角球必须触发鱼跃");
  assert.ok(caught && w.goals[1] === 0, "伸手够到之后必须真的保住球");
  assert.equal(w.players[0]!.dive, 0, "抱住球也必须走完落地动作");
  assert.equal(w.players[0]!.stun, 0);
});

test("近处队友铲球倒地后，下一名队友立即接管逼抢", () => {
  const w = live();
  w.players = [w.players[6]!, w.players[5]!, w.players[3]!, w.players[20]!]; w.controlled = 0;
  place(w, 0, 90, 60); place(w, 1, 48, 34); place(w, 2, 44, 37); place(w, 3, 50, 34);
  w.players[1]!.stun = 1.1; own(w, 3);
  step(w, emptyInput(), t, TICK_DT);
  assert.ok(Math.hypot(w.players[2]!.aim.x - w.ball.pos.x, w.players[2]!.aim.y - w.ball.pos.y) < 3,
    "不能继续让倒地的人负责逼抢，补位队友应马上迎向持球威胁");
});

test("三种传球交给跑动中的队友后，能稳定收球而非接一下又飞走", () => {
  const results = [];
  for (const kind of ["short", "long", "through"] as const) for (const vy of [-4, 0, 4]) {
    const w = live();
    w.players = [w.players[6]!, w.players[9]!]; w.controlled = 0;
    place(w, 0, 35, 34); place(w, 1, kind === "long" ? 66 : 53, 34);
    w.players[1]!.vel = { x: 3, y: vy }; own(w, 0);
    firePass(w, { ...emptyInput(), moveX: 1 }, kind, t, 0.5);
    assert.equal(w.receiver, 1);
    let caughtAt = -1, secured = false;
    for (let tick = 0; tick < 360; tick++) {
      step(w, emptyInput(), t, TICK_DT);
      if (caughtAt < 0 && w.ball.owner === 1) caughtAt = tick;
      if (caughtAt >= 0 && tick - caughtAt >= 30) { secured = w.ball.owner === 1; break; }
    }
    results.push({ kind, vy, secured });
  }
  console.log({ scenario: "跑动接球", results });
  assert.ok(results.every(r => r.secured));
});

test("面对向球门冲刺的持球人，协防能形成真实抢断", () => {
  const results = [];
  for (const y of [30, 34, 38]) {
    const w = live();
    w.players = [w.players[6]!, w.players[5]!, w.players[3]!, w.players[20]!]; w.controlled = 0;
    place(w, 0, 90, 60); place(w, 1, 45, y); place(w, 2, 38, 34); place(w, 3, 50, 34);
    w.players[3]!.vel.x = -8; w.players[3]!.facing = Math.PI; own(w, 3);
    const tuning = createTuning(); tuning.attack.decisionDelay = 20;
    for (let tick = 0; tick < 180; tick++) {
      step(w, emptyInput(), tuning, TICK_DT);
      if (w.ball.owner !== null && w.players[w.ball.owner]!.team === 0) break;
    }
    results.push({ y, won: w.ball.owner !== null && w.players[w.ball.owner]!.team === 0 });
  }
  console.log({ scenario: "冲刺突破协防", results });
  assert.ok(results.filter(r => r.won).length >= 2, "迎面有防线时不能轻松直线跑穿");
});

test("接回传后背身停球，防守者应绕到球侧，不能一直撞着背部空伸脚", () => {
  for (const offset of [-0.15, 0, 0.15]) {
    const w = live();
    w.players = [w.players[6]!, w.players[20]!];
    w.controlled = 0;
    place(w, 0, 50, 34); place(w, 1, 52, 34 + offset);
    w.players[0]!.facing = Math.PI;
    w.players[1]!.facing = Math.PI;
    w.ball.owner = 0; w.ball.pos = { x: 49.1, y: 34 };
    let won = false;
    for (let tick = 0; tick < 300; tick++) {
      step(w, emptyInput(), t, TICK_DT);
      if (w.ball.owner === 1) { won = true; break; }
      if (w.phase !== "playing") break;
    }
    assert.ok(won, `背身偏移 ${offset}：应从侧面接近球，而不是无限卡在身体后面`);
  }
});
