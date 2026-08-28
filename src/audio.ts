import type { SaveSettings } from "./types";

type SfxName = "tap" | "success" | "fast" | "wrong" | "timeout" | "purchase" | "unlock";
type AudioBus = "music" | "sfx";

const MUSIC_STEP_MS = 340;

// A 44-second original café-pop arrangement. Eight distinct eight-bar
// sections avoid the short, mechanical loop a one-phrase sequencer creates.
const CAFE_SCALE = [261.63, 293.66, 329.63, 392, 440, 493.88, 523.25, 587.33, 659.25, 783.99, 880] as const;
const CAFE_MELODY = [
  [4, 5, 6, 7, 6, 5, 4, -1, 3, 4, 5, 6, 5, 4, 3, -1],
  [2, 3, 4, 5, 4, 3, 2, -1, 1, 2, 3, 4, 5, 4, 3, -1],
  [5, 6, 7, 8, 7, 6, 5, -1, 4, 5, 6, 7, 8, 7, 6, -1],
  [4, 3, 2, 3, 4, 5, 4, -1, 2, 3, 4, 5, 4, 3, 2, -1],
  [6, 7, 8, 9, 8, 7, 6, -1, 5, 6, 7, 8, 7, 6, 5, -1],
  [4, 5, 6, 7, 6, 5, 4, -1, 3, 5, 7, 8, 7, 5, 4, -1],
  [3, 4, 5, 6, 5, 4, 3, -1, 2, 4, 6, 7, 6, 4, 3, -1],
  [5, 6, 8, 9, 8, 6, 5, -1, 4, 5, 6, 7, 6, 5, 4, -1],
] as const;
const CAFE_CHORDS = [
  [261.63, 329.63, 392], [220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66],
  [261.63, 329.63, 392], [220, 261.63, 329.63], [293.66, 369.99, 440], [196, 246.94, 293.66],
] as const;

export class GameAudio {
  private context?: AudioContext;
  private masterGain?: GainNode;
  private musicGain?: GainNode;
  private sfxGain?: GainNode;
  private musicTimer?: number;
  private platformEnabled = true;
  private paused = false;
  private settings: SaveSettings = { music: true, sfx: true, reducedMotion: false };
  private musicStep = 0;

  setSettings(settings: SaveSettings): void {
    this.settings = { ...settings };
    this.syncBusLevels();
    this.syncMusic();
  }

