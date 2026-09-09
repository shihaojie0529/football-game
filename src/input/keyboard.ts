import type { InputState } from "../sim/types.ts";
import { emptyInput } from "../sim/types.ts";
import { DEFAULT_BINDINGS, normalizeCode, rebind, type Bindings, type Control } from "./bindings.ts";

const ACTIONS: Control[] = ["shoot", "passShort", "passThrough", "passLong", "switchPlayer", "tackle", "slide"];
/** DOM 键盘事件统一转为动作；改键后同时清空长按与轻点缓冲。 */
export class Keyboard {
  private readonly down = new Set<string>();
  private readonly state: InputState = emptyInput();
  private readonly pressed = new Set<string>();
  private readonly pendingActions = new Set<string>();
  private enabled = true;
  private mapping: Bindings;

  constructor(target: Window = window, bindings: Bindings = { ...DEFAULT_BINDINGS }) {
    this.mapping = { ...bindings };
    target.addEventListener("keydown", e => {
      if (!this.enabled || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (typeof HTMLElement !== "undefined" && e.target instanceof HTMLElement && e.target.closest("input, select, textarea, [contenteditable=true]")) return;
      if (typeof HTMLElement !== "undefined" && e.target instanceof HTMLElement && e.target.closest("button") && (e.code === "Space" || e.code === "Enter")) return;
      const code = normalizeCode(e.code);
      if (!Object.values(this.mapping).includes(code)) return;
      e.preventDefault();
      if (e.repeat) return;
      this.down.add(code); this.pressed.add(code);
      if (ACTIONS.some(action => this.mapping[action] === code)) this.pendingActions.add(code);
    });
    target.addEventListener("keyup", e => { this.down.delete(normalizeCode(e.code)); });
    target.addEventListener("blur", () => this.clear());
  }
  get bindings(): Bindings { return { ...this.mapping }; }
  bind(control: Control, code: string): void { this.mapping = rebind(this.mapping, control, code); this.clear(); }
  restoreDefaults(): void { this.mapping = { ...DEFAULT_BINDINGS }; this.clear(); }
  setEnabled(enabled: boolean): void { this.enabled = enabled; this.clear(); }
  poll(context: "attack" | "defence" = "attack"): InputState {
    const held = (control: Control) => this.down.has(this.mapping[control]);
    const action = (control: Control) => held(control) || this.pendingActions.has(this.mapping[control]);
    const s = this.state;
    s.moveX = Number(held("right")) - Number(held("left"));
    s.moveY = Number(held("down")) - Number(held("up"));
    s.sprint = held("sprint");
    s.shoot = action(context === "attack" ? "shoot" : "tackle");
    s.passShort = action(context === "attack" ? "passShort" : "switchPlayer");
    s.passThrough = action(context === "attack" ? "passThrough" : "slide");
    s.passLong = context === "attack" && action("passLong");
    const pressed = (control: Control) => this.pendingActions.has(this.mapping[control]);
    s.actionPressed = {
      shot: pressed(context === "attack" ? "shoot" : "tackle"),
      short: pressed(context === "attack" ? "passShort" : "switchPlayer"),
      through: pressed(context === "attack" ? "passThrough" : "slide"),
      long: context === "attack" && pressed("passLong"),
    };
    this.pendingActions.clear();
    return s;
  }
  consumePress(control: Control): boolean {
    const code = this.mapping[control];
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code); return true;
  }
  clearPresses(): void { this.pressed.clear(); }
  clear(): void { this.down.clear(); this.pressed.clear(); this.pendingActions.clear(); }
}
