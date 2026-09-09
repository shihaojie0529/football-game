import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import { emptyInput, type World } from "../src/sim/types.ts";
import { createTuning } from "../src/tuning.ts";
import { defenderSelection } from "../src/render/control-view.ts";
import { Camera } from "../src/render/camera.ts";
import { TICK_DT } from "../src/sim/constants.ts";
import { PPM, VIEW_WIDTH, VIEW_HEIGHT } from "../src/render/viewport.ts";

function place(w: World, index: number, x: number, y: number): void {
  const p = w.players[index]!;
  p.pos = { x, y }; p.prevPos = { x, y }; p.vel = { x: 0, y: 0 };
}
function fixture() {
  const w = createWorld();
  w.phase = "playing"; w.restart = null; w.controlled = 0;
  w.players = [w.players[6]!, w.players[3]!, w.players[5]!, w.players[9]!, w.players[20]!];
  place(w, 0, 47, 34); place(w, 1, 43, 30); place(w, 2, 50, 60);
  place(w, 3, 56, 30); place(w, 4, 50, 34);
  w.ball.owner = 4; w.ball.pos = { x: 49.1, y: 34 }; w.ball.prevPos = { ...w.ball.pos };
  const camera = new Camera(); camera.snapTo(50, 34);
  const t = createTuning(); t.attack.decisionDelay = 99; t.ai.pressRadius = 0;
  return { w, t, camera };
}
function visible(w: World, index: number, c: Camera): boolean {
  const p = w.players[index]!;
  const x = Math.round(VIEW_WIDTH / 2 - c.x * PPM) + p.pos.x * PPM;
  const y = Math.round(VIEW_HEIGHT / 2 - c.y * PPM) + p.pos.y * PPM;
  return x >= 8 && x <= VIEW_WIDTH - 8 && y >= 30 && y <= VIEW_HEIGHT - 8;
}

test("连续按 J 不能把画面内的后卫切到另一条画面外边路", () => {
  const { w, t, camera } = fixture();
  for (let tap = 0; tap < 8; tap++) {
    step(w, { ...emptyInput(), passShort: true }, t, TICK_DT, defenderSelection(w, camera, t));
    assert.ok(visible(w, w.controlled, camera), `第 ${tap + 1} 次切人选中了画面外的 #${w.controlled}`);
    step(w, emptyInput(), t, TICK_DT, defenderSelection(w, camera, t));
  }
});

test("多人追不上快速长球时，不能因预测时间相同而选到更远的人", () => {
  const { w, t } = fixture();
  w.players = w.players.slice(0, 3);
  place(w, 0, 45, 34); place(w, 1, 15, 34); place(w, 2, 48, 34);
  w.ball.owner = null; w.ball.pos = { x: 55, y: 34 }; w.ball.vel = { x: 38, y: 0 };
  w.ball.z = 2; w.ball.vz = 4; w.ball.stickyLock = 99;
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT);
  assert.equal(w.controlled, 2, "都追不上时应该选择更靠近落点的球员，不能按球员数组次序切人");
});

test("画面外的人即使更接近球，手动和辅助切人也优先留在画面内", () => {
  for (const manual of [false, true]) {
    const { w, t, camera } = fixture();
    place(w, 0, 30, 40); place(w, 1, 44, 44); place(w, 2, 50, 53); place(w, 3, 80, 10);
    place(w, 4, 50, 50);
    w.ball.pos = { x: 49.1, y: 50 }; w.ball.prevPos = { ...w.ball.pos };
    if (!manual) { w.ball.owner = null; w.ball.stickyLock = 99; }
    const selection = defenderSelection(w, camera, t);
    step(w, { ...emptyInput(), passShort: manual }, t, TICK_DT, selection);
    assert.equal(w.controlled, 1);
    assert.ok(visible(w, w.controlled, camera));
  }
});

test("镜头偏移后，候选按新画面更新；没有可见队友时保持原人", () => {
  const { w, t, camera } = fixture();
  camera.snapTo(50, 58);
  const selection = defenderSelection(w, camera, t);
  assert.equal(selection.next, 2);
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT, selection);
  assert.equal(w.controlled, 2);
  step(w, emptyInput(), t, TICK_DT, defenderSelection(w, camera, t));
  const noAlternative = defenderSelection(w, camera, t);
  assert.equal(noAlternative.next, null);
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT, noAlternative);
  assert.equal(w.controlled, 2);
});

test("下一位标记与按 J 的目标一致，即使显示后排名变化也不偷换目标", () => {
  const { w, t, camera } = fixture();
  const selection = defenderSelection(w, camera, t);
  assert.notEqual(selection.next, null);
  const indicated = selection.next!;
  // 模拟绘制与下一次模拟之间的位移：另一名队友现在更靠近球。
  const other = indicated === 1 ? 3 : 1;
  place(w, other, 48, 34);
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT, selection);
  assert.equal(w.controlled, indicated);
});

test("标记球员已跑出画面时取消本次切换，不换给没标记的人", () => {
  const { w, t, camera } = fixture();
  const selection = defenderSelection(w, camera, t);
  assert.notEqual(selection.next, null);
  place(w, selection.next!, 100, 65);
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT, selection);
  assert.equal(w.controlled, 0);
});

test("小地图挡住的人不进入切人候选", () => {
  const { w, t, camera } = fixture();
  place(w, 0, 38, 34); place(w, 1, 50, 35); place(w, 2, 64, 44); place(w, 3, 85, 65);
  place(w, 4, 64, 43); w.ball.pos = { x: 63.1, y: 43 };
  assert.ok(visible(w, 2, camera), "这个球员位于画面边界内，但被雷达覆盖");
  const selection = defenderSelection(w, camera, t);
  assert.equal(selection.next, 1);
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT, selection);
  assert.equal(w.controlled, 1);
});

test("距离相近时优先球门侧，明显更近的人不因站位加权被跳过", () => {
  const { w, t, camera } = fixture();
  place(w, 0, 30, 34); place(w, 1, 47, 34); place(w, 2, 51.2, 34); place(w, 3, 85, 60);
  const equalDistance = defenderSelection(w, camera, t);
  assert.equal(equalDistance.next, 1);
  place(w, 1, 39, 34);
  const muchCloser = defenderSelection(w, camera, t);
  assert.equal(muchCloser.next, 2);
});

test("地滚球切人以离球近为主，不提前跳到十几米外的预判点", () => {
  const { w, t, camera } = fixture();
  place(w, 0, 35, 40); place(w, 1, 46, 34); place(w, 2, 62, 34); place(w, 3, 90, 60);
  w.ball.owner = null; w.ball.pos = { x: 50, y: 34 }; w.ball.vel = { x: 20, y: 0 };
  w.ball.z = 0; w.ball.vz = 0; w.ball.stickyLock = 99;
  const selection = defenderSelection(w, camera, t);
  assert.equal(selection.next, 1);
  step(w, { ...emptyInput(), passShort: true }, t, TICK_DT, selection);
  assert.equal(w.controlled, 1);
});
