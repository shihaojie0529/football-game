import assert from "node:assert/strict";
import { test } from "node:test";
import { createMatchTuning, createTuning, restoreTuningDefaults, tuningForTeam, type Tuning } from "../src/tuning.ts";
import { createWorld } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import { fireShot } from "../src/sim/shot.ts";
import { fireAIPass } from "../src/sim/pass.ts";
import { startTackle, updateTackleTimers } from "../src/sim/tackle.ts";
import { updatePossession } from "../src/sim/possession.ts";
import { emptyInput } from "../src/sim/types.ts";
import { TICK_DT } from "../src/sim/constants.ts";

function live() {
  const w = createWorld();
  w.phase = "playing"; w.restart = null; w.ball.owner = null;
  return w;
}

test("两队移动参数在完整模拟中分别作用于玩家和 AI", () => {
  const t = createMatchTuning();
  t.teams[0].move.maxSpeed = 2;
  t.teams[1].move.maxSpeed = 10;
  t.teams[1].attack.decisionDelay = 100;
  const w = live();
  w.players = [w.players[6]!, w.players[20]!]; w.controlled = 0;
  w.players[0]!.pos = { x: 20, y: 10 };
  w.players[1]!.pos = { x: 80, y: 50 };
  w.ball.owner = 1; w.ball.pos = { x: 79, y: 50 };
  for (let i = 0; i < 60; i++) step(w, { ...emptyInput(), moveX: 1 }, t, TICK_DT);
  assert.ok(Math.abs(w.players[0]!.vel.x - 2) < 0.01);
  assert.ok(Math.hypot(w.players[1]!.vel.x, w.players[1]!.vel.y) > 9);
});

test("射门、AI 传球和铲球使用出球方的参数，包含冷却结算", () => {
  const t = createMatchTuning();
  t.teams[0].shot.maxPower = 10; t.teams[1].shot.maxPower = 40;
  t.teams[0].pass.short.arriveSpeed = 2; t.teams[1].pass.short.arriveSpeed = 15;
  t.teams[0].slide.recovery = 0.3; t.teams[1].slide.recovery = 2;
  for (const team of [0, 1] as const) {
    const w = live();
    const index = team === 0 ? 6 : 20;
    w.ball.owner = index;
    fireShot(w, t, 1);
    const power = Math.hypot(w.ball.vel.x, w.ball.vel.y, w.ball.vz);
    assert.ok(Math.abs(power - t.teams[team].shot.maxPower) < 0.001);
    const to = team === 0 ? 9 : 17;
    w.players[index]!.pos = { x: 50, y: 34 };
    w.players[to]!.pos = { x: 50 + (team === 0 ? 12 : -12), y: 34 };
    w.ball.owner = index; w.ball.pos = { x: 50, y: 34 };
    fireAIPass(w, t, index, to);
    assert.ok(Math.abs(Math.abs(w.ball.vel.x) - (12 * t.ball.groundFriction + t.teams[team].pass.short.arriveSpeed)) < 0.01);
    w.ball.pos = { x: 10, y: 60 }; w.ball.z = 3;
    assert.ok(startTackle(w, index, t, "slide"));
    updateTackleTimers(w, t, t.teams[team].slide.windowTime);
    assert.equal(w.players[index]!.stun, t.teams[team].slide.recovery);
  }
});

test("自由球接球半径按接球球员队伍读取", () => {
  const t = createMatchTuning();
  t.teams[0].dribble.stickyRadius = 0.2; t.teams[1].dribble.stickyRadius = 3;
  for (const team of [0, 1] as const) {
    const w = live(); w.players = [w.players[team === 0 ? 6 : 20]!]; w.controlled = 0;
    w.players[0]!.pos = { x: 50, y: 34 }; w.ball.pos = { x: 52, y: 34 };
    updatePossession(w, t, TICK_DT);
    assert.equal(w.ball.owner, team === 0 ? null : 0);
  }
});

test("单队恢复不影响另一队和公共参数，全量恢复保留面板对象引用", () => {
  const t = createMatchTuning();
  const homePass = t.teams[0].pass.long, awayMove = t.teams[1].move, ball = t.ball;
  t.teams[0].pass.long.loft = 55; t.teams[1].move.maxSpeed = 12; t.ball.gravityZ = 20;
  restoreTuningDefaults(t, 0);
  assert.deepEqual(t.teams[0].pass.long, createTuning().pass.long);
  assert.equal(t.teams[1].move.maxSpeed, 12); assert.equal(t.ball.gravityZ, 20);
  restoreTuningDefaults(t);
  assert.deepEqual(t, createMatchTuning());
  assert.equal(t.teams[0].pass.long, homePass);
  assert.equal(t.teams[1].move, awayMove); assert.equal(t.ball, ball);
  homePass.loft = 45; awayMove.maxSpeed = 9;
  assert.equal(tuningForTeam(t, 0).pass.long.loft, 45);
  assert.equal(tuningForTeam(t, 1).move.maxSpeed, 9);
  assert.equal(tuningForTeam(tuningForTeam(t, 1), 0).move.maxSpeed, createTuning().move.maxSpeed);
});

function shotResults(t: Tuning, keeperTeam: 0 | 1) {
  let saves = 0, goals = 0;
  for (const distance of [12, 18, 26]) for (const from of [-8, 0, 8])
    for (const aim of [-3.4, -1.7, 0, 1.7, 3.4]) for (const power of [22, 30]) {
      const w = live();
      w.players = [w.players[keeperTeam === 0 ? 0 : 11]!, w.players[6]!];
      w.controlled = 1; w.players[1]!.pos = { x: 50, y: 5 };
      const dir = keeperTeam === 0 ? -1 : 1;
      const goalX = keeperTeam === 0 ? 0 : 105;
      w.players[0]!.pos = { x: goalX - dir * t.ai.gkLineDepth, y: 34 };
      w.ball.pos = { x: goalX - dir * distance, y: 34 + from };
      const length = Math.hypot(distance, aim - from);
      w.ball.vel = { x: dir * distance / length * power, y: (aim - from) / length * power };
      w.lastTouch = keeperTeam === 0 ? 1 : 0;
      for (let i = 0; i < 300; i++) {
        step(w, emptyInput(), t, TICK_DT);
        if (w.ball.owner === 0) { saves++; break; }
        if (w.goals[keeperTeam === 0 ? 1 : 0] > 0) { goals++; break; }
        if (w.phase !== "playing") break;
      }
    }
  return { saves, goals };
}

test("默认门将仍有扑救能力，角度球比旧参数更容易得分，改对方门将不影响我方", () => {
  const t = createMatchTuning();
  const baseline = shotResults(t, 0);
  const opposite = shotResults(t, 1);
  assert.deepEqual(baseline, opposite, "默认两队守门能力对称");
  Object.assign(t.teams[1].ai, { gkSpeed: 3.8, gkReaction: 0.35, gkReach: 0.7, gkDiveReach: 1.25, gkDiveSpeed: 9 });
  const stronger = shotResults(t, 1);
  console.log({ scenario: "门将平衡：90 脚角度球", current: baseline, previousParameters: stronger });
  assert.ok(baseline.saves >= 30 && baseline.goals > 0);
  assert.ok(stronger.saves >= baseline.saves + 5);
  assert.deepEqual(shotResults(t, 0), baseline);
});