  setPlatformEnabled(enabled: boolean): void {
    this.platformEnabled = enabled;
    if (!enabled) void this.context?.suspend();
    else if (!this.paused && this.context?.state === "suspended") {
      void this.context.resume().then(() => {
        this.syncBusLevels();
        this.syncMusic();
      }).catch(() => undefined);
    }
    this.syncBusLevels();
    this.syncMusic();
  }

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.createAudioGraph();
    }
    // This must stay synchronous with the input event. Some mobile WebViews
    // reject audio that is started only after an awaited microtask.
    if (this.platformEnabled && !this.paused && this.context.state === "suspended") {
      void this.context.resume().then(() => {
        this.syncBusLevels();
        this.syncMusic();
      }).catch(() => undefined);
    }
    this.syncBusLevels();
    this.syncMusic();
  }

  pause(): void {
    this.paused = true;
    this.stopMusic();
    void this.context?.suspend();
  }

  resume(): void {
    this.paused = false;
    if (this.platformEnabled && this.context?.state === "suspended") {
      void this.context.resume().then(() => {
        this.syncBusLevels();
        this.syncMusic();
      }).catch(() => undefined);
    }
    this.syncBusLevels();
    this.syncMusic();
  }

  debugState(): { unlocked: boolean; musicLoop: boolean; paused: boolean; platformEnabled: boolean; music: boolean; sfx: boolean } {
    return {
      unlocked: Boolean(this.context),
      musicLoop: this.musicTimer !== undefined,
      paused: this.paused,
      platformEnabled: this.platformEnabled,
      music: this.settings.music,
      sfx: this.settings.sfx,
    };
  }

  play(name: SfxName): void {
    const context = this.context;
    if (!context || context.state !== "running" || !this.platformEnabled || !this.settings.sfx || this.paused) return;
    const now = context.currentTime + 0.006;

    switch (name) {
      case "tap":
        this.voice(540, 820, "triangle", now, 0.06, 0.09, "sfx");
        this.voice(1080, 760, "sine", now + 0.018, 0.045, 0.035, "sfx");
        break;
      case "success":
        this.arpeggio([523.25, 659.25, 783.99, 1046.5], now, 0.052, 0.18, 0.105, "triangle");
        this.voice(1318.51, 1320, "sine", now + 0.17, 0.11, 0.025, "sfx");
        break;
      case "fast":
        this.arpeggio([659.25, 783.99, 987.77, 1318.51], now, 0.052, 0.19, 0.105, "sine");
        this.arpeggio([987.77, 1174.66, 1567.98], now + 0.11, 0.045, 0.14, 0.045, "triangle");
        this.voice(1760, 1762, "sine", now + 0.23, 0.1, 0.026, "sfx");
        break;
      case "wrong":
        this.voice(245, 118, "sawtooth", now, 0.24, 0.11, "sfx");
        this.voice(174, 96, "square", now + 0.035, 0.19, 0.04, "sfx");
        break;
      case "timeout":
        this.voice(196, 130.81, "square", now, 0.24, 0.075, "sfx");
        this.voice(130.81, 82.41, "square", now + 0.23, 0.34, 0.065, "sfx");
        break;
      case "purchase":
        this.voice(920, 1240, "triangle", now, 0.075, 0.08, "sfx");
        this.voice(1220, 1760, "sine", now + 0.07, 0.12, 0.085, "sfx");
        this.voice(1480, 1482, "sine", now + 0.13, 0.08, 0.018, "sfx");
        break;
      case "unlock":
        this.arpeggio([523.25, 659.25, 783.99, 987.77, 1318.51], now, 0.075, 0.34, 0.1, "triangle");
        this.voice(261.63, 263, "sine", now, 0.72, 0.05, "sfx");
        this.voice(392, 396, "sine", now + 0.2, 0.56, 0.045, "sfx");
        this.voice(1567.98, 1570, "sine", now + 0.33, 0.15, 0.026, "sfx");
        break;
    }
  }

  private createAudioGraph(): void {
    const context = this.context;
    if (!context) return;
    const master = context.createGain();
    const music = context.createGain();
    const sfx = context.createGain();
    master.gain.value = 0.72;
    music.connect(master);
    sfx.connect(master);
    master.connect(context.destination);
    this.masterGain = master;
    this.musicGain = music;
    this.sfxGain = sfx;
  }

  private syncBusLevels(): void {
    const context = this.context;
    if (!context) return;
    const audible = this.platformEnabled && !this.paused;
    this.setBusGain(this.masterGain, audible ? 0.72 : 0);
    this.setBusGain(this.musicGain, audible && this.settings.music ? 0.34 : 0);
    this.setBusGain(this.sfxGain, audible && this.settings.sfx ? 0.9 : 0);
  }

  private setBusGain(node: GainNode | undefined, value: number): void {
    const context = this.context;
    if (!context || !node) return;
    node.gain.cancelScheduledValues(context.currentTime);
    node.gain.setTargetAtTime(value, context.currentTime, 0.018);
  }

  private arpeggio(
    notes: number[],
    startAt: number,
    spacing: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void {
    notes.forEach((note, index) => {
      this.voice(note, note * 1.008, type, startAt + spacing * index, duration, volume, "sfx");
    });
  }

  private voice(
    from: number,
    to: number,
    type: OscillatorType,
    startsAt: number,
    duration: number,
    volume: number,
    bus: AudioBus,
  ): void {
    const context = this.context;
    const destination = bus === "music" ? this.musicGain : this.sfxGain;
    if (!context || !destination) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, from), startsAt);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), startsAt + duration);
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(volume, startsAt + Math.min(0.018, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
    oscillator.connect(gain).connect(destination);
    oscillator.start(startsAt);
    oscillator.stop(startsAt + duration + 0.01);
  }

  private syncMusic(): void {
    if (!this.context || this.context.state !== "running" || !this.platformEnabled || !this.settings.music || this.paused) {
      this.stopMusic();
      return;
    }
    if (this.musicTimer === undefined) this.scheduleMusic();
  }

  private scheduleMusic(): void {
    const context = this.context;
    if (!context || context.state !== "running" || !this.platformEnabled || !this.settings.music || this.paused) return;
    const section = Math.floor(this.musicStep / 16) % CAFE_MELODY.length;
    const step = this.musicStep % 16;
    const startsAt = context.currentTime + 0.018;
    const melodyIndex = CAFE_MELODY[section]![step]!;
    if (melodyIndex >= 0) {
      const melodyNote = CAFE_SCALE[melodyIndex as number]!;
      this.voice(melodyNote, melodyNote * 1.001, "triangle", startsAt, 0.25, 0.055, "music");
      this.voice(melodyNote * 2, melodyNote * 1.998, "sine", startsAt + 0.014, 0.16, 0.009, "music");
    }
    const chord = CAFE_CHORDS[(section + Math.floor(step / 4)) % CAFE_CHORDS.length]!;
    if (step % 4 === 0) {
      this.voice(chord[0] / 2, chord[0] / 2, "sine", startsAt, 1.08, 0.044, "music");
      this.voice(chord[0], chord[0] * 1.001, "triangle", startsAt + 0.01, 0.76, 0.014, "music");
      this.voice(chord[1], chord[1] * 1.001, "triangle", startsAt + 0.018, 0.72, 0.013, "music");
      this.voice(chord[2], chord[2] * 1.001, "sine", startsAt + 0.026, 0.68, 0.011, "music");
    }
    // A light off-beat sparkle supplies the cheerful pulse without noise hits.
    if (step % 4 === 2) this.voice(chord[2] * 2, chord[2] * 2.002, "triangle", startsAt, 0.075, 0.011, "music");
    if (step % 8 === 6) this.voice(1046.5, 1047.5, "sine", startsAt, 0.08, 0.006, "music");
    this.musicStep += 1;
    this.musicTimer = window.setTimeout(() => {
      this.musicTimer = undefined;
      this.scheduleMusic();
    }, MUSIC_STEP_MS);
  }

  private stopMusic(): void {
    if (this.musicTimer !== undefined) window.clearTimeout(this.musicTimer);
    this.musicTimer = undefined;
  }
}
