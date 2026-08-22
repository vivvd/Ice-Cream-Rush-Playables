import "@fontsource/fredoka/latin-600.css";
import "@fontsource/fredoka/latin-700.css";
import "./styles.css";

import { GameAudio } from "./audio";
import { FAST_THRESHOLD, LABELS, LEVELS, REVIVE_REWARD_ID, TOTAL_LEVELS, TRACK_LABELS, UPGRADES } from "./config";
import {
  allUpgradesOwned,
  availableBases,
  availableCinnamonGlazes,
  availableFastDrinks,
  availableFlavors,
  availableToppings,
  buildToItem,
  calculateReward,
  createRun,
  customerPatienceMs,
  emptyBuild,
  effectiveElapsedMs,
  findMatchingItemIndex,
  generateTicket,
  isLevelUnlocked,
  levelConfig,
  levelRemainingMs,
  maxCustomers,
  migrateSave,
  nextCombo,
  nextUpgradeInTrack,
  nextVipTarget,
  partialServedValue,
  recordLevelCompletion,
  spawnIntervalMs,
  timeoutLivesLost,
  upgradePrerequisite,
  upgradesForTrack,
  wrongServeRemainingMs,
} from "./game-logic";
import { YouTubePlatform } from "./platform";
import type {
  AdState,
  BaseId,
  CinnamonGlazeId,
  CustomerKind,
  CustomerState,
  DrinkComponentId,
  FastDrinkId,
  FlavorId,
  IngredientSelection,
  OrderItem,
  RunMode,
  RunResult,
  RunState,
  SaveV5,
  ToppingId,
  UpgradeId,
} from "./types";
import {
  cashSvg,
  customerSvg,
  dessertHtml,
  heartSvg,
  ingredientIcon,
  orderItemIconsHtml,
  productHtml,
  resetSvg,
  ticketMiniHtml,
  upgradeIcon,
} from "./visuals";

type Screen = "menu" | "levels" | "gameplay" | "result";
type Modal = "settings" | "guide" | "pause" | "platformPause" | "resumeGate" | "abandon" | null;
type FeedbackTone = "success" | "fast" | "warning" | "error" | "timeout" | "unlock";

interface DragState {
  pointerId: number;
  selection: IngredientSelection;
  startX: number;
  startY: number;
  dragging: boolean;
  ghost?: HTMLElement;
}

interface DepartureFeedback {
  kind: CustomerKind;
  variant: number;
  remainingMs: number;
}

interface ServedFlash {
  item: OrderItem;
}

interface FeedbackState {
  message: string;
  tone: FeedbackTone;
  expiresAt: number;
}

interface PendingRun {
  mode: RunMode;
  levelNumber?: number;
}

class IceCreamRushApp {
  private readonly platform = new YouTubePlatform();
  private readonly audio = new GameAudio();
  private save!: SaveV5;
  private run?: RunState;
  private screen: Screen = "menu";
  private modal: Modal = null;
  private modalReturnTo: Modal = null;
  private modalBeforePlatform: Modal = null;
  private pauseReasons = new Set<string>();
  private rafId?: number;
  private lastFrame = 0;
  private saveTimer?: number;
  private feedbackTimer?: number;
  private feedbackState?: FeedbackState;
  private servedFlashTimer?: number;
  private ingredientTrayScrollLeft = 0;
  private drag?: DragState;
  private suppressClickUntil = 0;
  private purchaseLockUntil = 0;
  private serveLockUntil = 0;
  private readyCountdownMs = 0;
  private departure?: DepartureFeedback;
  private servedFlash?: ServedFlash;
  private adState: AdState = "idle";
  private lastAdAt = -Infinity;
  private rewardFulfilled = false;
  private runResult?: RunResult;
  private pendingRun?: PendingRun;

  constructor(private readonly root: HTMLElement) {}

  async initialize(): Promise<void> {
    this.bindEvents();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    this.platform.firstFrameReady();
    this.platform.register({
      onAudioChange: (enabled) => this.audio.setPlatformEnabled(enabled),
      onPause: () => this.onPlatformPause(),
      onResume: () => this.onPlatformResume(),
    });
    const rawSave = await this.platform.loadData();
    this.save = migrateSave(rawSave);
    this.audio.setSettings(this.save.settings);
    this.root.removeAttribute("aria-live");
    this.installDebugTools();
    this.render();
    this.platform.gameReady();
  }

  private installDebugTools(): void {
    if (!import.meta.env.DEV) return;
    window.__ICE_CREAM_RUSH_DEBUG__ = {
      unlockAll: () => {
        this.save.coins = 99_999;
        this.save.upgrades = UPGRADES.map((upgrade) => upgrade.id);
        if (this.run) {
          this.run.tutorial = false;
          this.run.customers = [];
          this.run.selectedCustomerId = undefined;
          this.run.spawnRemainingMs = 0;
          this.spawnCustomer();
          this.spawnCustomer();
          this.spawnCustomer();
        }
        this.render();
      },
      forceGameOver: (elapsedMs = 100_000) => {
        if (!this.run) this.run = createRun("endless", false);
        this.run.elapsedMs = elapsedMs;
        this.run.xp = Math.max(1_250, this.run.xp);
        this.run.runCoins = Math.max(320, this.run.runCoins);
        this.run.lives = 0;
        this.finishRun("lives");
      },
      forceLevelWin: () => {
        if (!this.run || this.run.mode !== "level") return;
        this.run.runCoins = levelConfig(this.run.levelNumber ?? 1).goal;
        this.completeLevel();
      },
      forceLevelTimeout: () => {
        if (!this.run || this.run.mode !== "level") return;
        this.run.elapsedMs = levelConfig(this.run.levelNumber ?? 1).durationMs;
        this.finishRun("time");
      },
      unlockCampaign: (completedThrough = TOTAL_LEVELS) => {
        this.save.campaign.completedThrough = Math.max(0, Math.min(TOTAL_LEVELS, Math.floor(completedThrough)));
        this.save.campaign.endlessUnlocked = this.save.campaign.completedThrough >= TOTAL_LEVELS;
        this.render();
      },
      setPatience: (ratio = 0.1) => {
        const customer = this.selectedCustomer();
        if (!customer) return;
        customer.remainingMs = customer.maxPatienceMs * Math.max(0, Math.min(1, ratio));
        this.updateLiveDom();
      },
      setStoreState: (coins = 99_999) => {
        this.save.coins = Math.max(0, Math.floor(coins));
        this.save.upgrades = [];
        if (this.run) {
          this.run.tutorial = false;
          this.run.customers = [];
          this.run.selectedCustomerId = undefined;
          this.run.spawnRemainingMs = 60_000;
          this.spawnCustomer();
        }
        this.render();
      },
      setDemoTicket: () => {
        if (!this.run) this.run = createRun("endless", false);
        this.save.upgrades = UPGRADES.map((upgrade) => upgrade.id);
        this.run.tutorial = false;
        const id = this.run.nextCustomerId++;
        const ticket: OrderItem[] = [
          { type: "iceCream", base: "cone", scoops: ["vanilla"] },
          { type: "fastDrink", drink: "lemonade" },
          { type: "bubbleTea" },
        ];
        const customer: CustomerState = {
          id,
          kind: "regular",
          remainingTicket: ticket,
          servedItems: [],
          activeItemIndex: 0,
          build: emptyBuild(),
          maxPatienceMs: 90_000,
          remainingMs: 90_000,
          variant: 2,
        };
        this.run.customers = [customer];
        this.run.selectedCustomerId = id;
        this.run.spawnRemainingMs = 60_000;
        this.render();
      },
      setCinnamonTicket: () => {
        if (!this.run) this.run = createRun("endless", false);
        this.save.upgrades = UPGRADES.map((upgrade) => upgrade.id);
        this.save.bakeryTutorialComplete = false;
        this.run.tutorial = false;
        const id = this.run.nextCustomerId++;
        const customer: CustomerState = {
          id,
          kind: "regular",
          remainingTicket: [
            { type: "cinnamonRoll", glaze: "vanillaGlaze" },
            { type: "cinnamonRoll", glaze: "chocolateGlaze" },
            { type: "cinnamonRoll", glaze: "berryGlaze" },
          ],
          servedItems: [],
          activeItemIndex: 0,
          build: emptyBuild(),
          maxPatienceMs: 90_000,
          remainingMs: 90_000,
          variant: 3,
        };
        this.run.customers = [customer];
        this.run.selectedCustomerId = id;
        this.run.spawnRemainingMs = 60_000;
        this.render();
      },
      setTallIceTicket: () => {
        if (!this.run) this.run = createRun("endless", false);
        this.save.upgrades = UPGRADES.map((upgrade) => upgrade.id);
        this.run.tutorial = false;
        const id = this.run.nextCustomerId++;
        const customer: CustomerState = {
          id,
          kind: "regular",
          remainingTicket: [{
            type: "iceCream",
            base: "cone",
            scoops: ["vanilla", "chocolate", "strawberry"],
            topping: "sprinkles",
          }],
          servedItems: [],
          activeItemIndex: 0,
          build: emptyBuild(),
          maxPatienceMs: 90_000,
          remainingMs: 90_000,
          variant: 0,
        };
        this.run.customers = [customer];
        this.run.selectedCustomerId = id;
        this.run.spawnRemainingMs = 60_000;
        this.render();
      },
      snapshot: () => ({
        screen: this.screen,
        modal: this.modal,
        save: structuredClone(this.save),
        run: structuredClone(this.run),
        audio: this.audio.debugState(),
      }),
    };
  }

