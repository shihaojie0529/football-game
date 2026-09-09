import "./ui/style.css";
import { createTuningGui } from "./debug/gui.ts";
import { loadBindings, keyLabel } from "./input/bindings.ts";
import { KeySettings } from "./ui/key-settings.ts";
import { Keyboard } from "./input/keyboard.ts";
import { TICK_DT } from "./sim/constants.ts";
import { step } from "./sim/step.ts";
import { createWorld, resetKickoff } from "./sim/world.ts";
import { defenderSelection } from "./render/control-view.ts";
import type { DefenderSelection } from "./sim/switching.ts";
import { Camera } from "./render/camera.ts";
import { render } from "./render/index.ts";
import { Screen } from "./render/screen.ts";
import { createTuning } from "./tuning.ts";
import { MatchShell } from "./ui/shell.ts";
import { MatchAudio } from "./audio/match-audio.ts";
import type { ScreenMode } from "./ui/match.ts";

const canvas = document.getElementById("screen");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#screen canvas not found");

const screen = new Screen(canvas);
const tuning = createTuning();
const world = createWorld();
const camera = new Camera();
const keyboard = new Keyboard(window, loadBindings());
const audio = new MatchAudio();
let mode: ScreenMode = "menu";
let showDebug = false;
let fps = 60;
let accumulator = 0;
let last = performance.now();
let selection: DefenderSelection | undefined;

const shell = new MatchShell({
  start: () => startMatch(),
  pause: () => pauseMatch(),
  resume: resumeMatch,
  menu: () => {
    resetKickoff(world, true, shell.duration());
    camera.snapTo(world.ball.pos.x, world.ball.pos.y);
    changeMode("menu");
  },
  sound: toggleSound,
  switching: (mode) => {
    tuning.ai.switching = mode;
    world.switchLock = tuning.ai.manualSwitchLock;
    world.switchLooseUsed = false;
  },
});

shell.setBindings(keyboard.bindings);
new KeySettings(keyboard, () => shell.setBindings(keyboard.bindings), () => pauseMatch());

function clearActions(): void {
  keyboard.clear();
  world.charge.kind = null;
  world.charge.time = 0;
  world.actionWasHeld = { shot: false, short: false, through: false, long: false };
  accumulator = 0;
}

function changeMode(next: ScreenMode, reason?: string): void {
  clearActions();
  mode = next;
  shell.show(next, reason);
}

function startMatch(length = shell.duration()): void {
  tuning.rules.matchLength = length;
  resetKickoff(world, true, length);
  camera.snapTo(world.ball.pos.x, world.ball.pos.y);
  audio.unlock();
  audio.sync(world);
  audio.whistle();
  changeMode("playing");
}

function pauseMatch(reason?: string): void {
  if (mode === "playing") changeMode("paused", reason);
}

function resumeMatch(): void {
  if (mode !== "paused") return;
  audio.unlock();
  changeMode("playing");
}

function toggleParameters(): void {
  const panel = shell.element("panel");
  panel.hidden = !panel.hidden;
  shell.element("open-player-settings").setAttribute("aria-expanded", String(!panel.hidden));
}
shell.element("open-player-settings").addEventListener("click", toggleParameters);
shell.element("close-player-settings").addEventListener("click", toggleParameters);

function toggleSound(): void {
  audio.toggle();
  shell.sound(audio.enabled);
}

createTuningGui(tuning, () => startMatch(tuning.rules.matchLength));
camera.snapTo(world.ball.pos.x, world.ball.pos.y);
audio.sync(world);
shell.show("menu");

window.addEventListener("blur", () => pauseMatch("你离开了比赛窗口，已为你自动暂停。"));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseMatch("你切换了标签页，已为你自动暂停。");
});

/** 菜单与暂停只停调度；sim 仍是固定 60Hz 的纯数据模拟。 */
function frame(now: number): void {
  const frameDt = Math.min((now - last) / 1000, 0.25);
  last = now;
  fps += (1 / Math.max(frameDt, 1e-4) - fps) * 0.1;

  if (keyboard.consumePress("pause")) {
    if (mode === "playing") pauseMatch();
    else if (mode === "paused") resumeMatch();
  }
  if (keyboard.consumePress("reset")) {
    if (mode === "playing") pauseMatch("重新开赛会清除当前比分。也可以继续这场比赛。");
    else if (mode === "paused" || mode === "results") startMatch();
  }
  if (keyboard.consumePress("sound")) toggleSound();
  if (keyboard.consumePress("debug")) {
    showDebug = !showDebug;
    shell.element("panel").hidden = !showDebug;
    shell.element("open-player-settings").setAttribute("aria-expanded", String(showDebug));
  }
  keyboard.clearPresses();

  if (mode === "playing") {
    accumulator += frameDt;
    while (accumulator >= TICK_DT) {
      step(world, keyboard.poll(world.ball.owner === world.controlled ? "attack" : "defence"), tuning, TICK_DT, selection);
      audio.update(world);
      accumulator -= TICK_DT;
      if (world.phase === "fullTime") {
        clearActions();
        mode = "results";
        shell.results(world);
        break;
      }
    }
    camera.update(world, tuning, frameDt);
  }

  selection = defenderSelection(world, camera, tuning);
  render(screen.ctx, world, camera, tuning, mode === "playing" ? accumulator / TICK_DT : 1, { fps, showDebug, shortKey: keyLabel(keyboard.bindings.passShort), switchKey: keyLabel(keyboard.bindings.switchPlayer) }, selection);
  shell.update(world);
  requestAnimationFrame(frame);
}

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = {
    world, tuning, camera, step, TICK_DT,
    get mode() { return mode; },
  };
}
requestAnimationFrame(frame);
