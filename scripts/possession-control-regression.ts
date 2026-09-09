import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import { emptyInput, type World } from "../src/sim/types.ts";
import { createTuning } from "../src/tuning.ts";
import { TICK_DT, CENTER_Y, PENALTY_BOX_DEPTH, PENALTY_BOX_WIDTH } from "../src/sim/constants.ts";
import { awardCornerOrGoalKick } from "../src/sim/rules.ts";
import { matchMessage } from "../src/ui/match.ts";

const t = createTuning();
function live(): World {
  const w = createWorld(); w.phase = "playing"; w.restart = null; w.ball.owner = null;
  return w;
}
function keeperCatch(): World {
  const w = live();
  w.players = [w.players[0]!, w.players[6]!]; w.controlled = 1;
  w.players[0]!.pos = { x: 5, y: 34 }; w.players[0]!.vel = { x: 0, y: 0 };
  w.players[1]!.pos = { x: 20, y: 34 };
  w.ball.pos = { x: 5.8, y: 34 }; w.ball.vel = { x: -25, y: 0 }; w.ball.z = 0.2;
  step(w, emptyInput(), t, TICK_DT);
  assert.equal(w.ball.owner, 0);
  return w;
}

test("各个方向的正常来球收下后，急转、冲刺和急停都不会自己丢球", () => {
  for (let angle = 0; angle < 8; angle++) {
    const w = live(); w.players = [w.players[6]!]; w.controlled = 0;
    const p = w.players[0]!; p.pos = { x: 50, y: 34 }; p.vel = { x: 0, y: 0 }; p.facing = 0;
    const a = angle * Math.PI / 4;
    w.ball.pos = { x: 50 + 1.5 * Math.cos(a), y: 34 + 1.5 * Math.sin(a) };
    w.ball.vel = { x: -28 * Math.cos(a), y: -28 * Math.sin(a) };
    step(w, emptyInput(), t, TICK_DT);
    assert.equal(w.ball.owner, 0);
    for (let tick = 0; tick < 600; tick++) {
      const turn = Math.floor(tick / 9) * 2.4;
      const stop = tick % 37 < 7;
      step(w, { ...emptyInput(), moveX: stop ? 0 : Math.cos(turn), moveY: stop ? 0 : Math.sin(turn), sprint: true }, t, TICK_DT);
      assert.equal(w.ball.owner, 0, `来球方向 ${angle}，收球后第 ${tick} 帧不能丢球`);
    }
  }
});

test("我方门将扑住球就能操作，等待不会被自动开走", () => {
  const w = keeperCatch();
  assert.equal(w.controlled, 0);
  for (let tick = 0; tick < 180; tick++) step(w, emptyInput(), t, TICK_DT);
  assert.equal(w.ball.owner, 0); assert.equal(w.controlled, 0);
  assert.match(matchMessage(w)[1], /WASD|移动/);
  const y = w.players[0]!.pos.y;
  for (let tick = 0; tick < 60; tick++) step(w, { ...emptyInput(), moveY: 1 }, t, TICK_DT);
  assert.ok(w.players[0]!.pos.y > y + 1); assert.equal(w.ball.owner, 0);
  for (let tick = 0; tick < 300; tick++) step(w, { ...emptyInput(), moveX: 1, moveY: 1, sprint: true }, t, TICK_DT);
  assert.ok(w.ball.pos.x < PENALTY_BOX_DEPTH);
  assert.ok(w.ball.pos.y < CENTER_Y + PENALTY_BOX_WIDTH / 2);
});

for (const key of ["passShort", "passThrough", "passLong", "shoot"] as const) {
  test(`门将 ${key} 按住等待、松开出球，然后恢复场上球员控制`, () => {
    const w = keeperCatch();
    for (let tick = 0; tick < 35; tick++) step(w, { ...emptyInput(), [key]: true }, t, TICK_DT);
    assert.equal(w.ball.owner, 0);
    step(w, emptyInput(), t, TICK_DT);
    assert.equal(w.ball.owner, null);
    assert.ok(w.ball.vel.x > 8);
    assert.notEqual(w.players[w.controlled]!.slot, 0);
    assert.equal(w.matchStats[0].shots, 0, "门将发球不能计成射门");
    if (key === "shoot" || key === "passLong") assert.ok(w.ball.vz > 2);
    for (let tick = 0; tick < 120; tick++) step(w, emptyInput(), t, TICK_DT);
    assert.notEqual(w.players[w.controlled]!.slot, 0);
  });
}

test("门将鱼跃接球后先落地起身，之后可以移动出球", () => {
  const w = keeperCatch(); const gk = w.players[0]!;
  gk.dive = 0.2; gk.aim.y = gk.pos.y + 1;
  for (let tick = 0; tick < 15; tick++) step(w, { ...emptyInput(), passShort: tick % 2 === 0 }, t, TICK_DT);
  assert.equal(w.ball.owner, 0); assert.equal(gk.dive, 0); assert.ok(gk.stun > 0);
  for (let tick = 0; tick < 60; tick++) step(w, emptyInput(), t, TICK_DT);
  assert.equal(gk.stun, 0);
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT);
  step(w, emptyInput(), t, TICK_DT);
  assert.equal(w.ball.owner, null);
});

test("我方球门球摆好交给门将，等玩家松键后才开球", () => {
  const w = createWorld();
  awardCornerOrGoalKick(w, t, "goalKick", 0, { x: 5.5, y: 34 }, "球门球");
  for (let tick = 0; tick < 1200 && w.restart?.stage !== "ready"; tick++) step(w, emptyInput(), t, TICK_DT);
  assert.equal(w.restart?.stage, "ready");
  const taker = w.restart!.taker;
  for (let tick = 0; tick < 180; tick++) step(w, emptyInput(), t, TICK_DT);
  assert.equal(w.controlled, taker); assert.equal(w.phase, "restart");
  step(w, { ...emptyInput(), passLong: true }, t, TICK_DT);
  step(w, emptyInput(), t, TICK_DT);
  assert.equal(w.phase, "playing"); assert.equal(w.ball.owner, null);
});

test("门将抱球时对手退开布防，不围着手里的球反复逼抢", () => {
  const w = keeperCatch();
  const foe = createWorld().players[20]!;
  foe.pos = { x: 6.5, y: 34 }; foe.prevPos = { ...foe.pos }; foe.vel = { x: 0, y: 0 };
  w.players.push(foe);
  for (let tick = 0; tick < 180; tick++) step(w, emptyInput(), t, TICK_DT);
  assert.equal(w.ball.owner, 0);
  assert.ok(Math.hypot(foe.pos.x - w.ball.pos.x, foe.pos.y - w.ball.pos.y) >= 3,
    "抱球期间让出发球空间，出球后再争抢");
});
