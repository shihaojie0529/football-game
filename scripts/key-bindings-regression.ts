import assert from "node:assert/strict";
import { test } from "node:test";
import { Keyboard } from "../src/input/keyboard.ts";
import { DEFAULT_BINDINGS, rebind, loadBindings, saveBindings, bindingLabels, CONTROLS, controlsConflict } from "../src/input/bindings.ts";
import { createWorld } from "../src/sim/world.ts";
import { step } from "../src/sim/step.ts";
import { TICK_DT } from "../src/sim/constants.ts";
import { createTuning } from "../src/tuning.ts";
import { matchMessage } from "../src/ui/match.ts";

function input() {
  const target = new EventTarget();
  const keyboard = new Keyboard(target as unknown as Window);
  function send(type: string, code: string, extras = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { code, key: code, repeat: false, metaKey: false, altKey: false, ctrlKey: false, isComposing: false, ...extras });
    target.dispatchEvent(event); return event;
  }
  return { keyboard, send, target };
}

test("长传改为空格后，旧 I 不再触发，新键轻点能真正发出长传", () => {
  const { keyboard, send } = input(); keyboard.bind("passLong", "Space");
  send("keydown", "KeyI"); send("keyup", "KeyI"); assert.equal(keyboard.poll().passLong, false);
  assert.equal(send("keydown", "Space").defaultPrevented, true);
  send("keyup", "Space");
  const w = createWorld(), t = createTuning();
  step(w, keyboard.poll(), t, TICK_DT); assert.equal(w.charge.kind, "long");
  step(w, keyboard.poll(), t, TICK_DT);
  assert.equal(w.passes, 1); assert.equal(w.phase, "playing"); assert.ok(w.ball.vz > 0);
});

test("改成已占用按键时交换两个动作，不会一次触发传球和切人", () => {
  const { keyboard, send } = input(); keyboard.bind("passLong", "KeyJ");
  assert.equal(keyboard.bindings.passShort, "KeyI");
  send("keydown", "KeyJ"); send("keyup", "KeyJ");
  const state = keyboard.poll(); assert.equal(state.passLong, true); assert.equal(state.passShort, false);
  assert.ok(CONTROLS.every((a, i) => CONTROLS.slice(i + 1).every(b =>
    !controlsConflict(a, b) || keyboard.bindings[a] !== keyboard.bindings[b])));
});

test("改方向键、右 Shift 与固定暂停键都能正常消费输入", () => {
  const { keyboard, send } = input(); keyboard.bind("right", "ArrowRight");
  send("keydown", "ArrowRight"); send("keydown", "ShiftRight");
  assert.equal(keyboard.poll().moveX, 1); assert.equal(keyboard.poll().sprint, true);
  send("keyup", "ArrowRight"); assert.equal(keyboard.poll().moveX, 0);
  send("keydown", "Escape"); assert.equal(keyboard.consumePress("pause"), true); assert.equal(keyboard.consumePress("pause"), false);
  assert.throws(() => keyboard.bind("shoot", "Escape"));
});

test("设置录键和失焦不残留跑动或出球，恢复默认后旧配置失效", () => {
  const { keyboard, send, target } = input();
  send("keydown", "KeyD"); send("keydown", "KeyI"); keyboard.setEnabled(false);
  send("keydown", "KeyJ"); send("keyup", "KeyJ");
  assert.equal(keyboard.poll().moveX, 0); assert.equal(keyboard.poll().passShort, false);
  keyboard.bind("passLong", "Space"); keyboard.setEnabled(true);
  assert.equal(keyboard.poll().passLong, false);
  send("keydown", "Space"); target.dispatchEvent(new Event("blur")); assert.equal(keyboard.poll().passLong, false);
  keyboard.restoreDefaults(); assert.deepEqual(keyboard.bindings, DEFAULT_BINDINGS);
});

test("键位可保存重载，损坏配置或存储不可用时仍能使用默认操作", () => {
  let value: string | null = null;
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
  const bindings = rebind({ ...DEFAULT_BINDINGS }, "passLong", "Space");
  assert.ok(saveBindings(bindings, storage)); assert.deepEqual(loadBindings(storage), bindings);
  value = JSON.stringify({ ...bindings, shoot: "Space" }); assert.deepEqual(loadBindings(storage), DEFAULT_BINDINGS);
  value = "broken"; assert.deepEqual(loadBindings(storage), DEFAULT_BINDINGS);
  assert.equal(saveBindings(bindings, { setItem: () => { throw new Error("blocked"); } }), false);
  assert.deepEqual(loadBindings({ getItem: () => { throw new Error("blocked"); } }), DEFAULT_BINDINGS);
});

test("组合快捷键不误触比赛，改键后门将与防守提示同步", () => {
  const { keyboard, send } = input(); send("keydown", "KeyR", { metaKey: true });
  assert.equal(keyboard.consumePress("reset"), false);
  const w = createWorld(); w.phase = "playing"; w.restart = null; w.ball.owner = 0;
  const bindings = rebind({ ...DEFAULT_BINDINGS }, "passLong", "Space");
  assert.match(matchMessage(w, bindingLabels(bindings))[1], /空格/);
  w.ball.owner = 20;
  const swapped = rebind(bindings, "switchPlayer", "KeyQ");
  assert.match(matchMessage(w, bindingLabels(swapped))[1], /^Q /);
});

