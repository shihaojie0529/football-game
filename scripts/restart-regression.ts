import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld, resetKickoff } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import { emptyInput, type World, type InputState } from "../src/sim/types.ts";
import { createTuning } from "../src/tuning.ts";
import { awardKickoff, foul, awardCornerOrGoalKick, checkOutOfPlay } from "../src/sim/rules.ts";
import { TICK_DT, CENTER_X, CENTER_Y } from "../src/sim/constants.ts";

const tuning = createTuning();
function run(w: World, ticks: number, input: InputState = emptyInput()): void {
  for (let i = 0; i < ticks; i++) step(w, input, tuning, TICK_DT);
}
function ready(w: World): void {
  for (let i = 0; i < 1200 && w.restart?.stage !== "ready"; i++) run(w, 1);
  assert.equal(w.restart?.stage, "ready");
}

test("开场和重置后不操作，对方不能抢球，比赛时钟不走", () => {
  const w = createWorld();
  for (const reset of [false, true]) {
    if (reset) resetKickoff(w, true);
    const clock = w.clock;
    for (let i = 0; i < 1200; i++) {
      run(w, 1);
      assert.ok(w.ball.owner === null || w.players[w.ball.owner]!.team === 0,
        `未开球，${(i * TICK_DT).toFixed(2)} 秒时对方拿到了球`);
    }
    assert.equal(w.phase, "restart");
    assert.equal(w.clock, clock);
  }
});

for (const kind of ["kickoff", "freeKick", "throwIn", "corner"] as const) {
  test(`${kind} 摆好后等待或蓄力不会放行，松键出球才恢复比赛`, () => {
    const w = createWorld();
    w.phase = "playing";
    w.restart = null;
    if (kind === "kickoff") awardKickoff(w, tuning, 0, "开球");
    if (kind === "freeKick") foul(w, tuning, 12, { x: CENTER_X, y: CENTER_Y });
    if (kind === "corner") awardCornerOrGoalKick(w, tuning, "corner", 0, { x: 104.5, y: 0.5 }, "角球");
    if (kind === "throwIn") {
      w.lastTouch = 1;
      w.ball.pos.y = -0.5;
      checkOutOfPlay(w, tuning);
    }
    ready(w);
    const taker = w.restart!.taker;
    const at = { ...w.restart!.at };
    run(w, 1200);
    assert.equal(w.phase, "restart", "不能到时间就让对面抢");
    assert.equal(w.ball.owner, taker);
    run(w, 120, { ...emptyInput(), moveY: 1, passShort: true });
    assert.equal(w.phase, "restart", "调整方向和蓄力不算出球");
    assert.deepEqual(w.ball.pos, at);
    run(w, 1);
    assert.equal(w.phase, "playing");
    assert.equal(w.restart, null);
    assert.equal(w.passes, 1);
  });
}

test("对方 AI 的开球和球门球会实际踢出，不会一直等待", () => {
  for (const team of [1] as const) {
    for (const kind of ["kickoff", "goalKick"] as const) {
      const w = createWorld();
      if (kind === "kickoff") awardKickoff(w, tuning, team, "开球");
      else awardCornerOrGoalKick(w, tuning, kind, team, { x: team === 0 ? 5.5 : 99.5, y: CENTER_Y }, "球门球");
      ready(w);
      for (let i = 0; i < 600 && w.phase === "restart"; i++) run(w, 1);
      assert.equal(w.phase, "playing");
      assert.equal(w.ball.owner, null, "恢复比赛时必须已经出球");
      assert.ok(Math.hypot(w.ball.vel.x, w.ball.vel.y) > 1);
    }
  }
});

for (const key of ["shoot", "passThrough", "passLong"] as const) {
  test(`${key} 也只在松键出球后解除开球保护`, () => {
    const w = createWorld();
    run(w, 180, { ...emptyInput(), [key]: true });
    assert.equal(w.phase, "restart");
    run(w, 1);
    assert.equal(w.phase, "playing");
    assert.ok(Math.hypot(w.ball.vel.x, w.ball.vel.y) > 1);
  });
}

test("开球保护解除后，对方仍然可以正常抢断", () => {
  const w = createWorld();
  run(w, 10, { ...emptyInput(), passShort: true });
  run(w, 1);
  assert.equal(w.phase, "playing");
  // 接球后站着不动，给对方足够时间逼抢。
  let opponentHasBall = false;
  for (let i = 0; i < 1200; i++) {
    run(w, 1);
    if (w.ball.owner !== null && w.players[w.ball.owner]!.team === 1) {
      opponentHasBall = true;
      break;
    }
  }
  assert.ok(opponentHasBall);
});
