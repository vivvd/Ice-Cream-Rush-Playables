import type { SaveSettings } from "./types";

type SfxName = "tap" | "success" | "fast" | "wrong" | "timeout" | "purchase" | "unlock";

export class GameAudio {
  private context?: AudioContext;
  private musicTimer?: number;
  private platformEnabled = true;
  private paused = false;
  private settings: SaveSettings = { music: true, sfx: true, reducedMotion: false };
  private musicStep = 0;

  setSettings(settings: SaveSettings): void {
    this.settings = { ...settings };
    this.syncMusic();
  }

  setPlatformEnabled(enabled: boolean): void {
    this.platformEnabled = enabled;
    if (!enabled) void this.context?.suspend();
    else if (!this.paused && this.context?.state === "suspended") void this.context.resume();
    this.syncMusic();
  }

  async unlock(): Promise<void> {
    if (!this.context) this.context = new AudioContext();
    if (this.platformEnabled && !this.paused && this.context.state === "suspended") await this.context.resume();
    this.syncMusic();
  }

  pause(): void {
    this.paused = true;
    this.stopMusic();
    void this.context?.suspend();
  }

  resume(): void {
    this.paused = false;
    if (this.platformEnabled) void this.context?.resume();
    this.syncMusic();
  }

  play(name: SfxName): void {
    if (!this.context || !this.platformEnabled || !this.settings.sfx || this.paused) return;
    const tones: Record<SfxName, [number, number, OscillatorType, number]> = {
      tap: [420, 520, "sine", 0.05],
      success: [520, 780, "triangle", 0.18],
      fast: [680, 1040, "sine", 0.24],
      wrong: [180, 120, "sawtooth", 0.18],
      timeout: [210, 90, "square", 0.28],
      purchase: [420, 880, "triangle", 0.28],
      unlock: [520, 1120, "sine", 0.42],
    };
    const [from, to, type, duration] = tones[name];
    this.tone(from, to, type, duration, name === "wrong" || name === "timeout" ? 0.07 : 0.05);
  }

  private tone(from: number, to: number, type: OscillatorType, duration: number, volume: number): void {
    const context = this.context;
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), context.currentTime + duration);
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  private syncMusic(): void {
    if (!this.context || !this.platformEnabled || !this.settings.music || this.paused) {
      this.stopMusic();
      return;
    }
    if (this.musicTimer === undefined) this.scheduleMusic();
  }

  private scheduleMusic(): void {
    if (!this.context || !this.platformEnabled || !this.settings.music || this.paused) return;
    const notes = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23];
    const note = notes[this.musicStep % notes.length]!;
    this.musicStep += 1;
    this.tone(note, note * 1.005, "sine", 0.7, 0.012);
    this.musicTimer = window.setTimeout(() => {
      this.musicTimer = undefined;
      this.scheduleMusic();
    }, 760);
  }

  private stopMusic(): void {
    if (this.musicTimer !== undefined) window.clearTimeout(this.musicTimer);
    this.musicTimer = undefined;
  }
}
