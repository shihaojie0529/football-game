import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorld } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import { emptyInput } from "../src/sim/types.ts";
import { createTuning } from "../src/tuning.ts";
import { TICK_DT } from "../src/sim/constants.ts";
import { firePass } from "../src/sim/pass.ts";

const t = createTuning();
test("中远距离长传给静止或横向跑动队友，落地能接稳，不从身体弹开", () => {
  const rows = [];
  for (const distance of [20, 30, 40, 44]) for (const vy of [-4, 0, 4]) {
    const w = createWorld(); w.phase = "playing"; w.restart = null; w.controlled = 0;
    w.players = [w.players[6]!, w.players[9]!];
    w.players[0]!.pos = { x: 25, y: 34 }; w.players[0]!.vel = { x: 0, y: 0 }; w.players[0]!.facing = 0;
    w.players[1]!.pos = { x: 25 + distance, y: 34 }; w.players[1]!.vel = { x: 0, y: vy };
    w.ball.owner = 0; w.ball.pos = { x: 25.9, y: 34 };
    firePass(w, emptyInput(), "long", t, 1);
    assert.equal(w.receiver, 1);
    let caughtAt = -1, stable = false, peak = 0;
    for (let tick = 0; tick < 360; tick++) {
      step(w, emptyInput(), t, TICK_DT);
      peak = Math.max(peak, w.ball.z);
      if (w.ball.owner === 1 && caughtAt < 0) caughtAt = tick;
      if (caughtAt >= 0 && w.ball.owner !== 1) break;
      if (caughtAt >= 0 && tick >= caughtAt + 30) { stable = true; break; }
    }
    rows.push({ distance, vy, caughtAt: caughtAt * TICK_DT, stable, peak });
  }
  console.log(rows);
  assert.equal(rows.length, 12);
  assert.ok(rows.every(row => row.stable && row.caughtAt < 4), "无人干扰的目标队友应当接住正常长传");
});
