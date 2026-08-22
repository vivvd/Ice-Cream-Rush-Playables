interface Window {
  __ICE_CREAM_RUSH_DEBUG__?: {
    unlockAll: () => void;
    forceGameOver: (elapsedMs?: number) => void;
    forceLevelWin: () => void;
    forceLevelTimeout: () => void;
    unlockCampaign: (completedThrough?: number) => void;
    setPatience: (ratio?: number) => void;
    setStoreState: (coins?: number) => void;
    setDemoTicket: () => void;
      setCinnamonTicket: () => void;
      setTallIceTicket: () => void;
    snapshot: () => unknown;
  };
  ytgame?: {
    IN_PLAYABLES_ENV?: boolean;
    game?: {
      firstFrameReady?: () => void;
      gameReady?: () => void;
      loadData?: () => Promise<string>;
      saveData?: (data: string) => Promise<void>;
    };
    system?: {
      isAudioEnabled?: () => boolean;
      onAudioEnabledChange?: (callback: (enabled: boolean) => void) => (() => void) | void;
      onPause?: (callback: () => void) => (() => void) | void;
      onResume?: (callback: () => void) => (() => void) | void;
    };
    engagement?: {
      sendScore?: (score: { value: number }) => Promise<void>;
    };
    ads?: {
      requestInterstitialAd?: () => Promise<void>;
      requestRewardedAd?: (rewardId: string) => Promise<boolean>;
    };
    health?: {
      logError?: () => void;
      logWarning?: () => void;
    };
  };
}
