import { bindingLabels, DEFAULT_LABELS, movementLabel, type Bindings, type Control } from "../input/bindings.ts";
import type { Tuning } from "../tuning.ts";
import type { World } from "../sim/types.ts";
import { matchMessage, possessionPercent, type ScreenMode } from "./match.ts";

export class MatchShell {
  private readonly elements = new Map<string, HTMLElement>();
  private mode: ScreenMode = "menu";
  private keys: Bindings = DEFAULT_LABELS;

  constructor(actions: { start: () => void; pause: () => void; resume: () => void; menu: () => void; sound: () => void; switching: (mode: Tuning["ai"]["switching"]) => void }) {
    for (const id of ["start", "restart", "rematch"]) this.element(id).addEventListener("click", actions.start);
    this.element("pause").addEventListener("click", actions.pause);
    this.element("resume").addEventListener("click", actions.resume);
    this.element("back-menu").addEventListener("click", actions.menu);
    this.element("sound").addEventListener("click", actions.sound);
    for (const id of ["switching", "pause-switching"]) {
      this.element(id).addEventListener("change", (event) => {
        const select = event.target;
        if (!(select instanceof HTMLSelectElement)) return;
        const mode = select.value === "manual" ? "manual" : "assisted";
        for (const otherId of ["switching", "pause-switching"]) {
          const other = this.element(otherId);
          if (other instanceof HTMLSelectElement) other.value = mode;
        }
        actions.switching(mode);
      });
    }
  }

  element(id: string): HTMLElement {
    const cached = this.elements.get(id);
    if (cached) return cached;
    const el = document.getElementById(id);
    if (!el) throw new Error("Missing game element: " + id);
    this.elements.set(id, el);
    return el;
  }

  setBindings(bindings: Bindings): void {
    this.keys = bindingLabels(bindings);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-control]"))) {
      const control = el.dataset.control as Control;
      if (this.keys[control]) el.textContent = this.keys[control];
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-movement]"))) el.textContent = movementLabel(this.keys);
    for (const id of ["switching", "pause-switching"]) {
      const option = this.element(id).querySelector('option[value="manual"]');
      if (option) option.textContent = `手动 · 按 ${this.keys.switchPlayer} 切人`;
    }
    this.element("sound").title = `${this.keys.sound} 切换声音`;
    this.element("screen").setAttribute("aria-label", `足球球场，${movementLabel(this.keys)} 移动，${this.keys.passShort} 短传，${this.keys.shoot} 射门，${this.keys.passThrough} 直塞，${this.keys.passLong} 长传，${this.keys.switchPlayer} 切人，${this.keys.tackle} 抢断，${this.keys.slide} 滑铲，${this.keys.pause} 暂停`);
  }

  duration(): number {
    const select = this.element("duration");
    return select instanceof HTMLSelectElement ? Number(select.value) : 180;
  }

  text(id: string, value: string): void {
    const el = this.element(id);
    if (el.textContent !== value) el.textContent = value;
  }

  show(mode: ScreenMode, reason = "比赛和计时都已暂停。"): void {
    this.mode = mode;
    this.element("overlay").hidden = mode === "playing";
    this.element("welcome").hidden = mode !== "menu";
    this.element("pause-view").hidden = mode !== "paused";
    this.element("result-view").hidden = mode !== "results";
    this.element("screen").inert = mode !== "playing";
    const pause = this.element("pause");
    if (pause instanceof HTMLButtonElement) pause.disabled = mode !== "playing";
    this.text("pause-reason", reason);
    const focus = { menu: "start", playing: "screen", paused: "resume", results: "rematch" }[mode];
    this.element(focus).focus({ preventScroll: true });
  }

  sound(enabled: boolean): void {
    this.text("sound", enabled ? "声音 开" : "声音 关");
    this.element("sound").setAttribute("aria-pressed", String(enabled));
  }

  update(world: World): void {
    this.text("home-score", String(world.goals[0]));
    this.text("away-score", String(world.goals[1]));
    const remaining = Math.ceil(this.mode === "menu" ? this.duration() : world.clock);
    this.text("clock", String(Math.floor(remaining / 60)).padStart(2, "0") + ":" + String(remaining % 60).padStart(2, "0"));
    const message = this.mode === "menu" ? ["等待开场", "你是红队 · 向右进攻"]
      : this.mode === "paused" ? ["比赛暂停", "按 Esc 或点击继续比赛"]
      : matchMessage(world, this.keys);
    this.text("match-status", message[0]!);
    this.text("match-detail", message[1]!);
    const attacking = world.ball.owner !== null && world.players[world.ball.owner]?.team === 0;
    const keeper = world.ball.owner !== null && world.players[world.ball.owner]?.team === 0 && world.players[world.ball.owner]?.slot === 0;
    for (const [id, attackKey, defenceKey, attack, defend] of [
      ["j-hint", this.keys.passShort, this.keys.switchPlayer, "短传", "切人"],
      ["k-hint", this.keys.shoot, this.keys.tackle, keeper ? "大脚发球" : "射门", "抢断"],
      ["l-hint", this.keys.passThrough, this.keys.slide, "直塞", "铲球"],
    ]) {
      const el = this.element(id!);
      const html = this.mode === "menu"
        ? `<kbd>${attackKey}</kbd> ${attack} / <kbd>${defenceKey}</kbd> ${defend}`
        : `<kbd>${attacking ? attackKey : defenceKey}</kbd> ${attacking ? attack : defend}`;
      if (el.innerHTML !== html) el.innerHTML = html;
    }
  }

  results(world: World): void {
    const [home, away] = world.goals;
    this.text("result-title", home > away ? "拿下这一场。" : home < away ? "下一场，扳回来。" : "势均力敌，再来？");
    this.text("final-score", home + " : " + away);
    const [a, b] = world.matchStats;
    const possession = possessionPercent(world);
    const rows = [[a.shots, "射门", b.shots], [a.passes, "传球", b.passes], [a.tackles, "成功抢断", b.tackles], [possession[0] + "%", "控球率", possession[1] + "%"]];
    this.element("result-stats").replaceChildren(...rows.map((values) => {
      const row = document.createElement("tr");
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      return row;
    }));
    this.show("results");
  }
}
