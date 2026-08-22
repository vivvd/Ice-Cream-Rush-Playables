import type { SaveV5 } from "./types";

interface PlatformCallbacks {
  onAudioChange: (enabled: boolean) => void;
  onPause: () => void;
  onResume: () => void;
}

export class YouTubePlatform {
  private loaded = false;
  private memorySave = "";
  private unsubscribers: Array<() => void> = [];

  get inPlayables(): boolean {
    return Boolean(window.ytgame?.IN_PLAYABLES_ENV);
  }

  firstFrameReady(): void {
    try {
      window.ytgame?.game?.firstFrameReady?.();
    } catch {
      this.warn();
    }
  }

  register(callbacks: PlatformCallbacks): boolean {
    const audioEnabled = this.audioEnabled();
    callbacks.onAudioChange(audioEnabled);
    try {
      const audioOff = window.ytgame?.system?.onAudioEnabledChange?.(callbacks.onAudioChange);
      const pauseOff = window.ytgame?.system?.onPause?.(callbacks.onPause);
      const resumeOff = window.ytgame?.system?.onResume?.(callbacks.onResume);
      for (const off of [audioOff, pauseOff, resumeOff]) {
        if (typeof off === "function") this.unsubscribers.push(off);
      }
    } catch {
      this.warn();
    }
    return audioEnabled;
  }

  audioEnabled(): boolean {
    try {
      return window.ytgame?.system?.isAudioEnabled?.() ?? true;
    } catch {
      this.warn();
      return false;
    }
  }

  async loadData(): Promise<string> {
    try {
      const loader = window.ytgame?.game?.loadData;
      const data = loader ? await loader() : this.memorySave;
      this.loaded = true;
      return typeof data === "string" ? data : "";
    } catch {
      this.loaded = true;
      this.warn();
      return "";
    }
  }

  gameReady(): void {
    try {
      window.ytgame?.game?.gameReady?.();
    } catch {
      this.warn();
    }
  }

  async saveData(save: SaveV5): Promise<void> {
    if (!this.loaded) throw new Error("saveData called before loadData completed");
    const serialized = JSON.stringify(save);
    try {
      if (window.ytgame?.game?.saveData) await window.ytgame.game.saveData(serialized);
      else this.memorySave = serialized;
    } catch {
      this.warn();
    }
  }

  async sendScore(value: number): Promise<void> {
    if (!Number.isSafeInteger(value) || value < 0) return;
    try {
      await window.ytgame?.engagement?.sendScore?.({ value });
    } catch {
      this.warn();
    }
  }

  async requestInterstitial(): Promise<boolean> {
    try {
      const request = window.ytgame?.ads?.requestInterstitialAd;
      if (!request) return false;
      await request();
      return true;
    } catch {
      this.warn();
      return false;
    }
  }

  async requestRewarded(rewardId: string): Promise<boolean> {
    try {
      const request = window.ytgame?.ads?.requestRewardedAd;
      return request ? await request(rewardId) : false;
    } catch {
      this.warn();
      return false;
    }
  }

  destroy(): void {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  }

  private warn(): void {
    try {
      window.ytgame?.health?.logWarning?.();
    } catch {
      // Health reporting is best effort.
    }
  }
}
