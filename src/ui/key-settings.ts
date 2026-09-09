import { CONTROLS, CONTROL_NAMES, controlGroup, keyLabel, saveBindings, type Control, type ControlGroup } from "../input/bindings.ts";
import type { Keyboard } from "../input/keyboard.ts";

/** 原生模态框负责焦点限制，录键时不向比赛输入任何事件。 */
export class KeySettings {
  private readonly dialog: HTMLDialogElement;
  private readonly status: HTMLElement;
  private readonly buttons = new Map<Control, HTMLButtonElement>();
  private waiting: Control | null = null;
  private group: ControlGroup = "attack";
  private readonly tabs = new Map<ControlGroup, HTMLButtonElement>();
  private opener: HTMLElement | null = null;
  constructor(private keyboard: Keyboard, private changed: () => void, private pause: () => void) {
    this.dialog = document.getElementById("key-settings") as HTMLDialogElement;
    this.status = document.getElementById("key-settings-status")!;
    const list = document.getElementById("key-settings-list")!;
    const tabs = document.getElementById("key-settings-tabs")!;
    for (const [group, label] of [["attack", "进攻"], ["defence", "防守"], ["common", "通用"]] as const) {
      const button = document.createElement("button"); button.textContent = label;
      button.addEventListener("click", () => { this.group = group; this.waiting = null; this.refresh(); this.instructions(); });
      this.tabs.set(group, button); tabs.append(button);
    }
    for (const control of CONTROLS) {
      const row = document.createElement("div"); row.className = "binding-row";
      const label = document.createElement("span"); label.textContent = CONTROL_NAMES[control];
      const button = document.createElement("button"); button.type = "button";
      button.setAttribute("aria-label", `修改${CONTROL_NAMES[control]}按键`);
      if (control === "pause") { button.disabled = true; button.title = "Esc 固定保留为暂停 / 返回"; }
      button.addEventListener("click", () => {
        this.waiting = control; this.refresh(); this.status.textContent = `请按下「${CONTROL_NAMES[control]}」的新按键，Esc 取消。`;
      });
      this.buttons.set(control, button); row.append(label, button); list.append(row);
    }
    document.getElementById("open-key-settings")!.addEventListener("click", () => this.open());
    document.getElementById("close-key-settings")!.addEventListener("click", () => this.dialog.close());
    document.getElementById("reset-key-settings")!.addEventListener("click", () => {
      this.waiting = null; keyboard.restoreDefaults(); this.commit("已恢复默认按键");
    });
    this.dialog.addEventListener("cancel", event => {
      if (this.waiting) { event.preventDefault(); this.cancelCapture(); }
    });
    this.dialog.addEventListener("close", () => {
      this.waiting = null; keyboard.setEnabled(true); this.opener?.focus();
    });
    window.addEventListener("blur", () => { if (this.waiting) this.cancelCapture(); });
    window.addEventListener("keydown", event => {
      if (!this.dialog.open || !this.waiting) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.key === "Escape") { this.cancelCapture(); return; }
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
        this.status.textContent = "请按单个按键，不使用系统组合键。"; return;
      }
      try {
        const name = CONTROL_NAMES[this.waiting];
        const previous = this.keyboard.bindings;
        this.keyboard.bind(this.waiting, event.code);
        const swapped = CONTROLS.filter(control => control !== this.waiting && previous[control] !== this.keyboard.bindings[control]);
        this.waiting = null;
        this.commit(`${name}已修改${swapped.length ? `，与「${swapped.map(control => CONTROL_NAMES[control]).join("、")}」互换按键` : ""}`);
      } catch (error) { this.status.textContent = error instanceof Error ? error.message : "这个按键暂不支持。"; }
    }, { capture: true });
    this.refresh();
  }
  private open(): void {
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.pause(); this.keyboard.setEnabled(false); this.waiting = null;
    this.instructions();
    this.refresh(); this.dialog.showModal();
  }
  private cancelCapture(): void { this.waiting = null; this.refresh(); this.status.textContent = "已取消此次修改。"; }
  private commit(message: string): void {
    const saved = saveBindings(this.keyboard.bindings);
    this.refresh(); this.changed();
    this.status.textContent = message + (saved ? "，已自动保存。" : "。浏览器无法保存，当前页面内仍然有效。");
  }
  private instructions(): void {
    this.status.textContent = "进攻与防守分别保存，可使用相同按键。同一状态内的重复键自动互换；通用键对攻防均生效。";
  }
  private refresh(): void {
    for (const [group, button] of this.tabs) button.setAttribute("aria-pressed", String(group === this.group));
    for (const [control, button] of this.buttons) {
      button.parentElement!.hidden = controlGroup(control) !== this.group;
      button.textContent = this.waiting === control ? "请按新键…" : keyLabel(this.keyboard.bindings[control]);
      button.setAttribute("aria-label", `修改${CONTROL_NAMES[control]}按键，当前${button.textContent}`);
      button.classList.toggle("listening", this.waiting === control);
    }
  }
}
