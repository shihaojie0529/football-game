import type { World } from "../sim/types.ts";

/** 音效只观察比赛事件。用户点击开始后才创建音频上下文，离线也能播放。 */
export class MatchAudio {
  enabled = true;
  private context: AudioContext | null = null;
  private volume: GainNode | null = null;
  private last = { goals: 0, kicks: 0, tackles: 0, phase: "" };

  unlock(): void {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      if (!this.volume) {
        this.volume = this.context.createGain();
        this.volume.gain.value = 0.16;
        this.volume.connect(this.context.destination);
      }
      void this.context.resume().catch(() => {});
    } catch { /* 不支持音频时，比赛仍可正常进行。 */ }
  }

  toggle(): void {
    this.enabled = !this.enabled;
    if (this.volume && this.context) this.volume.gain.setValueAtTime(this.enabled ? 0.16 : 0, this.context.currentTime);
    if (this.enabled) this.unlock();
  }

  sync(world: World): void {
    this.last = { goals: world.goals[0] + world.goals[1], kicks: world.shots + world.passes, tackles: world.tacklesWon, phase: world.phase };
  }

  update(world: World): void {
    if (world.goals[0] + world.goals[1] > this.last.goals) {
      for (const [i, frequency] of [392, 494, 587, 784].entries()) this.tone(frequency, 0.22, i * 0.13, "triangle");
    } else if (world.phase === "fullTime" && this.last.phase !== "fullTime") {
      this.whistle(); this.tone(1700, 0.3, 0.3);
    } else if (world.phase === "restart" && this.last.phase === "playing") {
      this.whistle();
    } else if (world.shots + world.passes > this.last.kicks || world.tacklesWon > this.last.tackles) {
      this.tone(130, 0.07, 0, "triangle", 45);
    }
    this.sync(world);
  }

  whistle(): void { this.tone(1850, 0.16); }

  private tone(frequency: number, duration: number, delay = 0, type: OscillatorType = "sine", end = frequency): void {
    const ctx = this.context;
    if (!this.enabled || !ctx || !this.volume || ctx.state !== "running") return;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(end, start + duration);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(0.6, start + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.volume);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }
}
