import type { SaveSettings } from "./types";

type SfxName = "tap" | "success" | "fast" | "wrong" | "timeout" | "purchase" | "unlock";
type AudioBus = "music" | "sfx";

const MUSIC_STEP_MS = 300;

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
  private noiseBuffer?: AudioBuffer;

  setSettings(settings: SaveSettings): void {
    this.settings = { ...settings };
    this.syncBusLevels();
    this.syncMusic();
  }

  setPlatformEnabled(enabled: boolean): void {
    this.platformEnabled = enabled;
    if (!enabled) void this.context?.suspend();
    else if (!this.paused && this.context?.state === "suspended") void this.context.resume();
    this.syncBusLevels();
    this.syncMusic();
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.createAudioGraph();
    }
    if (this.platformEnabled && !this.paused && this.context.state === "suspended") await this.context.resume();
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
    if (this.platformEnabled) void this.context?.resume();
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
    if (!context || !this.platformEnabled || !this.settings.sfx || this.paused) return;
    const now = context.currentTime + 0.006;

    switch (name) {
      case "tap":
        this.voice(540, 820, "triangle", now, 0.06, 0.09, "sfx");
        this.voice(1080, 760, "sine", now + 0.018, 0.045, 0.035, "sfx");
        break;
      case "success":
        this.arpeggio([523.25, 659.25, 783.99, 1046.5], now, 0.052, 0.18, 0.105, "triangle");
        this.percussion(now + 0.16, 0.08, 0.055, 5200, "sfx");
        break;
      case "fast":
        this.arpeggio([659.25, 783.99, 987.77, 1318.51], now, 0.052, 0.19, 0.105, "sine");
        this.arpeggio([987.77, 1174.66, 1567.98], now + 0.11, 0.045, 0.14, 0.045, "triangle");
        this.percussion(now + 0.22, 0.1, 0.06, 7000, "sfx");
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
        this.percussion(now + 0.04, 0.055, 0.05, 6400, "sfx");
        break;
      case "unlock":
        this.arpeggio([523.25, 659.25, 783.99, 987.77, 1318.51], now, 0.075, 0.34, 0.1, "triangle");
        this.voice(261.63, 263, "sine", now, 0.72, 0.05, "sfx");
        this.voice(392, 396, "sine", now + 0.2, 0.56, 0.045, "sfx");
        this.percussion(now + 0.31, 0.13, 0.065, 7200, "sfx");
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

  private percussion(
    startsAt: number,
    duration: number,
    volume: number,
    cutoff: number,
    bus: AudioBus,
  ): void {
    const context = this.context;
    const destination = bus === "music" ? this.musicGain : this.sfxGain;
    if (!context || !destination) return;
    if (!this.noiseBuffer) {
      const sampleCount = Math.max(1, Math.floor(context.sampleRate * 0.35));
      const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 0x1ce5cafe;
      for (let index = 0; index < data.length; index += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[index] = (seed / 0xffffffff) * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(cutoff, startsAt);
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(volume, startsAt + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
    source.connect(filter).connect(gain).connect(destination);
    source.start(startsAt);
    source.stop(startsAt + duration + 0.01);
  }

  private syncMusic(): void {
    if (!this.context || !this.platformEnabled || !this.settings.music || this.paused) {
      this.stopMusic();
      return;
    }
    if (this.musicTimer === undefined) this.scheduleMusic();
  }

  private scheduleMusic(): void {
    const context = this.context;
    if (!context || !this.platformEnabled || !this.settings.music || this.paused) return;
    // Original candy-parlor theme: two 16-step phrases with room for the SFX mix.
    const melody = [
      659.25, 783.99, 880, 783.99, 659.25, 587.33, 523.25, 0,
      698.46, 880, 987.77, 880, 698.46, 659.25, 587.33, 0,
      659.25, 783.99, 1046.5, 987.77, 880, 783.99, 659.25, 0,
      587.33, 698.46, 880, 783.99, 659.25, 587.33, 523.25, 0,
    ];
    const chordRoots = [261.63, 220, 174.61, 196, 261.63, 220, 196, 261.63];
    const step = this.musicStep % melody.length;
    const startsAt = context.currentTime + 0.018;
    const melodyNote = melody[step]!;
    if (melodyNote > 0) {
      this.voice(melodyNote, melodyNote * 1.002, "triangle", startsAt, 0.22, 0.064, "music");
      this.voice(melodyNote * 2, melodyNote * 1.995, "sine", startsAt + 0.012, 0.13, 0.012, "music");
    }
    if (step % 4 === 0) {
      const root = chordRoots[Math.floor(step / 4) % chordRoots.length]!;
      this.voice(root / 2, root / 2 * .998, "sine", startsAt, 0.72, 0.075, "music");
      this.voice(root, root * 1.002, "triangle", startsAt + 0.01, 0.58, 0.027, "music");
      this.voice(root * 1.25, root * 1.25, "sine", startsAt + 0.02, 0.54, 0.018, "music");
      this.voice(118, 52, "sine", startsAt, 0.12, 0.06, "music");
    }
    if (step % 2 === 1) {
      this.percussion(startsAt, 0.045, 0.018, 7200, "music");
    }
    if (step % 8 === 6) {
      this.percussion(startsAt, 0.1, 0.026, 4200, "music");
    }
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
