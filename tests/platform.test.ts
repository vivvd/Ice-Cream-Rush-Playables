import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSave } from "../src/game-logic";
import { YouTubePlatform } from "../src/platform";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

describe("YouTubePlatform", () => {
  it("calls lifecycle in order and never saves before load", async () => {
    const calls: string[] = [];
    const saveData = vi.fn(async () => { calls.push("save"); });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        ytgame: {
          IN_PLAYABLES_ENV: true,
          game: {
            firstFrameReady: () => calls.push("first"),
            gameReady: () => calls.push("ready"),
            loadData: async () => { calls.push("load"); return ""; },
            saveData,
          },
          system: { isAudioEnabled: () => true },
        },
      },
    });
    const platform = new YouTubePlatform();
    platform.firstFrameReady();
    await expect(platform.saveData(defaultSave())).rejects.toThrow(/before loadData/);
    await platform.loadData();
    platform.gameReady();
    await platform.saveData(defaultSave());
    expect(calls).toEqual(["first", "load", "ready", "save"]);
    expect(saveData).toHaveBeenCalledOnce();
  });

  it("wires audio, pause, and resume callbacks", () => {
    let audioCallback = (_enabled: boolean) => undefined;
    let pauseCallback = () => undefined;
    let resumeCallback = () => undefined;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        ytgame: {
          IN_PLAYABLES_ENV: true,
          system: {
            isAudioEnabled: () => false,
            onAudioEnabledChange: (callback: typeof audioCallback) => { audioCallback = callback; },
            onPause: (callback: typeof pauseCallback) => { pauseCallback = callback; },
            onResume: (callback: typeof resumeCallback) => { resumeCallback = callback; },
          },
        },
      },
    });
    const onAudioChange = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();
    new YouTubePlatform().register({ onAudioChange, onPause, onResume });
    expect(onAudioChange).toHaveBeenCalledWith(false);
    audioCallback(true);
    pauseCallback();
    resumeCallback();
    expect(onAudioChange).toHaveBeenLastCalledWith(true);
    expect(onPause).toHaveBeenCalledOnce();
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("keeps local previews audible when the public SDK is only a no-op stub", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { ytgame: { system: { isAudioEnabled: () => false } } },
    });
    const onAudioChange = vi.fn();
    expect(new YouTubePlatform().register({ onAudioChange, onPause: vi.fn(), onResume: vi.fn() })).toBe(true);
    expect(onAudioChange).toHaveBeenCalledWith(true);
  });

  it("grants rewarded results only from the SDK boolean", async () => {
    const requestRewardedAd = vi.fn(async () => true);
    const requestInterstitialAd = vi.fn(async () => undefined);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { ytgame: { ads: { requestRewardedAd, requestInterstitialAd } } },
    });
    const platform = new YouTubePlatform();
    await expect(platform.requestRewarded("ice-cream-rush-revive-v1")).resolves.toBe(true);
    await expect(platform.requestInterstitial()).resolves.toBe(true);
    expect(requestRewardedAd).toHaveBeenCalledWith("ice-cream-rush-revive-v1");
  });

  it("recovers safely from unavailable or rejected ad requests", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { ytgame: { ads: { requestRewardedAd: vi.fn(async () => { throw new Error("unavailable"); }) } } },
    });
    const platform = new YouTubePlatform();
    await expect(platform.requestRewarded("ice-cream-rush-revive-v1")).resolves.toBe(false);
    await expect(platform.requestInterstitial()).resolves.toBe(false);
  });
});