  private bindEvents(): void {
    this.root.addEventListener("click", (event) => this.onClick(event));
    this.root.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    window.addEventListener("pointermove", (event) => this.onPointerMove(event), { passive: false });
    window.addEventListener("pointerup", (event) => this.onPointerUp(event));
    window.addEventListener("pointercancel", () => this.cancelDrag());
    window.addEventListener("keydown", (event) => this.onKeyDown(event));
  }

  private onClick(event: MouseEvent): void {
    void this.audio.unlock();
    const target = event.target as HTMLElement;
    const customerButton = target.closest<HTMLElement>("[data-customer-id]");
    const miniTicketItem = target.closest<HTMLElement>("[data-ticket-index]");
    if (customerButton && miniTicketItem && this.canUseGameplayControls()) {
      this.selectCustomerTicket(Number(customerButton.dataset.customerId), Number(miniTicketItem.dataset.ticketIndex));
      return;
    }
    if (customerButton && this.canUseGameplayControls()) {
      this.selectCustomer(Number(customerButton.dataset.customerId));
      return;
    }

    const actionButton = target.closest<HTMLElement>("[data-action]");
    if (!actionButton || actionButton.getAttribute("aria-disabled") === "true" || actionButton.hasAttribute("disabled")) return;
    if (actionButton.dataset.action === "ingredient" && Date.now() < this.suppressClickUntil) return;
    switch (actionButton.dataset.action) {
      case "levels":
        this.screen = "levels";
        this.render();
        break;
      case "menu":
        this.screen = "menu";
        this.modal = null;
        this.render();
        break;
      case "start-endless":
        this.requestNewRun({ mode: "endless" });
        break;
      case "start-level":
        this.requestNewRun({ mode: "level", levelNumber: Number(actionButton.dataset.level) });
        break;
      case "continue":
        this.continueRun();
        break;
      case "settings":
        this.openSettings();
        break;
      case "guide":
        this.openModal("guide");
        break;
      case "pause":
        this.openManualPause();
        break;
      case "close-modal":
        this.closeModal();
        break;
      case "resume":
        this.resumeFromPause();
        break;
      case "main-menu":
        void this.exitToMenu();
        break;
      case "serve-item":
        this.serveItem();
        break;
      case "reset":
        this.resetBuild();
        break;
      case "ingredient": {
        const selection = this.selectionFromElement(actionButton);
        if (selection) this.addIngredient(selection);
        break;
      }
      case "buy-upgrade":
        this.buyUpgrade(actionButton.dataset.upgrade as UpgradeId);
        break;
      case "toggle-music":
        this.toggleSetting("music");
        break;
      case "toggle-sfx":
        this.toggleSetting("sfx");
        break;
      case "toggle-motion":
        this.toggleSetting("reducedMotion");
        break;
      case "revive":
        void this.requestRevive();
        break;
      case "retry":
        void this.retryRun();
        break;
      case "next-level":
        this.startNextLevel();
        break;
      case "confirm-abandon":
        this.confirmAbandon();
        break;
      case "cancel-abandon":
        this.pendingRun = undefined;
        this.modal = null;
        this.render();
        break;
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (this.modal === "platformPause" || this.modal === "resumeGate") return;
      if (this.screen === "gameplay" && !this.modal) this.openManualPause();
      else if (this.modal === "pause") this.resumeFromPause();
      else if (this.modal) this.closeModal();
      return;
    }
    if (!this.canUseGameplayControls()) return;
    if (event.key === "Enter") {
      event.preventDefault();
      this.serveItem();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      this.resetBuild();
      return;
    }
    const index = Number(event.key) - 1;
    const ingredients = this.availableIngredients();
    if (Number.isInteger(index) && index >= 0 && index < ingredients.length && index < 9) {
      event.preventDefault();
      this.addIngredient(ingredients[index]!);
    }
  }

