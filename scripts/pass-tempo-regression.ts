import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import { emptyInput } from "../src/sim/types.ts";
import { createTuning } from "../src/tuning.ts";
import { TICK_DT } from "../src/sim/constants.ts";
import { firePass } from "../src/sim/pass.ts";
import { updateBall } from "../src/sim/ball.ts";

const t = createTuning();
const sprint = t.move.maxSpeed * t.move.sprintMultiplier;
function setup(distance: number) {
  const w = createWorld();
  w.phase = "playing"; w.restart = null; w.controlled = 0;
  w.players = [w.players[6]!, w.players[9]!];
  for (const [i, x] of [[0, 35], [1, 35 + distance]]) {
    const p = w.players[i!]!;
    p.pos = { x: x!, y: 34 }; p.prevPos = { ...p.pos }; p.vel = { x: 0, y: 0 }; p.facing = 0;
  }
  w.ball.owner = 0; w.ball.pos = { x: 35.9, y: 34 }; w.ball.prevPos = { ...w.ball.pos };
  return w;
}

test("短传和直塞到达目标前，球速应明显快于冲刺，传球比带球更快", () => {
  const rows = [];
  for (const kind of ["short", "through"] as const) for (const distance of [4, 8, 12, 20]) {
    const w = setup(distance);
    firePass(w, emptyInput(), kind, t, 0);
    assert.equal(w.receiver, 1);
    const goal = w.players[1]!.pos.x + (kind === "through" ? t.pass.through.lead : 0);
    const travel = goal - w.ball.pos.x;
    let elapsed = 0, minSpeed = Infinity;
    for (let tick = 0; tick < 600 && w.ball.pos.x < goal - 1; tick++) {
      updateBall(w.ball, t, TICK_DT);
      elapsed += TICK_DT;
      minSpeed = Math.min(minSpeed, Math.hypot(w.ball.vel.x, w.ball.vel.y));
    }
    rows.push({ kind, distance, elapsed: +elapsed.toFixed(2), minSpeed: +minSpeed.toFixed(2), runnerTime: +(travel / sprint).toFixed(2) });
  }
  console.log({ sprint, rows });
  assert.ok(rows.every(r => r.minSpeed > sprint * 1.2), "到接球范围之前，不能已经减速到比球员跑步还慢");
  assert.ok(rows.every(r => r.elapsed < r.runnerTime * 0.8));
});

test("冲刺中轻点短传，球离脚后会向前拉开距离", () => {
  const w = setup(8);
  w.players[0]!.vel.x = sprint; w.ball.vel.x = sprint;
  step(w, { ...emptyInput(), moveX: 1, sprint: true, passShort: true }, t, TICK_DT);
  step(w, { ...emptyInput(), moveX: 1, sprint: true }, t, TICK_DT);
  const startGap = w.ball.pos.x - w.players[0]!.pos.x;
  for (let i = 0; i < 12; i++) step(w, { ...emptyInput(), moveX: 1, sprint: true }, t, TICK_DT);
  const gap = w.ball.pos.x - w.players[0]!.pos.x;
  console.log({ scenario: "冲刺轻传", startGap, gap, owner: w.ball.owner });
  assert.ok(gap > startGap + 0.8, "出球不能像在脚前慢慢推着走");
});

test("近距离短传能及时接住，不被全员接球冷却拖住", () => {
  const rows = [];
  for (const distance of [3, 4, 6]) {
    const w = setup(distance);
    step(w, { ...emptyInput(), passShort: true }, t, TICK_DT);
    let caughtAt = Infinity;
    for (let tick = 0; tick < 60; tick++) {
      step(w, emptyInput(), t, TICK_DT);
      if (w.ball.owner === 1) { caughtAt = tick * TICK_DT; break; }
    }
    rows.push({ distance, caughtAt });
  }
  console.log({ scenario: "近传接球耗时", rows });
  assert.ok(rows.every(r => r.caughtAt < 0.35), "接球人不该和传球人一起受到防止回吸的保护限制");
});

test("刚出脚的传球不能被自己回吸，但线路上的对手仍能截下", () => {
  const own = setup(12);
  firePass(own, emptyInput(), "short", t, 0);
  step(own, emptyInput(), t, TICK_DT);
  assert.equal(own.ball.owner, null);

  const w = setup(12);
  const foe = createWorld().players[20]!;
  foe.pos = { x: 38, y: 34 }; foe.prevPos = { ...foe.pos };
  foe.vel = { x: 0, y: 0 }; foe.facing = Math.PI;
  w.players.push(foe);
  firePass(w, emptyInput(), "short", t, 0);
  let intercepted = false;
  for (let tick = 0; tick < 15; tick++) {
    step(w, emptyInput(), t, TICK_DT);
    if (w.ball.owner === 2) { intercepted = true; break; }
  }
  assert.ok(intercepted, "出球保护不能给传球附带无法拦截的无敌时间");
});
