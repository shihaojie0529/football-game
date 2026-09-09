import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import { emptyInput, type World } from "../src/sim/types.ts";
import { createTuning } from "../src/tuning.ts";
import { TICK_DT } from "../src/sim/constants.ts";

function setup(): { w: World; t: ReturnType<typeof createTuning> } {
  const w = createWorld();
  w.phase = "playing"; w.restart = null; w.controlled = 0;
  w.players = [w.players[6]!, w.players[3]!, w.players[20]!];
  for (const [i, x, y] of [[0, 35, 44], [1, 45, 34], [2, 50, 34]]) {
    const p = w.players[i!]!;
    p.pos = { x: x!, y: y! }; p.prevPos = { ...p.pos }; p.vel = { x: 0, y: 0 };
  }
  w.ball.owner = 2; w.ball.pos = { x: 49.1, y: 34 }; w.ball.prevPos = { ...w.ball.pos };
  const t = createTuning(); t.attack.decisionDelay = 100; t.ai.pressRadius = 0;
  return { w, t };
}

test("对方带球时，持续操作后卫跑位不会被切走", () => {
  const { w, t } = setup();
  for (let i = 0; i < 120; i++) {
    step(w, { ...emptyInput(), moveY: -1 }, t, TICK_DT);
    assert.equal(w.controlled, 0, `第 ${i + 1} 帧夺走了跑位中的控制权`);
  }
});

test("对方接到传球也不能绕过手动切人保护", () => {
  const { w, t } = setup();
  w.ball.owner = null; w.ball.pos = { ...w.players[2]!.pos };
  w.switchLock = 2;
  step(w, { ...emptyInput(), moveX: -1 }, t, TICK_DT);
  assert.equal(w.ball.owner, 2);
  assert.equal(w.controlled, 0, "对方接球的球权处理不应另行强制选最近后卫");
});

test("手动 J 从远处后卫切向最能接近球的队友", () => {
  const { w, t } = setup();
  w.players.push({ ...w.players[1]!, pos: { x: 12, y: 8 }, prevPos: { x: 12, y: 8 }, vel: { x: 0, y: 0 }, aim: { x: 12, y: 8 } });
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT);
  assert.equal(w.controlled, 1);
});

test("辅助模式下，对方稳定持球时即使不操作也不轮换后卫", () => {
  const { w, t } = setup();
  for (let i = 0; i < 120; i++) {
    step(w, emptyInput(), t, TICK_DT);
    assert.equal(w.controlled, 0);
  }
});

test("地面/空中无主球可以辅助切人，但同一次争夺不会来回跳", () => {
  for (const height of [0, 3]) {
    const { w, t } = setup();
    w.ball.owner = null; w.ball.z = height; w.ball.vz = 0;
    w.ball.stickyLock = 99; // 延长争夺时间，排除实际接球带来的进攻控制权移交。
    let switches = 0, previous = w.controlled;
    for (let i = 0; i < 240; i++) {
      step(w, emptyInput(), t, TICK_DT);
      if (previous !== w.controlled) { switches++; previous = w.controlled; }
    }
    assert.equal(switches, 1);
  }
});

test("跑向无主球时保留后卫，松开方向后的换向间隙也受保护", () => {
  const { w, t } = setup();
  w.ball.owner = null; w.ball.stickyLock = 99;
  for (let i = 0; i < 12; i++) {
    step(w, { ...emptyInput(), moveX: -1 }, t, TICK_DT);
    assert.equal(w.controlled, 0);
  }
  for (let i = 0; i < 12; i++) {
    step(w, emptyInput(), t, TICK_DT);
    assert.equal(w.controlled, 0, "换向时短暂松键不应立即切人");
  }
  for (let i = 0; i < 20; i++) step(w, emptyInput(), t, TICK_DT);
  assert.notEqual(w.controlled, 0, "停止操作后，无主球辅助仍应正常工作");
});

test("全手动模式中无主球不切人，按 J 仍能切换", () => {
  const { w, t } = setup();
  t.ai.switching = "manual";
  w.ball.owner = null; w.ball.stickyLock = 99;
  for (let i = 0; i < 60; i++) {
    step(w, emptyInput(), t, TICK_DT);
    assert.equal(w.controlled, 0);
  }
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT);
  assert.notEqual(w.controlled, 0);
});

test("手动选人后，同一个无主球即使保护时间结束也不会自动换回", () => {
  const { w, t } = setup();
  w.ball.owner = null; w.ball.stickyLock = 99;
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT);
  const selected = w.controlled;
  for (let i = 0; i < 240; i++) {
    step(w, emptyInput(), t, TICK_DT);
    assert.equal(w.controlled, selected);
  }
});

test("手动防守切人仍保留本方传球后的接球控制权移交", () => {
  const { w, t } = setup();
  t.ai.switching = "manual";
  w.players = w.players.slice(0, 2);
  w.players[1]!.pos = { x: 48, y: 44 };
  w.players[1]!.prevPos = { ...w.players[1]!.pos };
  w.ball.owner = 0; w.ball.pos = { x: 35.9, y: 44 }; w.ball.prevPos = { ...w.ball.pos };
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT);
  let received = false;
  for (let i = 0; i < 240; i++) {
    step(w, emptyInput(), t, TICK_DT);
    if (w.ball.owner === 1) { received = true; break; }
  }
  assert.ok(received);
  assert.equal(w.controlled, 1);
});