  private onPointerDown(event: PointerEvent): void {
    void this.audio.unlock();
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-action='ingredient']");
    if (!element || !this.canUseGameplayControls()) return;
    if (this.isMobileLayout()) return;
    const selection = this.selectionFromElement(element);
    if (!selection) return;
    this.drag = {
      pointerId: event.pointerId,
      selection,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY);
    if (!this.drag.dragging && distance > 8) {
      this.drag.dragging = true;
      this.drag.ghost = this.createDragGhost(this.drag.selection);
      document.body.append(this.drag.ghost);
    }
    if (!this.drag.dragging || !this.drag.ghost) return;
    event.preventDefault();
    this.drag.ghost.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
    const station = this.root.querySelector<HTMLElement>(".assembly-dropzone");
    station?.classList.toggle("drop-ready", this.pointInside(event.clientX, event.clientY, station));
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    if (this.drag.dragging) {
      const station = this.root.querySelector<HTMLElement>(".assembly-dropzone");
      if (station && this.pointInside(event.clientX, event.clientY, station)) this.addIngredient(this.drag.selection);
      this.suppressClickUntil = Date.now() + 250;
    }
    this.cancelDrag();
  }

  private createDragGhost(selection: IngredientSelection): HTMLElement {
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.innerHTML = ingredientIcon(selection.type, selection.id);
    return ghost;
  }

  private cancelDrag(): void {
    this.drag?.ghost?.remove();
    this.drag = undefined;
    this.root.querySelector(".assembly-dropzone")?.classList.remove("drop-ready");
  }

  private isMobileLayout(): boolean {
    return window.matchMedia?.("(max-width: 620px)").matches ?? window.innerWidth <= 620;
  }

  private pointInside(x: number, y: number, element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const padding = 20;
    return x >= rect.left - padding && x <= rect.right + padding && y >= rect.top - padding && y <= rect.bottom + padding;
  }

  private selectionFromElement(element: HTMLElement): IngredientSelection | undefined {
    const type = element.dataset.kind;
    const id = element.dataset.id;
    if (type === "base" && ["cone", "cup", "waffle"].includes(id ?? "")) return { type, id: id as BaseId };
    if (type === "flavor" && ["vanilla", "chocolate", "strawberry", "mint"].includes(id ?? "")) return { type, id: id as FlavorId };
    if (type === "topping" && ["sprinkles", "drizzle"].includes(id ?? "")) return { type, id: id as ToppingId };
    if (type === "fastDrink" && ["lemonade", "berrySoda"].includes(id ?? "")) return { type, id: id as FastDrinkId };
    if (type === "bubble" && ["teaCup", "milkTea", "pearls"].includes(id ?? "")) return { type, id: id as DrinkComponentId };
    if (type === "cinnamon" && ["roll", "vanillaGlaze", "chocolateGlaze", "berryGlaze"].includes(id ?? "")) {
      return { type, id: id as "roll" | CinnamonGlazeId };
    }
    return undefined;
  }

  private requestNewRun(request: PendingRun): void {
    if (request.mode === "endless" && !this.save.campaign.endlessUnlocked) {
      this.showFeedback(`Complete Day ${Math.min(TOTAL_LEVELS, this.save.campaign.completedThrough + 1)} to unlock Endless`, "warning");
      return;
    }
    if (request.mode === "level" && !isLevelUnlocked(this.save.campaign, request.levelNumber ?? 1)) return;
    const active = this.save.activeRun;
    if (active && (active.mode !== request.mode || active.levelNumber !== request.levelNumber)) {
      this.pendingRun = request;
      this.modal = "abandon";
      this.render();
      return;
    }
    if (active) {
      this.continueRun();
      return;
    }
    this.startNewRun(request.mode, request.levelNumber);
  }

  private confirmAbandon(): void {
    const request = this.pendingRun;
    if (!request) return;
    this.save.activeRun = null;
    this.pendingRun = undefined;
    this.modal = null;
    this.startNewRun(request.mode, request.levelNumber);
  }

  private startNewRun(mode: RunMode, levelNumber?: number): void {
    this.run = createRun(mode, !this.save.tutorialComplete, levelNumber);
    this.screen = "gameplay";
    this.modal = null;
    this.modalReturnTo = null;
    this.pauseReasons.clear();
    this.rewardFulfilled = false;
    this.runResult = undefined;
    this.departure = undefined;
    if (this.run.tutorial) this.spawnTutorialCustomer();
    else this.spawnCustomer();
    this.render();
    this.audio.resume();
    this.startLoop();
    this.queueSave();
  }

  private continueRun(): void {
    if (!this.save.activeRun) {
      this.screen = "menu";
      this.render();
      return;
    }
    this.run = structuredClone(this.save.activeRun);
    this.screen = "gameplay";
    this.modal = null;
    this.modalReturnTo = null;
    this.pauseReasons.clear();
    this.departure = undefined;
    this.runResult = undefined;
    this.render();
    this.audio.resume();
    this.startLoop();
  }

  private startNextLevel(): void {
    const current = this.run?.levelNumber ?? this.save.campaign.completedThrough;
    if (current >= TOTAL_LEVELS) {
      this.startNewRun("endless");
      return;
    }
    this.startNewRun("level", current + 1);
  }

  private spawnTutorialCustomer(): void {
    if (!this.run) return;
    const ticket: OrderItem[] = [{ type: "iceCream", base: "cone", scoops: ["vanilla"] }];
    const customer: CustomerState = {
      id: this.run.nextCustomerId++,
      kind: "regular",
      remainingTicket: ticket,
      servedItems: [],
      activeItemIndex: 0,
      build: emptyBuild(),
      maxPatienceMs: 20_000,
      remainingMs: 20_000,
      variant: 1,
    };
    this.run.customers = [customer];
    this.run.selectedCustomerId = customer.id;
  }

  private spawnCustomer(): void {
    const run = this.run;
    if (!run || run.customers.length >= maxCustomers(this.save.upgrades)) return;
    const vipReady = this.save.upgrades.length > 0 && run.customersSinceVip >= run.nextVipAt;
    const kind: CustomerKind = vipReady ? (Math.random() < 0.5 ? "patient" : "critic") : "regular";
    if (vipReady) {
      run.customersSinceVip = 0;
      run.nextVipAt = nextVipTarget();
    }
    const pressureElapsedMs = effectiveElapsedMs(run);
    const ticket = generateTicket(this.save.upgrades, kind, pressureElapsedMs);
    const maxPatienceMs = customerPatienceMs(kind, this.save.upgrades, pressureElapsedMs, ticket);
    const id = run.nextCustomerId++;
    const customer: CustomerState = {
      id,
      kind,
      remainingTicket: ticket,
      servedItems: [],
      activeItemIndex: 0,
      build: emptyBuild(),
      maxPatienceMs,
      remainingMs: maxPatienceMs,
      variant: id % 6,
    };
    run.customers.push(customer);
    run.selectedCustomerId ??= customer.id;
    this.applyAutoBase();
  }

  private selectedCustomer(): CustomerState | undefined {
    return this.run?.customers.find((customer) => customer.id === this.run?.selectedCustomerId);
  }

  private selectCustomer(id: number): void {
    if (!this.run?.customers.some((customer) => customer.id === id)) return;
    this.run.selectedCustomerId = id;
    this.applyAutoBase();
    this.audio.play("tap");
    this.render();
  }

  private selectCustomerTicket(customerId: number, index: number): void {
    const customer = this.run?.customers.find((entry) => entry.id === customerId);
    if (!customer || !this.canUseGameplayControls() || index < 0 || index >= customer.remainingTicket.length) return;
    if (customer.build.type && customer.activeItemIndex !== index) {
      this.showFeedback("Add or reset the current item first", "warning");
      return;
    }
    this.run!.selectedCustomerId = customerId;
    customer.activeItemIndex = index;
    this.applyAutoBase();
    this.audio.play("tap");
    this.render();
  }

  private applyAutoBase(): void {
    const customer = this.selectedCustomer();
    if (!customer || !this.save.upgrades.includes("autobase") || customer.build.type) return;
    const expected = customer.remainingTicket[customer.activeItemIndex];
    if (expected?.type === "iceCream") {
      customer.build = { type: "iceCream", base: expected.base, scoops: [], bubbleSteps: [] };
    }
  }

  private addIngredient(selection: IngredientSelection): void {
    const customer = this.selectedCustomer();
    if (!customer || !this.canUseGameplayControls()) {
      if (!customer) this.showFeedback("Pick a customer first", "warning");
      return;
    }
    const build = customer.build;
    if (selection.type === "fastDrink") {
      if (build.type && build.type !== "fastDrink") {
        this.showFeedback("Reset the current item before switching products", "warning");
        return;
      }
      customer.build = { type: "fastDrink", drink: selection.id, scoops: [], bubbleSteps: [] };
    } else if (selection.type === "bubble") {
      if (build.type && build.type !== "bubbleTea") {
        this.showFeedback("Reset the current item before switching products", "warning");
        return;
      }
      if (!build.type) customer.build = { type: "bubbleTea", scoops: [], bubbleSteps: [] };
      const expectedSteps: DrinkComponentId[] = ["teaCup", "milkTea", "pearls"];
      const next = expectedSteps[customer.build.bubbleSteps.length];
      if (selection.id !== next) {
        this.showFeedback(`Add ${next ? LABELS[next] : "the finished drink"} next`, "warning");
        return;
      }
      customer.build.bubbleSteps.push(selection.id);
    } else if (selection.type === "cinnamon") {
      if (build.type && build.type !== "cinnamonRoll") {
        this.showFeedback("Reset the current item before switching products", "warning");
        return;
      }
      if (selection.id === "roll") {
        customer.build = {
          type: "cinnamonRoll",
          scoops: [],
          bubbleSteps: [],
          cinnamonRoll: true,
          cinnamonGlaze: build.type === "cinnamonRoll" ? build.cinnamonGlaze : undefined,
        };
      } else {
        if (build.type !== "cinnamonRoll" || !build.cinnamonRoll) {
          this.showFeedback("Add the Cinnamon Roll first", "warning");
          return;
        }
        customer.build.cinnamonGlaze = selection.id;
      }
    } else {
      if (build.type && build.type !== "iceCream") {
        this.showFeedback("Reset the current item before switching products", "warning");
        return;
      }
      if (!build.type) customer.build = { type: "iceCream", scoops: [], bubbleSteps: [] };
      if (selection.type === "base") {
        customer.build.base = selection.id;
      } else if (selection.type === "flavor") {
        if (!customer.build.base) {
          this.showFeedback("Choose a base first", "warning");
          return;
        }
        if (customer.build.scoops.length >= 3) {
          this.showFeedback("Three scoops is the limit", "warning");
          return;
        }
        customer.build.scoops.push(selection.id);
      } else {
        if (!customer.build.base || customer.build.scoops.length === 0) {
          this.showFeedback("Add a scoop first", "warning");
          return;
        }
        customer.build.topping = selection.id;
      }
    }
    this.audio.play("tap");
    this.render();
  }

  private resetBuild(): void {
    const customer = this.selectedCustomer();
    if (!customer || !this.canUseGameplayControls()) return;
    customer.build = emptyBuild();
    this.applyAutoBase();
    this.audio.play("tap");
    this.render();
  }

  private serveItem(): void {
    const run = this.run;
    const customer = this.selectedCustomer();
    if (!run || !customer || !this.canUseGameplayControls() || Date.now() < this.serveLockUntil) return;
    const item = buildToItem(customer.build);
    if (!item) {
      this.showFeedback("Finish this item first", "warning");
      return;
    }
    this.advanceToNow();
    if (this.screen !== "gameplay" || !run.customers.some((entry) => entry.id === customer.id)) return;
    this.serveLockUntil = Date.now() + 180;
    const matchIndex = findMatchingItemIndex(customer.remainingTicket, item, customer.activeItemIndex);
    if (matchIndex < 0) {
      this.rejectServedItem(customer);
      return;
    }
    this.flashServedItem(item);
    if (item.type === "cinnamonRoll" && !this.save.bakeryTutorialComplete) {
      this.save.bakeryTutorialComplete = true;
    }
    customer.servedItems.push(item);
    customer.remainingTicket.splice(matchIndex, 1);
    customer.build = emptyBuild();
    if (customer.remainingTicket.length === 0) {
      this.completeTicket(customer);
      return;
    }
    customer.activeItemIndex = Math.min(matchIndex, customer.remainingTicket.length - 1);
    this.applyAutoBase();
    this.render();
    this.audio.play("success");
    this.showFeedback(`ITEM SERVED · ${customer.remainingTicket.length} LEFT`, "success");
    this.queueSave();
  }

  private flashServedItem(item: OrderItem): void {
    if (this.servedFlashTimer !== undefined) window.clearTimeout(this.servedFlashTimer);
    this.servedFlash = { item };
    this.servedFlashTimer = window.setTimeout(() => {
      this.servedFlash = undefined;
      this.servedFlashTimer = undefined;
      // Do not replace the whole game DOM here: a quick ingredient tap may be
      // between pointerdown and click while the confirmation animation ends.
      this.root.querySelector(".served-item-flash")?.remove();
    }, this.save.settings.reducedMotion ? 80 : 280);
  }

  private rejectServedItem(customer: CustomerState): void {
    const run = this.run!;
    run.combo = 1;
    customer.build = emptyBuild();
    if (run.tutorial) {
      customer.remainingMs = customer.maxPatienceMs;
      this.applyAutoBase();
      this.render();
      this.audio.play("wrong");
      this.showFeedback("Try again — serve the pictured item", "error");
      return;
    }
    customer.remainingMs = wrongServeRemainingMs(customer.remainingMs, customer.maxPatienceMs);
    if (customer.remainingMs <= 0) {
      const partialCoins = this.payPartialItems(customer);
      const livesLost = timeoutLivesLost(customer.kind);
      this.departure = { kind: customer.kind, variant: customer.variant, remainingMs: 520 };
      this.removeCustomer(customer.id, false);
      this.loseLives(livesLost);
      if (this.screen === "result") return;
      if (this.isLevelGoalMet()) {
        this.completeLevel();
        return;
      }
      this.render();
      this.audio.play("timeout");
      this.showFeedback(`Wrong item · −${livesLost} heart${livesLost === 1 ? "" : "s"}${partialCoins ? ` · +${partialCoins}` : ""}`, "timeout");
      this.queueSave();
      return;
    }
    this.applyAutoBase();
    this.render();
    this.audio.play("wrong");
    this.showFeedback("Wrong item · −35% patience", "error");
    this.queueSave();
  }

  private completeTicket(customer: CustomerState): void {
    const run = this.run!;
    const remainingRatio = customer.remainingMs / customer.maxPatienceMs;
    const fast = remainingRatio >= FAST_THRESHOLD;
    run.combo = nextCombo(run.combo, remainingRatio, customer.kind !== "regular");
    run.bestCombo = Math.max(run.bestCombo, run.combo);
    const reward = calculateReward(customer.servedItems, customer.kind, remainingRatio, run.combo);
    run.xp += reward.xp;
    run.runCoins += reward.coins;
    this.save.coins += reward.coins;
    this.removeCustomer(customer.id, true);
    if (run.tutorial) {
      run.tutorial = false;
      this.save.tutorialComplete = true;
      run.spawnRemainingMs = 500;
    }
    if (this.isLevelGoalMet()) {
      this.completeLevel();
      return;
    }
    this.applyAutoBase();
    this.render();
    this.audio.play(customer.kind !== "regular" || fast ? "fast" : "success");
    this.showFeedback(
      customer.kind !== "regular"
        ? `VIP ticket complete · +${reward.coins} · COMBO x4`
        : `${fast ? "FAST! · " : ""}+${reward.coins} cash · +${reward.xp} XP`,
      fast || customer.kind !== "regular" ? "fast" : "success",
    );
    this.queueSave();
  }

  private payPartialItems(customer: CustomerState): number {
    const run = this.run!;
    const partialCoins = partialServedValue(customer.servedItems);
    run.runCoins += partialCoins;
    this.save.coins += partialCoins;
    return partialCoins;
  }

  private removeCustomer(id: number, served: boolean): void {
    const run = this.run!;
    const customer = run.customers.find((item) => item.id === id);
    run.customers = run.customers.filter((item) => item.id !== id);
    if (served && customer?.kind === "regular") run.customersSinceVip += 1;
    if (run.selectedCustomerId === id) run.selectedCustomerId = run.customers[0]?.id;
    if (run.customers.length === 0) run.spawnRemainingMs = Math.min(run.spawnRemainingMs, 650);
  }

  private loseLives(amount: number): void {
    const run = this.run!;
    run.lives = Math.max(0, run.lives - amount);
    if (run.lives === 0) this.finishRun("lives");
  }

  private isLevelGoalMet(): boolean {
    const run = this.run;
    return Boolean(run?.mode === "level" && run.runCoins >= levelConfig(run.levelNumber ?? 1).goal);
  }

  private completeLevel(): void {
    const run = this.run;
    if (!run || run.mode !== "level" || this.screen === "result") return;
    this.stopLoop();
    this.screen = "result";
    this.modal = null;
    this.pauseReasons.clear();
    this.runResult = "levelWon";
    this.save.campaign = recordLevelCompletion(this.save.campaign, run.levelNumber ?? 1, run.runCoins);
    this.save.activeRun = null;
    this.render();
    this.audio.play("unlock");
    void this.flushSave(false);
  }

  private finishRun(reason: "lives" | "time"): void {
    const run = this.run;
    if (!run || this.screen === "result") return;
    this.stopLoop();
    this.screen = "result";
    this.modal = null;
    this.pauseReasons.clear();
    const newBest = run.mode === "endless" && run.xp > this.save.bestScore;
    if (newBest) this.save.bestScore = run.xp;
    this.runResult = run.mode === "endless"
      ? "endlessFailed"
      : reason === "time" ? "levelFailedTime" : "levelFailedLives";
    if (run.mode === "level") {
      const index = (run.levelNumber ?? 1) - 1;
      this.save.campaign.bestEarnings[index] = Math.max(this.save.campaign.bestEarnings[index] ?? 0, run.runCoins);
    }
    this.save.activeRun = null;
    this.render();
    this.audio.play("timeout");
    void this.flushSave(false).then(() => {
      if (newBest) void this.platform.sendScore(this.save.bestScore);
    });
  }

  private startLoop(): void {
    if (this.rafId !== undefined || this.screen !== "gameplay" || this.pauseReasons.size > 0) return;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame((now) => this.tick(now));
  }

  private stopLoop(): void {
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
  }

  private tick(now: number): void {
    this.rafId = undefined;
    if (this.screen !== "gameplay" || this.pauseReasons.size > 0) return;
    const delta = Math.max(0, now - this.lastFrame);
    this.lastFrame = now;
    this.updateRun(delta);
    if (this.screen === "gameplay" && this.pauseReasons.size === 0) this.rafId = requestAnimationFrame((time) => this.tick(time));
  }

  private advanceToNow(): void {
    if (this.screen !== "gameplay" || this.pauseReasons.size > 0 || !this.run) return;
    const now = performance.now();
    const delta = Math.max(0, now - this.lastFrame);
    this.lastFrame = now;
    this.updateRun(delta);
  }

  private updateRun(delta: number): void {
    const run = this.run;
    if (!run || run.tutorial) return;
    if (this.departure) {
      this.departure.remainingMs -= delta;
      if (this.departure.remainingMs <= 0) {
        this.departure = undefined;
        this.render();
      }
    }
    if (this.readyCountdownMs > 0) {
      const before = Math.ceil(this.readyCountdownMs / 1000);
      this.readyCountdownMs = Math.max(0, this.readyCountdownMs - delta);
      const after = Math.ceil(this.readyCountdownMs / 1000);
      const countdown = this.root.querySelector("[data-countdown]");
      if (countdown) countdown.textContent = String(Math.max(1, after));
      if (before !== after && this.readyCountdownMs === 0) this.render();
      return;
    }

    const simulationDelta = Math.min(delta, levelRemainingMs(run));
    run.elapsedMs += simulationDelta;
    run.spawnRemainingMs -= simulationDelta;
    const expired: CustomerState[] = [];
    for (const customer of run.customers) {
      customer.remainingMs -= simulationDelta;
      if (customer.remainingMs <= 0) expired.push(customer);
    }
    if (expired.length > 0) {
      let partialCoins = 0;
      for (const customer of expired) {
        if (!run.customers.some((item) => item.id === customer.id)) continue;
        partialCoins += this.payPartialItems(customer);
        this.removeCustomer(customer.id, false);
        run.combo = 1;
        this.audio.play("timeout");
        this.loseLives(timeoutLivesLost(customer.kind));
        if (this.screen === "result") return;
      }
      if (this.isLevelGoalMet()) {
        this.completeLevel();
        return;
      }
      this.render();
      const message = expired.some((item) => item.kind === "critic") ? "Critic left · −2 hearts" : "Customer left · −1 heart";
      this.showFeedback(`${message}${partialCoins ? ` · +${partialCoins}` : ""}`, "timeout");
      this.queueSave();
    }

    if (run.mode === "level" && levelRemainingMs(run) <= 0) {
      this.finishRun("time");
      return;
    }

    if (run.spawnRemainingMs <= 0) {
      if (run.customers.length < maxCustomers(this.save.upgrades)) {
        this.spawnCustomer();
        run.spawnRemainingMs = spawnIntervalMs(this.save.upgrades, effectiveElapsedMs(run));
        this.render();
      } else {
        run.spawnRemainingMs = 350;
      }
    }
    this.updateLiveDom();
  }

  private updateLiveDom(): void {
    const run = this.run;
    if (!run) return;
    if (run.mode === "level") {
      const config = levelConfig(run.levelNumber ?? 1);
      const progress = Math.max(0, Math.min(1, run.runCoins / config.goal));
      const goal = this.root.querySelector<HTMLElement>("[data-level-goal]");
      goal?.style.setProperty("--goal-progress", progress.toFixed(4));
      const earned = this.root.querySelector<HTMLElement>("[data-level-earned]");
      if (earned) earned.textContent = `$${run.runCoins.toLocaleString("en-US")} / $${config.goal.toLocaleString("en-US")}`;
      const timer = this.root.querySelector<HTMLElement>("[data-level-time]");
      if (timer) timer.textContent = this.formatTime(levelRemainingMs(run));
    }
    for (const customer of run.customers) {
      const ratio = Math.max(0, Math.min(1, customer.remainingMs / customer.maxPatienceMs));
      const card = this.root.querySelector<HTMLElement>(`[data-customer-id="${customer.id}"]`);
      card?.style.setProperty("--patience", ratio.toFixed(4));
      card?.style.setProperty("--stress", (1 - ratio).toFixed(4));
      card?.classList.toggle("is-worried", ratio <= 0.6 && ratio > 0.3);
      card?.classList.toggle("is-angry", ratio <= 0.3);
      card?.classList.toggle("is-urgent", ratio <= 0.15);
      card?.classList.toggle("is-fast-window", ratio >= FAST_THRESHOLD);
    }
  }

  private formatTime(ms: number): string {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
  }

  private openModal(modal: "settings" | "guide"): void {
    if (this.modal) return;
    this.modal = modal;
    this.render();
  }

  private openSettings(): void {
    if (this.modal === "pause") {
      this.modalReturnTo = "pause";
      this.modal = "settings";
      this.render();
      return;
    }
    this.openModal("settings");
  }

  private closeModal(): void {
    if (!this.modal || this.modal === "platformPause" || this.modal === "resumeGate") return;
    if (this.modalReturnTo === "pause") {
      this.modalReturnTo = null;
      this.modal = "pause";
      this.render();
      return;
    }
    if (this.modal === "pause") {
      this.resumeFromPause();
      return;
    }
    if (this.modal === "abandon") this.pendingRun = undefined;
    this.modal = null;
    this.render();
  }

  private openManualPause(): void {
    if (this.screen !== "gameplay" || this.modal || this.pauseReasons.has("sdk")) return;
    this.advanceToNow();
    if (this.screen !== "gameplay" || this.modal || !this.run) return;
    this.pauseReasons.add("manual");
    this.stopLoop();
    this.cancelDrag();
    this.audio.pause();
    this.modal = "pause";
    this.root.classList.add("is-manual-paused");
    this.captureActiveRun();
    this.render();
  }

  private resumeFromPause(): void {
    if (this.modal !== "pause" && this.modal !== "resumeGate") return;
    this.pauseReasons.delete("manual");
    this.pauseReasons.delete("resume-gate");
    this.root.classList.remove("is-manual-paused");
    this.modal = null;
    this.modalReturnTo = null;
    this.audio.resume();
    this.render();
    this.startLoop();
  }

  private async exitToMenu(): Promise<void> {
    if (this.screen !== "gameplay" || this.pauseReasons.has("sdk")) return;
    this.captureActiveRun();
    await this.flushSave(false);
    this.stopLoop();
    this.cancelDrag();
    this.screen = "menu";
    this.modal = null;
    this.modalReturnTo = null;
    this.pauseReasons.clear();
    this.root.classList.remove("is-manual-paused");
    this.audio.resume();
    this.render();
  }

  private onPlatformPause(): void {
    if (this.pauseReasons.has("sdk")) return;
    this.modalBeforePlatform = this.modal;
    this.pauseReasons.add("sdk");
    this.stopLoop();
    this.cancelDrag();
    this.audio.pause();
    this.modal = "platformPause";
    this.root.classList.add("is-platform-paused");
    this.captureActiveRun();
    this.render();
    void this.flushSave(false);
  }

  private onPlatformResume(): void {
    if (!this.pauseReasons.has("sdk")) return;
    this.pauseReasons.delete("sdk");
    this.root.classList.remove("is-platform-paused");
    if (this.modalBeforePlatform) {
      this.modal = this.modalBeforePlatform;
      this.modalBeforePlatform = null;
      this.render();
      if (this.pauseReasons.size === 0) {
        this.audio.resume();
        this.startLoop();
      }
      return;
    }
    this.pauseReasons.add("resume-gate");
    this.modal = "resumeGate";
    this.render();
  }

  private buyUpgrade(id: UpgradeId): void {
    if (Date.now() < this.purchaseLockUntil || this.save.upgrades.includes(id)) return;
    const upgrade = UPGRADES.find((item) => item.id === id);
    if (!upgrade) return;
    const prerequisite = upgradePrerequisite(this.save.upgrades, id);
    if (prerequisite) {
      this.showFeedback(`Unlock ${prerequisite.name} first`, "warning");
      return;
    }
    const next = nextUpgradeInTrack(this.save.upgrades, upgrade.track);
    if (next?.id !== id) return;
    if (this.save.coins < upgrade.price) {
      this.showFeedback(`Need ${upgrade.price - this.save.coins} more cash`, "warning");
      return;
    }
    this.purchaseLockUntil = Date.now() + 300;
    this.save.coins -= upgrade.price;
    this.save.upgrades.push(upgrade.id);
    this.audio.play(allUpgradesOwned(this.save.upgrades) ? "unlock" : "purchase");
    this.captureActiveRun();
    this.render();
    this.showFeedback(allUpgradesOwned(this.save.upgrades) ? "Parlor Complete! Endless continues." : `${upgrade.name} unlocked!`, "unlock");
    this.queueSave();
  }

  private toggleSetting(setting: "music" | "sfx" | "reducedMotion"): void {
    this.save.settings[setting] = !this.save.settings[setting];
    this.audio.setSettings(this.save.settings);
    this.root.classList.toggle("reduce-motion", this.save.settings.reducedMotion);
    this.render();
    this.queueSave();
  }

  private async requestRevive(): Promise<void> {
    const run = this.run;
    if (
      !run || run.reviveUsed || this.adState === "requesting" || this.adState === "showing" ||
      this.runResult === "levelFailedTime"
    ) return;
    this.adState = "requesting";
    this.pauseReasons.add("ad");
    this.audio.pause();
    this.render();
    this.adState = "showing";
    const earned = await this.platform.requestRewarded(REVIVE_REWARD_ID);
    if (earned && !this.rewardFulfilled) {
      this.rewardFulfilled = true;
      this.lastAdAt = Date.now();
      this.adState = "completed";
      run.reviveUsed = true;
      run.lives = 1;
      run.combo = 1;
      run.customers = [];
      run.selectedCustomerId = undefined;
      run.spawnRemainingMs = 3_000;
      run.active = true;
      this.readyCountdownMs = 3_000;
      this.screen = "gameplay";
      this.runResult = undefined;
      this.pauseReasons.delete("ad");
      this.audio.resume();
      this.render();
      this.showFeedback("Second chance!", "unlock");
      this.queueSave();
      this.startLoop();
      return;
    }
    this.adState = earned ? "completed" : "dismissed";
    this.pauseReasons.delete("ad");
    this.audio.resume();
    this.render();
    this.showFeedback("Reward not earned — you can still retry", "warning");
    this.adState = "idle";
  }

  private async retryRun(): Promise<void> {
    if (this.adState === "requesting" || this.adState === "showing") return;
    const mode = this.run?.mode ?? "endless";
    const levelNumber = this.run?.levelNumber;
    const runLength = this.run?.elapsedMs ?? 0;
    const adEligible = runLength >= 90_000 && Date.now() - this.lastAdAt >= 120_000;
    if (adEligible) {
      this.adState = "requesting";
      this.pauseReasons.add("ad");
      this.audio.pause();
      this.render();
      this.adState = "showing";
      if (await this.platform.requestInterstitial()) this.lastAdAt = Date.now();
      this.pauseReasons.delete("ad");
      this.adState = "idle";
    }
    this.startNewRun(mode, levelNumber);
  }

  private availableIngredients(): IngredientSelection[] {
    const items: IngredientSelection[] = [
      ...availableBases(this.save.upgrades).map((id): IngredientSelection => ({ type: "base", id })),
      ...availableFlavors(this.save.upgrades).map((id): IngredientSelection => ({ type: "flavor", id })),
      ...availableToppings(this.save.upgrades).map((id): IngredientSelection => ({ type: "topping", id })),
      ...availableFastDrinks(this.save.upgrades).map((id): IngredientSelection => ({ type: "fastDrink", id })),
    ];
    if (this.save.upgrades.includes("bubbleTea")) {
      items.push(
        { type: "bubble", id: "teaCup" },
        { type: "bubble", id: "milkTea" },
        { type: "bubble", id: "pearls" },
      );
    }
    if (this.save.upgrades.includes("rollOven")) {
      items.push(
        { type: "cinnamon", id: "roll" },
        ...availableCinnamonGlazes(this.save.upgrades).map((id): IngredientSelection => ({ type: "cinnamon", id })),
      );
    }
    return items;
  }

  private canUseGameplayControls(): boolean {
    return this.screen === "gameplay" && this.pauseReasons.size === 0 && !this.modal && this.readyCountdownMs <= 0;
  }

  private captureActiveRun(): void {
    if (this.screen === "gameplay" && this.run) this.save.activeRun = structuredClone(this.run);
  }

  private queueSave(): void {
    this.captureActiveRun();
    if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = undefined;
      void this.flushSave(false);
    }, 250);
  }

  private async flushSave(capture = true): Promise<void> {
    if (capture) this.captureActiveRun();
    if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    await this.platform.saveData(this.save);
  }

  private showFeedback(message: string, tone: FeedbackTone): void {
    const visibleFor = tone === "success" || tone === "fast" ? 3_000 : 1_700;
    this.feedbackState = { message, tone, expiresAt: Date.now() + visibleFor };
    this.restoreFeedback();
    if (this.feedbackTimer !== undefined) window.clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => this.clearFeedback(), visibleFor);
  }

  private clearFeedback(): void {
    this.feedbackState = undefined;
    this.feedbackTimer = undefined;
    this.root.querySelector<HTMLElement>("#feedback")?.classList.remove("is-visible");
  }

  private restoreFeedback(): void {
    const feedback = this.root.querySelector<HTMLElement>("#feedback");
    const state = this.feedbackState;
    if (!feedback || !state || Date.now() >= state.expiresAt) return;
    feedback.textContent = state.message;
    feedback.className = `feedback is-visible feedback-${state.tone}`;
  }

  private render(): void {
    const tray = this.root.querySelector<HTMLElement>(".ingredient-tray");
    const feedback = this.screen === "gameplay" ? this.root.querySelector<HTMLElement>("#feedback") : undefined;
    if (tray) this.ingredientTrayScrollLeft = tray.scrollLeft;
    this.root.classList.toggle("reduce-motion", this.save?.settings.reducedMotion ?? false);
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "levels") this.renderLevelSelect();
    else if (this.screen === "result") this.renderResult();
    else this.renderGameplay();
    if (this.screen === "gameplay") {
      const renderedFeedback = this.root.querySelector<HTMLElement>("#feedback");
      if (feedback && renderedFeedback) renderedFeedback.replaceWith(feedback);
      this.restoreFeedback();
    }
  }

  private renderMenu(): void {
    const heroOrder: OrderItem = { type: "iceCream", base: "cone", scoops: ["strawberry", "vanilla"], topping: "sprinkles" };
    const active = this.save.activeRun;
    const nextDay = Math.min(TOTAL_LEVELS, this.save.campaign.completedThrough + 1);
    const levelAction = active?.mode === "level" ? "continue" : "levels";
    const levelLabel = active?.mode === "level" ? `CONTINUE DAY ${active.levelNumber}` : "CHOOSE DAY";
    const endlessAction = active?.mode === "endless" ? "continue" : "start-endless";
    const endlessLabel = active?.mode === "endless" ? "CONTINUE ENDLESS" : "START ENDLESS";
    this.root.innerHTML = `<main class="menu-screen">
      <div class="parlor-bg" aria-hidden="true"><span class="awning"></span><span class="sun-dot dot-one"></span><span class="sun-dot dot-two"></span></div>
      <section class="menu-card menu-card-modes">
        <p class="eyebrow">PARLOR TIME MANAGEMENT</p>
        <h1 class="game-logo"><span>ICE CREAM</span><strong>RUSH</strong></h1>
        <p class="menu-tagline">Build it. Serve it. Beat the rush.</p>
        <div class="hero-counter" aria-hidden="true">
          <div class="hero-customer">${customerSvg("regular", 3)}</div>
          <div class="hero-dessert">${dessertHtml(heroOrder)}</div>
        </div>
        <div class="mode-cards">
          <article class="mode-card levels-mode">
            <span class="mode-icon" aria-hidden="true">${this.save.campaign.completedThrough >= TOTAL_LEVELS ? "✓" : nextDay}</span>
            <div><p>LEVELS</p><strong>${this.save.campaign.completedThrough}/${TOTAL_LEVELS} DAYS COMPLETE</strong><small>${this.save.campaign.completedThrough >= TOTAL_LEVELS ? "Campaign complete" : `Next: Day ${nextDay} · $${levelConfig(nextDay).goal.toLocaleString("en-US")}`}</small></div>
            <button data-action="${levelAction}">${levelLabel}<span>→</span></button>
          </article>
          <article class="mode-card endless-mode ${this.save.campaign.endlessUnlocked ? "is-unlocked" : "is-locked"}">
            <span class="mode-icon" aria-hidden="true">${this.save.campaign.endlessUnlocked ? "∞" : "🔒"}</span>
            <div><p>ENDLESS</p><strong>${this.save.campaign.endlessUnlocked ? `BEST ${this.save.bestScore.toLocaleString("en-US")}` : "LOCKED"}</strong><small>${this.save.campaign.endlessUnlocked ? "Master the full rush" : `Complete all ${TOTAL_LEVELS} days · next Day ${nextDay}`}</small></div>
            <button data-action="${endlessAction}" ${this.save.campaign.endlessUnlocked ? "" : "disabled"}>${this.save.campaign.endlessUnlocked ? endlessLabel : `DAY ${nextDay} REQUIRED`}</button>
          </article>
        </div>
        <div class="menu-links"><button class="text-button" data-action="guide">HOW TO PLAY</button><button class="text-button" data-action="settings">SETTINGS</button></div>
        <div class="menu-stats"><span>ENDLESS BEST <strong>${this.save.bestScore.toLocaleString("en-US")}</strong></span><span>CASH <strong>${this.save.coins.toLocaleString("en-US")}</strong></span></div>
      </section>
      ${this.modalHtml()}
      <div id="feedback" class="feedback" role="status"></div>
    </main>`;
  }

  private renderLevelSelect(): void {
    const active = this.save.activeRun;
    const cards = LEVELS.map((config) => {
      const completed = config.number <= this.save.campaign.completedThrough;
      const unlocked = isLevelUnlocked(this.save.campaign, config.number);
      const isActive = active?.mode === "level" && active.levelNumber === config.number;
      const best = this.save.campaign.bestEarnings[config.number - 1] ?? 0;
      const state = isActive ? "IN PROGRESS" : completed ? "COMPLETED" : unlocked ? "NEXT DAY" : "LOCKED";
      return `<button class="day-card ${completed ? "is-completed" : ""} ${unlocked ? "is-unlocked" : "is-locked"} ${isActive ? "is-active" : ""}" data-action="${isActive ? "continue" : "start-level"}" data-level="${config.number}" ${unlocked ? "" : "disabled"} aria-label="${isActive ? "Continue" : completed ? "Replay" : "Start"} Day ${config.number}, goal ${config.goal} cash">
        <span class="day-number"><small>DAY</small>${config.number}</span>
        <span class="day-details"><strong>$${config.goal.toLocaleString("en-US")}</strong><small>${this.formatTime(config.durationMs)} SHIFT</small>${best > 0 ? `<em>BEST $${best.toLocaleString("en-US")}</em>` : ""}</span>
        <b>${state}</b>
      </button>`;
    }).join("");
    this.root.innerHTML = `<main class="menu-screen level-select-screen">
      <div class="parlor-bg" aria-hidden="true"></div>
      <section class="level-select-card">
        <header><button class="close-button level-back" data-action="menu" aria-label="Back to main menu">←</button><div><p class="eyebrow">LEVEL MODE</p><h1>CHOOSE A DAY</h1><span>Earn the goal before the shift ends.</span></div><div class="level-wallet"><small>CASH</small><strong>$${this.save.coins.toLocaleString("en-US")}</strong></div></header>
        <div class="day-grid">${cards}</div>
        <footer><span><b>✓</b> Replay completed days to earn more cash.</span><strong>${this.save.campaign.completedThrough}/${TOTAL_LEVELS} COMPLETE</strong></footer>
      </section>
      ${this.modalHtml()}
      <div id="feedback" class="feedback" role="status"></div>
    </main>`;
  }

  private renderGameplay(): void {
    const run = this.run;
    if (!run) return;
    const selected = this.selectedCustomer();
    const hearts = [0, 1, 2].map((index) => heartSvg(index < run.lives)).join("");
    const slots = maxCustomers(this.save.upgrades);
    const customerCards = run.customers.map((customer) => this.customerCardHtml(customer)).join("");
    const placeholders = Array.from({ length: Math.max(0, slots - run.customers.length) }, () => `<div class="customer-slot-empty"><span>Next</span></div>`).join("");
    const tutorial = run.tutorial ? this.tutorialHtml() : this.bakeryTutorialHtml(selected);
    const countdown = this.readyCountdownMs > 0
      ? `<div class="countdown-overlay"><p>GET READY</p><strong data-countdown>${Math.max(1, Math.ceil(this.readyCountdownMs / 1000))}</strong></div>`
      : "";
    const level = run.mode === "level" ? levelConfig(run.levelNumber ?? 1) : undefined;
    const modeHud = level
      ? `<div class="hud-pill campaign-pill"><span><small>DAY ${level.number}</small><strong data-level-time>${this.formatTime(levelRemainingMs(run))}</strong></span><span class="campaign-goal" data-level-goal style="--goal-progress:${Math.min(1, run.runCoins / level.goal)}"><i></i><b data-level-earned>$${run.runCoins.toLocaleString("en-US")} / $${level.goal.toLocaleString("en-US")}</b></span></div>`
      : `<div class="hud-pill score-pill"><span><small>XP</small><strong>${run.xp.toLocaleString("en-US")}</strong></span></div>`;
    this.root.innerHTML = `<main class="game-screen mode-${run.mode} combo-${run.combo}">
      <header class="game-hud">
        <div class="hud-pill coins-pill"><span class="hud-icon cash-icon">${cashSvg()}</span><span><small>CASH</small><strong>${this.save.coins.toLocaleString("en-US")}</strong></span></div>
        ${modeHud}
        <div class="combo-badge"><small>COMBO</small><strong>x${run.combo}</strong></div>
        <div class="lives" aria-label="${run.lives} lives remaining">${hearts}</div>
        <button class="pause-button" data-action="pause" aria-label="Pause game"><i></i><i></i></button>
      </header>
      <section class="rush-stage">
        <div class="shop-scene" aria-hidden="true"><span class="menu-board">${level ? `DAY ${level.number} · $${level.goal.toLocaleString("en-US")}` : "ENDLESS RUSH"}</span><span class="lamp lamp-left"></span><span class="lamp lamp-right"></span></div>
        <div class="customer-lane" style="--slots:${slots}">${customerCards}${placeholders}</div>
        <section class="assembly-panel">
          <div class="assembly-left-rail">
            ${tutorial}
            ${this.counterUpgradeDockHtml()}
          </div>
          ${this.servedFlash ? `<div class="served-item-flash" aria-hidden="true">${orderItemIconsHtml(this.servedFlash.item)}<b>✓</b></div>` : ""}
          <div class="assembly-dropzone" aria-label="Current product build">
            <span class="counter-ring" aria-hidden="true"></span>
            ${selected ? productHtml(selected.build) : productHtml(emptyBuild())}
            <span class="drop-hint">DROP HERE</span>
          </div>
          <div class="assembly-actions">
            <button class="reset-button" data-action="reset" aria-label="Reset current build"><span class="reset-icon">${resetSvg()}</span><b>RESET</b></button>
            <button class="serve-button" data-action="serve-item">SERVE<span>→</span></button>
          </div>
        </section>
        ${this.departure ? `<div class="angry-exit" aria-hidden="true"><span>${customerSvg(this.departure.kind, this.departure.variant)}</span><b>!</b></div>` : ""}
      </section>
      ${this.ingredientTrayHtml()}
      ${this.equipmentDockHtml()}
      ${countdown}
      ${this.modalHtml()}
      <div id="feedback" class="feedback" role="status"></div>
    </main>`;
    const tray = this.root.querySelector<HTMLElement>(".ingredient-tray");
    if (tray) tray.scrollLeft = this.ingredientTrayScrollLeft;
    this.updateLiveDom();
  }

  private customerCardHtml(customer: CustomerState): string {
    const run = this.run!;
    const ratio = Math.max(0, Math.min(1, customer.remainingMs / customer.maxPatienceMs));
    const selected = customer.id === run.selectedCustomerId;
    const vip = customer.kind !== "regular";
    return `<button class="customer-card mood-happy ${selected ? "is-selected" : ""} ${vip ? "is-vip" : ""} kind-${customer.kind}" style="--patience:${ratio};--stress:${1 - ratio}" data-customer-id="${customer.id}" aria-label="Select ${customer.kind} customer ticket ${customer.id}">
      <span class="customer-stress"></span>
      <span class="order-bubble">${ticketMiniHtml(customer.remainingTicket, customer.activeItemIndex)}${vip ? `<b>${customer.kind === "critic" ? "CRITIC · 2♥" : "PATIENT VIP"}</b>` : ""}</span>
      <span class="customer-portrait">${customerSvg(customer.kind, customer.variant)}</span>
      <span class="patience-track"><i></i></span>
      <span class="customer-number">#${customer.id} · ${customer.remainingTicket.length} LEFT</span>
    </button>`;
  }

  private ingredientTrayHtml(): string {
    let shortcut = 1;
    const ownedButton = (kind: IngredientSelection["type"], id: IngredientSelection["id"]) => {
      const key = shortcut++;
      const shortcutHtml = key <= 9 ? `<kbd>${key}</kbd>` : "";
      return `<button class="ingredient-button ingredient-${kind}" data-action="ingredient" data-kind="${kind}" data-id="${id}" aria-label="Add ${LABELS[id]}" title="${LABELS[id]}${key <= 9 ? ` · key ${key}` : ""}">
        ${ingredientIcon(kind, id)}<span>${LABELS[id]}</span>${shortcutHtml}
      </button>`;
    };
    const lockedButton = (
      kind: "base" | "flavor" | "topping" | "fastDrink" | "cinnamon",
      id: BaseId | FlavorId | ToppingId | FastDrinkId | CinnamonGlazeId | "roll",
      upgradeId: UpgradeId,
    ) => {
      if (this.save.upgrades.includes(upgradeId)) return ownedButton(kind, id);
      const upgrade = UPGRADES.find((item) => item.id === upgradeId)!;
      const prerequisite = upgradePrerequisite(this.save.upgrades, upgradeId);
      const affordable = this.save.coins >= upgrade.price && !prerequisite;
      return `<button class="ingredient-button locked-product ${affordable ? "can-buy" : ""} ${prerequisite ? "chain-locked" : ""}" data-action="buy-upgrade" data-upgrade="${upgradeId}" aria-label="Unlock ${upgrade.name} for ${upgrade.price} cash${prerequisite ? ` after ${prerequisite.name}` : ""}">
        ${ingredientIcon(kind, id)}<span>${LABELS[id]}</span><b class="product-lock" aria-hidden="true">🔒</b><b class="unlock-price">$${upgrade.price.toLocaleString("en-US")}</b><em class="product-prerequisite">${prerequisite ? `AFTER ${prerequisite.name}` : "READY TO BUY"}</em>
      </button>`;
    };

    const bases = [
      ownedButton("base", "cone"),
      lockedButton("base", "cup", "cup"),
      lockedButton("base", "waffle", "waffle"),
    ].join("");
    const flavors = [
      ownedButton("flavor", "vanilla"),
      ownedButton("flavor", "chocolate"),
      lockedButton("flavor", "strawberry", "strawberry"),
      lockedButton("flavor", "mint", "mint"),
    ].join("");
    const toppings = [
      lockedButton("topping", "sprinkles", "sprinkles"),
      lockedButton("topping", "drizzle", "drizzle"),
    ].join("");
    const drinks = [
      lockedButton("fastDrink", "lemonade", "lemonade"),
      lockedButton("fastDrink", "berrySoda", "berrySoda"),
      this.save.upgrades.includes("bubbleTea")
        ? [ownedButton("bubble", "teaCup"), ownedButton("bubble", "milkTea"), ownedButton("bubble", "pearls")].join("")
        : this.bubbleTeaLockedButton(),
    ].join("");
    const bakery = this.save.upgrades.includes("rollOven")
      ? [
          ownedButton("cinnamon", "roll"),
          ownedButton("cinnamon", "vanillaGlaze"),
          lockedButton("cinnamon", "chocolateGlaze", "chocolateIcing"),
          lockedButton("cinnamon", "berryGlaze", "berryIcing"),
        ].join("")
      : lockedButton("cinnamon", "roll", "rollOven");
    return `<aside class="ingredient-tray" aria-label="Product showcase">
      <div class="ingredient-group"><p>BASES</p><div>${bases}</div></div>
      <div class="ingredient-group"><p>SCOOPS</p><div>${flavors}</div></div>
      <div class="ingredient-group"><p>TOPPINGS</p><div>${toppings}</div></div>
      <div class="ingredient-group drinks-group"><p>DRINKS</p><div>${drinks}</div></div>
      <div class="ingredient-group bakery-group"><p>${TRACK_LABELS.bakery}</p><div>${bakery}</div></div>
    </aside>`;
  }

  private bubbleTeaLockedButton(): string {
    const upgrade = UPGRADES.find((item) => item.id === "bubbleTea")!;
    const prerequisite = upgradePrerequisite(this.save.upgrades, "bubbleTea");
    const affordable = this.save.coins >= upgrade.price && !prerequisite;
    return `<button class="ingredient-button locked-product ${affordable ? "can-buy" : ""} ${prerequisite ? "chain-locked" : ""}" data-action="buy-upgrade" data-upgrade="bubbleTea" aria-label="Unlock Bubble Tea for ${upgrade.price} cash${prerequisite ? ` after ${prerequisite.name}` : ""}">
      ${upgradeIcon("bubbleTea")}<span>Bubble Tea</span><b class="product-lock" aria-hidden="true">🔒</b><b class="unlock-price">$${upgrade.price.toLocaleString("en-US")}</b><em class="product-prerequisite">${prerequisite ? `AFTER ${prerequisite.name}` : "READY TO BUY"}</em>
    </button>`;
  }

  private equipmentDockHtml(): string {
    const copy: Record<string, { name: string; benefit: string }> = {
      freezer: { name: "FREEZER", benefit: "+15% TIME" },
      autobase: { name: "AUTO BASE", benefit: "AUTO START" },
    };
    const items = upgradesForTrack("equipment").filter((upgrade) => upgrade.id === "freezer" || upgrade.id === "autobase").map((upgrade) => {
      const owned = this.save.upgrades.includes(upgrade.id);
      const prerequisite = upgradePrerequisite(this.save.upgrades, upgrade.id);
      const next = nextUpgradeInTrack(this.save.upgrades, "equipment")?.id === upgrade.id;
      const affordable = next && this.save.coins >= upgrade.price;
      const label = copy[upgrade.id]!;
      return `<button class="equipment-button ${owned ? "is-owned" : ""} ${affordable ? "can-buy" : ""} ${prerequisite ? "chain-locked" : ""}" data-action="buy-upgrade" data-upgrade="${upgrade.id}" ${owned ? "aria-disabled=\"true\"" : ""} aria-label="${owned ? `${upgrade.name} owned` : `Unlock ${upgrade.name} for ${upgrade.price} cash`}" title="${upgrade.name} · ${upgrade.effect}">
        ${upgradeIcon(upgrade.id)}<strong>${label.name}</strong><small>${label.benefit}</small><span>${owned ? "OWNED" : `${prerequisite ? "🔒 " : ""}$${upgrade.price.toLocaleString("en-US")}`}</span>
      </button>`;
    }).join("");
    return `<aside class="equipment-dock" aria-label="Equipment upgrades"><p>${TRACK_LABELS.equipment}</p>${items}</aside>`;
  }

  private counterUpgradeDockHtml(): string {
    const items = upgradesForTrack("equipment").filter((upgrade) => upgrade.id === "counter1" || upgrade.id === "counter2").map((upgrade) => {
      const owned = this.save.upgrades.includes(upgrade.id);
      const prerequisite = upgradePrerequisite(this.save.upgrades, upgrade.id);
      const next = nextUpgradeInTrack(this.save.upgrades, "equipment")?.id === upgrade.id;
      const affordable = next && this.save.coins >= upgrade.price;
      const customerCount = upgrade.id === "counter1" ? 2 : 3;
      return `<button class="counter-upgrade-button ${owned ? "is-owned" : ""} ${affordable ? "can-buy" : ""} ${prerequisite ? "chain-locked" : ""}" data-action="buy-upgrade" data-upgrade="${upgrade.id}" ${owned ? "aria-disabled=\"true\"" : ""} aria-label="${owned ? `${upgrade.name} owned` : `Unlock ${upgrade.name} for ${upgrade.price} cash`}" title="${upgrade.name} · ${upgrade.effect}">
        ${upgradeIcon(upgrade.id)}<span><strong>${upgrade.name.toUpperCase()}</strong><small>${customerCount} CUSTOMERS</small><b>${owned ? "OWNED" : `${prerequisite ? "🔒 " : ""}$${upgrade.price.toLocaleString("en-US")}`}</b></span>
      </button>`;
    }).join("");
    return `<aside class="counter-upgrade-dock" aria-label="Counter expansion upgrades"><p>EXPAND COUNTER</p><em>${maxCustomers(this.save.upgrades)} ACTIVE</em><div>${items}</div></aside>`;
  }

  private tutorialHtml(): string {
    const customer = this.selectedCustomer();
    if (!customer) return "";
    const build = customer.build;
    const text = !build.type || (build.type === "iceCream" && !build.base)
        ? "Tap or drag the glowing cone"
        : build.type === "iceCream" && build.scoops.length === 0
          ? "Great! Add the vanilla scoop"
          : "Perfect — serve this item";
    return `<div class="tutorial-coach"><span>FIRST ORDER</span><strong>${text}</strong><i></i></div>`;
  }

  private bakeryTutorialHtml(customer: CustomerState | undefined): string {
    if (this.save.bakeryTutorialComplete || !customer) return "";
    const expected = customer.remainingTicket[customer.activeItemIndex];
    if (expected?.type !== "cinnamonRoll") return "";
    return `<div class="tutorial-coach bakery-coach"><span>NEW BAKERY ORDER</span><strong>ROLL FIRST · ADD ICING · SERVE</strong><i></i></div>`;
  }

  private renderResult(): void {
    const run = this.run;
    if (!run) return;
    const adBusy = this.adState === "requesting" || this.adState === "showing";
    if (run.mode === "level") {
      const config = levelConfig(run.levelNumber ?? 1);
      const won = this.runResult === "levelWon";
      const campaignComplete = won && config.number === TOTAL_LEVELS;
      const canRevive = this.runResult === "levelFailedLives" && !run.reviveUsed;
      this.root.innerHTML = `<main class="result-screen ${won ? "level-success" : "level-failure"}">
        <div class="result-sprinkles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <section class="result-card level-result-card">
          <p class="eyebrow">${campaignComplete ? "ENDLESS UNLOCKED" : won ? `DAY ${config.number} COMPLETE` : "SHIFT MISSED"}</p>
          <h1>${campaignComplete ? "PARLOR CHAMPION!" : won ? "GOAL REACHED!" : this.runResult === "levelFailedTime" ? "TIME'S UP" : "PARLOR CLOSED"}</h1>
          <div class="result-score level-result-score"><small>DAY EARNINGS</small><strong>$${run.runCoins.toLocaleString("en-US")}</strong><span>GOAL $${config.goal.toLocaleString("en-US")}</span><i style="--result-progress:${Math.min(1, run.runCoins / config.goal)}"><b></b></i></div>
          <div class="result-grid"><span><small>BEST DAY</small><strong>$${(this.save.campaign.bestEarnings[config.number - 1] ?? run.runCoins).toLocaleString("en-US")}</strong></span><span><small>BEST COMBO</small><strong>x${run.bestCombo}</strong></span><span><small>CASH BALANCE</small><strong>$${this.save.coins.toLocaleString("en-US")}</strong></span></div>
          ${canRevive ? `<button class="reward-button" data-action="revive" ${adBusy ? "disabled" : ""}><span class="ad-mark">AD</span><span><strong>CONTINUE WITH 1 HEART</strong><small>Resume this shift after the ad</small></span></button>` : ""}
          ${won
            ? `<button class="primary-button retry-button" data-action="next-level">${campaignComplete ? "PLAY ENDLESS" : "NEXT DAY"}<span>→</span></button>`
            : `<button class="primary-button retry-button" data-action="retry" ${adBusy ? "disabled" : ""}>${adBusy ? "PLEASE WAIT…" : `RETRY DAY ${config.number}`}<span>→</span></button>`}
          <button class="text-button result-secondary" data-action="levels">LEVEL SELECT</button>
          <p class="result-note">Coins and upgrades are saved${won ? "." : " even when a shift is missed."}</p>
        </section><div id="feedback" class="feedback" role="status"></div>
      </main>`;
      return;
    }
    this.root.innerHTML = `<main class="result-screen">
      <div class="result-sprinkles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <section class="result-card">
        <p class="eyebrow">THE ENDLESS RUSH IS OVER</p><h1>NICE SERVING!</h1>
        <div class="result-score"><small>XP SCORE</small><strong>${run.xp.toLocaleString("en-US")}</strong><span>${run.xp > 0 && run.xp === this.save.bestScore ? "NEW BEST" : `BEST ${this.save.bestScore.toLocaleString("en-US")}`}</span></div>
        <div class="result-grid"><span><small>CASH EARNED</small><strong>+${run.runCoins.toLocaleString("en-US")}</strong></span><span><small>BEST COMBO</small><strong>x${run.bestCombo}</strong></span><span><small>PARLOR</small><strong>${this.save.upgrades.length}/${UPGRADES.length}</strong></span></div>
        ${!run.reviveUsed ? `<button class="reward-button" data-action="revive" ${adBusy ? "disabled" : ""}><span class="ad-mark">AD</span><span><strong>CONTINUE WITH 1 HEART</strong><small>Watch a rewarded ad</small></span></button>` : ""}
        <button class="primary-button retry-button" data-action="retry" ${adBusy ? "disabled" : ""}>${adBusy ? "PLEASE WAIT…" : "PLAY AGAIN"}<span>→</span></button>
        <button class="text-button result-secondary" data-action="menu">MAIN MENU</button>
        <p class="result-note">Your upgrades and cash are saved.</p>
      </section><div id="feedback" class="feedback" role="status"></div>
    </main>`;
  }

  private modalHtml(): string {
    if (!this.modal) return "";
    if (this.modal === "settings") return this.settingsModalHtml();
    if (this.modal === "guide") return this.guideModalHtml();
    if (this.modal === "pause") return this.pauseModalHtml();
    if (this.modal === "abandon") return this.abandonModalHtml();
    const platformPause = this.modal === "platformPause";
    return `<div class="modal-backdrop pause-backdrop" role="dialog" aria-modal="true" aria-label="Game paused">
      <section class="modal-card pause-card"><span class="pause-symbol">${platformPause ? "Ⅱ" : "▶"}</span><p class="eyebrow">${platformPause ? "YOUTUBE PAUSE" : "READY WHEN YOU ARE"}</p><h2>${platformPause ? "GAME PAUSED" : "TAP TO RESUME"}</h2><p>Your full ticket is frozen exactly where you left it.</p>${platformPause ? "" : `<button class="primary-button" data-action="resume">RESUME</button>`}</section>
    </div>`;
  }

  private abandonModalHtml(): string {
    const active = this.save.activeRun;
    const label = active?.mode === "level" ? `Day ${active.levelNumber}` : "Endless";
    return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="abandon-title"><section class="modal-card abandon-card">
      <p class="eyebrow">RUN IN PROGRESS</p><h2 id="abandon-title">LEAVE ${label.toUpperCase()}?</h2><p>The current customers and timer will be discarded. Coins and purchased upgrades stay saved.</p>
      <button class="primary-button" data-action="confirm-abandon">LEAVE & START</button>
      <button class="secondary-button" data-action="cancel-abandon">KEEP CURRENT RUN</button>
    </section></div>`;
  }

  private pauseModalHtml(): string {
    return `<div class="modal-backdrop pause-backdrop" role="dialog" aria-modal="true" aria-labelledby="pause-title"><section class="modal-card pause-card manual-pause-card">
      <span class="pause-symbol">Ⅱ</span><p class="eyebrow">TAKE A BREATHER</p><h2 id="pause-title">GAME PAUSED</h2><p>Customers, tickets, and timers are frozen.</p>
      <button class="primary-button" data-action="resume">RESUME</button>
      <button class="secondary-button" data-action="settings">SETTINGS</button>
      <button class="text-button menu-exit-button" data-action="main-menu">MAIN MENU</button>
    </section></div>`;
  }

  private settingsModalHtml(): string {
    const toggle = (action: string, label: string, enabled: boolean, detail: string) => `<button class="setting-row" data-action="${action}" aria-pressed="${enabled}"><span><strong>${label}</strong><small>${detail}</small></span><i class="toggle ${enabled ? "is-on" : ""}"><b></b></i></button>`;
    return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title"><section class="modal-card settings-card"><header><div><p class="eyebrow">MAKE IT YOURS</p><h2 id="settings-title">SETTINGS</h2></div><button class="close-button" data-action="close-modal" aria-label="Close settings">×</button></header>
      ${toggle("toggle-music", "Music", this.save.settings.music, "Follows the YouTube audio setting")}
      ${toggle("toggle-sfx", "Sound effects", this.save.settings.sfx, "Order and feedback sounds")}
      ${toggle("toggle-motion", "Reduced motion", this.save.settings.reducedMotion, "Calmer pops and transitions")}
      <p class="settings-note">YouTube mute always takes priority over these controls.</p></section></div>`;
  }

  private guideModalHtml(): string {
    const guideItem: OrderItem = { type: "iceCream", base: "cone", scoops: ["strawberry"] };
    return `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="guide-title"><section class="modal-card guide-card"><header><div><p class="eyebrow">FOUR QUICK STEPS</p><h2 id="guide-title">HOW TO PLAY</h2></div><button class="close-button" data-action="close-modal" aria-label="Close guide">×</button></header>
      <div class="guide-steps"><article><b>1</b><span class="guide-customer">${customerSvg("regular", 0)}</span><strong>PICK A TICKET</strong><p>Tap the customer you want to serve.</p></article><article><b>2</b><span class="guide-dessert">${productHtml(guideItem)}</span><strong>BUILD AN ITEM</strong><p>Tap or drag the pictured ingredients.</p></article><article><b>3</b><span class="guide-serve">→</span><strong>SERVE EACH ITEM</strong><p>Every correct product leaves the ticket.</p></article><article><b>4</b><span class="guide-serve">✓</span><strong>FINISH FAST</strong><p>The last item completes the order automatically.</p></article></div>
      <div class="guide-tip">Locked products show their price. Cinnamon Rolls are built roll first, then icing.</div></section></div>`;
  }
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");
const game = new IceCreamRushApp(root);
void game.initialize();
