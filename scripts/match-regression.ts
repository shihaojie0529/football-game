import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld, resetKickoff } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import { fireAIPass } from "../src/sim/pass.ts";
import { emptyInput, type World } from "../src/sim/types.ts";
import { createTuning } from "../src/tuning.ts";
import { TICK_DT } from "../src/sim/constants.ts";
import { matchMessage, possessionPercent } from "../src/ui/match.ts";

const t = createTuning();
function live(): World {
  const w = createWorld();
  w.phase = "playing";
  w.restart = null;
  for (const p of w.players) {
    p.pos.x = p.team === 0 ? 35 : 90;
    p.pos.y = 58 + p.slot * 0.7;
  }
  w.players[0]!.pos = { x: 5, y: 34 };
  return w;
}
function own(w: World, index: number, x: number, y: number): void {
  const p = w.players[index]!;
  p.pos = { x, y };
  p.prevPos = { x, y };
  p.facing = p.team === 0 ? 0 : Math.PI;
  w.ball.owner = index;
  w.ball.pos = { x: x + (p.team === 0 ? 0.9 : -0.9), y };
  w.ball.prevPos = { ...w.ball.pos };
}

test("对手在禁区附近会实际射门，射向我方球门并计入客队数据", () => {
  const w = live();
  own(w, 20, 19, 34);
  for (let i = 0; i < 180 && w.shots === 0; i++) step(w, emptyInput(), t, TICK_DT);
  assert.equal(w.matchStats[1].shots, 1);
  assert.equal(w.matchStats[0].shots, 0);
  assert.ok(w.ball.vel.x < 0);
  assert.equal(w.ball.owner, null);
});

test("对手会传给前方空位队友，玩家控制权不会交给客队", () => {
  const w = live();
  own(w, 20, 70, 34);
  w.players[21]!.pos = { x: 53, y: 43 };
  for (let i = 0; i < 240 && w.passes === 0; i++) step(w, emptyInput(), t, TICK_DT);
  assert.equal(w.matchStats[1].passes, 1);
  assert.equal(w.receiver, 21);
  for (let i = 0; i < 150; i++) {
    step(w, emptyInput(), t, TICK_DT);
    assert.equal(w.players[w.controlled]!.team, 0);
    assert.notEqual(w.players[w.controlled]!.slot, 0);
  }
});

test("对手传球期间防守自动切人仍有效", () => {
  const w = live();
  own(w, 20, 70, 34);
  w.players[21]!.pos = { x: 53, y: 43 };
  w.players[w.controlled]!.pos = { x: 100, y: 65 };
  w.players[9]!.pos = { x: 60, y: 37 };
  const before = w.controlled;
  fireAIPass(w, t, 20, 21);
  step(w, emptyInput(), t, TICK_DT);
  assert.notEqual(w.controlled, before);
  assert.equal(w.players[w.controlled]!.team, 0);
});

test("进球后重开保留本场统计，重新开赛清除统计与进球提示", () => {
  const w = live();
  w.matchStats[0] = { shots: 3, passes: 12, tackles: 2, possession: 30 };
  w.matchStats[1].possession = 10;
  w.goalFlash = 1.8;
  resetKickoff(w);
  assert.equal(w.matchStats[0].shots, 3);
  assert.deepEqual(possessionPercent(w), [75, 25]);
  resetKickoff(w, true, 60);
  assert.equal(w.matchStats[0].shots, 0);
  assert.equal(w.matchStats[0].possession, 0);
  assert.equal(w.clock, 60);
  assert.equal(w.goalFlash, 0);
});

test("未开球不统计控球时间，提示明确说明需要玩家出球", () => {
  const w = createWorld();
  for (let i = 0; i < 600; i++) step(w, emptyInput(), t, TICK_DT);
  assert.equal(w.matchStats[0].possession + w.matchStats[1].possession, 0);
  assert.ok(matchMessage(w)[0].includes("等你出球"));
});

test("一场比赛能走到终场，统计有限且球权始终合法", () => {
  const w = createWorld();
  resetKickoff(w, true, 60);
  for (let i = 0; i < 18000 && w.phase !== "fullTime"; i++) {
    const me = w.players[w.controlled]!;
    const hasBall = w.ball.owner === w.controlled;
    const restart = w.phase === "restart" && w.restart?.stage === "ready" && w.restart.taker === w.controlled;
    const dx = w.ball.pos.x - me.pos.x, dy = w.ball.pos.y - me.pos.y;
    const distance = Math.hypot(dx, dy) || 1;
    const cmd = { ...emptyInput(), moveX: hasBall ? 1 : dx / distance, moveY: hasBall ? 0 : dy / distance };
    cmd.passShort = restart ? !w.actionWasHeld.short : hasBall && i % 120 < 15;
    cmd.shoot = hasBall && me.pos.x > 78 && i % 90 < 25;
    step(w, cmd, t, TICK_DT);
    assert.equal(w.players[w.controlled]!.team, 0);
    assert.ok(Number.isFinite(w.ball.pos.x) && Number.isFinite(w.ball.pos.y));
  }
  assert.equal(w.phase, "fullTime");
  assert.equal(w.clock, 0);
  assert.ok(w.matchStats.every((s) => Number.isFinite(s.possession)));
});