test("进攻和防守独立改键，改变射门键不改变抢断键", () => {
  const { keyboard, send } = input();
  keyboard.bind("shoot", "KeyQ");
  assert.equal(keyboard.bindings.tackle, "KeyK");
  send("keydown", "KeyQ"); send("keyup", "KeyQ");
  assert.equal(keyboard.poll("defence").shoot, false);
  send("keydown", "KeyK"); send("keyup", "KeyK");
  assert.equal(keyboard.poll("defence").shoot, true);
  send("keydown", "KeyK"); send("keyup", "KeyK");
  assert.equal(keyboard.poll("attack").shoot, false);
});

test("进攻和防守可以复用同一键，同一状态内仍避免冲突", () => {
  const { keyboard, send } = input();
  keyboard.bind("tackle", "KeyJ");
  assert.equal(keyboard.bindings.passShort, "KeyJ");
  assert.equal(keyboard.bindings.switchPlayer, "KeyK");
  send("keydown", "KeyJ"); send("keyup", "KeyJ");
  const defence = { ...keyboard.poll("defence") };
  assert.equal(defence.shoot, true); assert.equal(defence.passShort, false);
  send("keydown", "KeyJ"); send("keyup", "KeyJ");
  const attack = keyboard.poll("attack");
  assert.equal(attack.passShort, true); assert.equal(attack.shoot, false);
});

test("独立切人键从真实键盘事件驱动比赛，原短传键不再切人", () => {
  const { keyboard, send } = input(); keyboard.bind("switchPlayer", "KeyE");
  const w = createWorld(); w.phase = "playing"; w.restart = null;
  w.players = [w.players[6]!, w.players[9]!, w.players[20]!]; w.controlled = 0;
  w.players[0]!.pos = { x: 30, y: 34 }; w.players[1]!.pos = { x: 48, y: 34 };
  w.players[2]!.pos = { x: 50, y: 34 }; w.ball.owner = 2; w.ball.pos = { x: 49.1, y: 34 };
  send("keydown", "KeyJ"); send("keyup", "KeyJ");
  step(w, keyboard.poll("defence"), createTuning(), TICK_DT);
  assert.equal(w.controlled, 0);
  send("keydown", "KeyE"); send("keyup", "KeyE");
  step(w, keyboard.poll("defence"), createTuning(), TICK_DT);
  assert.equal(w.controlled, 1);
});


test("旧版共用按键自动迁移，保留用户原来的攻防操作习惯", () => {
  const legacy = { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", sprint: "ShiftLeft", passShort: "KeyQ", shoot: "KeyE", passThrough: "KeyL", passLong: "Space", pause: "Escape", reset: "KeyR", sound: "KeyM", debug: "F1" };
  const storage = { getItem: (key: string) => key.endsWith("v1") ? JSON.stringify(legacy) : null };
  const migrated = loadBindings(storage);
  assert.equal(migrated.passShort, "KeyQ"); assert.equal(migrated.switchPlayer, "KeyQ");
  assert.equal(migrated.shoot, "KeyE"); assert.equal(migrated.tackle, "KeyE");
  assert.equal(migrated.passLong, "Space");
  const independent = rebind(migrated, "switchPlayer", "KeyJ");
  assert.equal(independent.passShort, "KeyQ"); assert.equal(independent.switchPlayer, "KeyJ");
});

test("通用按键同时检查进攻与防守冲突，不留下重复动作", () => {
  const bindings = rebind({ ...DEFAULT_BINDINGS }, "sprint", "KeyJ");
  assert.equal(bindings.sprint, "KeyJ");
  assert.equal(bindings.passShort, "ShiftLeft"); assert.equal(bindings.switchPlayer, "ShiftLeft");
  assert.ok(CONTROLS.every((a, i) => CONTROLS.slice(i + 1).every(b =>
    !controlsConflict(a, b) || bindings[a] !== bindings[b])));
});

test("攻防切换时，新按的独立键不被之前长按的另一动作吞掉", () => {
  const { keyboard, send } = input(); keyboard.bind("tackle", "KeyE");
  const w = createWorld(), t = createTuning(); w.phase = "playing"; w.restart = null;
  w.players = [w.players[6]!, w.players[20]!]; w.controlled = 0;
  w.players[0]!.pos = { x: 40, y: 34 }; w.players[1]!.pos = { x: 45, y: 34 };
  w.ball.owner = 0; w.ball.pos = { x: 40.9, y: 34 };
  send("keydown", "KeyK"); step(w, keyboard.poll("attack"), t, TICK_DT);
  assert.equal(w.charge.kind, "shot");
  w.ball.owner = 1; w.ball.pos = { x: 44.1, y: 34 };
  send("keydown", "KeyE"); step(w, keyboard.poll("defence"), t, TICK_DT);
  assert.ok(w.players[0]!.tackleCooldown > 0, "仍按着射门键时，新按抢断也应当响应");
});
