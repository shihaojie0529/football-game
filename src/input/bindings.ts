export const CONTROL_NAMES = {
  up: "向上移动", down: "向下移动", left: "向左移动", right: "向右移动", sprint: "冲刺",
  passShort: "短传", shoot: "射门 / 门将大脚", passThrough: "直塞",
  switchPlayer: "切换球员", tackle: "站立抢断", slide: "滑铲",
  passLong: "长传", pause: "暂停 / 继续", reset: "重新开赛", sound: "声音开关", debug: "调试面板",
} as const;
export type Control = keyof typeof CONTROL_NAMES;
export type Bindings = Record<Control, string>;
export const CONTROLS = Object.keys(CONTROL_NAMES) as Control[];
export const DEFAULT_BINDINGS: Readonly<Bindings> = {
  up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", sprint: "ShiftLeft",
  passShort: "KeyJ", shoot: "KeyK", passThrough: "KeyL", passLong: "KeyI",
  switchPlayer: "KeyJ", tackle: "KeyK", slide: "KeyL",
  pause: "Escape", reset: "KeyR", sound: "KeyM", debug: "F1",
};
const STORAGE_KEY = "matchday.keybindings.v2";
const LEGACY_STORAGE_KEY = "matchday.keybindings.v1";
export type ControlGroup = "attack" | "defence" | "common";
export function controlGroup(control: Control): ControlGroup {
  if (["passShort", "shoot", "passThrough", "passLong"].includes(control)) return "attack";
  if (["switchPlayer", "tackle", "slide"].includes(control)) return "defence";
  return "common";
}
export function controlsConflict(a: Control, b: Control): boolean {
  return controlGroup(a) === "common" || controlGroup(b) === "common" || controlGroup(a) === controlGroup(b);
}
function validBindings(candidate: Record<string, unknown>): boolean {
  return CONTROLS.every(key => typeof candidate[key] === "string" && supportedCode(candidate[key])) &&
    candidate.pause === "Escape" && CONTROLS.every((a, i) => CONTROLS.slice(i + 1).every(b =>
      !controlsConflict(a, b) || candidate[a] !== candidate[b]));
}
export function normalizeCode(code: string): string { return code === "ShiftRight" ? "ShiftLeft" : code; }
export function supportedCode(code: string): boolean {
  return /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|ShiftLeft|Escape|F1)$/.test(code);
}
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return ({ ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "空格", ShiftLeft: "Shift", Escape: "Esc" } as Record<string, string>)[code] ?? code;
}
export function bindingLabels(bindings: Readonly<Bindings>): Bindings {
  return Object.fromEntries(CONTROLS.map(control => [control, keyLabel(bindings[control])])) as Bindings;
}
export const DEFAULT_LABELS = bindingLabels(DEFAULT_BINDINGS);
export function movementLabel(labels: Bindings): string { return [labels.up, labels.left, labels.down, labels.right].join(" "); }
export function rebind(bindings: Bindings, control: Control, code: string): Bindings {
  code = normalizeCode(code);
  if (!supportedCode(code)) throw new Error("请使用字母、数字、方向键、空格、Shift 或 F1。");
  // Esc 固定保留给暂停及关闭设置，避免失去退出方式。
  if ((code === "Escape") !== (control === "pause")) throw new Error("Esc 保留为暂停 / 返回键。");
  const others = CONTROLS.filter(key => key !== control && controlsConflict(control, key) && bindings[key] === code);
  const next = { ...bindings, [control]: code };
  for (const other of others) next[other] = bindings[control];
  return next;
}
export function loadBindings(storage?: Pick<Storage, "getItem">): Bindings {
  try {
    const source = storage ?? globalThis.localStorage;
    const current = source?.getItem(STORAGE_KEY);
    const raw = current ?? source?.getItem(LEGACY_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (typeof value === "object" && value !== null) {
      const candidate = { ...value } as Record<string, unknown>;
      if (current == null) {
        candidate.switchPlayer = candidate.passShort;
        candidate.tackle = candidate.shoot;
        candidate.slide = candidate.passThrough;
      }
      if (validBindings(candidate)) {
        return Object.fromEntries(CONTROLS.map(key => [key, candidate[key]])) as Bindings;
      }
    }
  } catch { /* 损坏或不可用的本地存储不妨碍开始比赛。 */ }
  return { ...DEFAULT_BINDINGS };
}
export function saveBindings(bindings: Bindings, storage?: Pick<Storage, "setItem">): boolean {
  try { (storage ?? globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify(bindings)); return true; }
  catch { return false; }
}
