import "@fontsource/fredoka/latin-600.css";
import "@fontsource/fredoka/latin-700.css";
import "./styles.css";

import { GameAudio } from "./audio";
import { FAST_THRESHOLD, LABELS, REVIVE_REWARD_ID, TRACK_LABELS, UPGRADES } from "./config";
import {
  allUpgradesOwned,
  availableBases,
  availableFastDrinks,
  availableFlavors,
  availableToppings,
  buildToItem,
  calculateReward,
  createRun,
  customerPatienceMs,
  emptyBuild,
  evaluateSubmission,
  generateTicket,
  itemToBuild,
  maxCustomers,
  migrateSave,
  nextCombo,
  nextUpgradeInTrack,
  nextVipTarget,
  spawnIntervalMs,
  timeoutLivesLost,
  upgradePrerequisite,
  upgradesForTrack,
} from "./game-logic";
import { YouTubePlatform } from "./platform";
import type {
  AdState,
  BaseId,
  CustomerKind,
  CustomerState,
  DrinkComponentId,
  FastDrinkId,
  FlavorId,
  IngredientSelection,
  OrderItem,
  RunState,
  SaveV2,
  ToppingId,
  UpgradeId,
} from "./types";
import {
  customerSvg,
  dessertHtml,
  heartSvg,
  ingredientIcon,
  orderItemIconsHtml,
  productHtml,
  ticketMiniHtml,
  upgradeIcon,
} from "./visuals";

type Screen = "menu" | "gameplay" | "gameover";
type Modal = "settings" | "guide" | "pause" | "platformPause" | "resumeGate" | null;

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

class IceCreamRushApp {
  private readonly platform = new YouTubePlatform();
  private readonly audio = new GameAudio();
  private save!: SaveV2;
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
  private drag?: DragState;
  private suppressClickUntil = 0;
  private purchaseLockUntil = 0;
  private readyCountdownMs = 0;
  private departure?: DepartureFeedback;
  private adState: AdState = "idle";
  private lastAdAt = -Infinity;
  private rewardFulfilled = false;

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
        if (!this.run) this.run = createRun(false);
        this.run.elapsedMs = elapsedMs;
        this.run.xp = Math.max(1_250, this.run.xp);
        this.run.runCoins = Math.max(320, this.run.runCoins);
        this.run.lives = 0;
        this.finishRun();
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
        if (!this.run) this.run = createRun(false);
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
          ticket,
          prepared: ticket.map(() => null),
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
      snapshot: () => ({ screen: this.screen, modal: this.modal, save: structuredClone(this.save), run: structuredClone(this.run) }),
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
    if (customerButton && this.canUseGameplayControls()) {
      this.selectCustomer(Number(customerButton.dataset.customerId));
      return;
    }

    const actionButton = target.closest<HTMLElement>("[data-action]");
    if (!actionButton || actionButton.getAttribute("aria-disabled") === "true" || actionButton.hasAttribute("disabled")) return;
    if (actionButton.dataset.action === "ingredient" && Date.now() < this.suppressClickUntil) return;
    switch (actionButton.dataset.action) {
      case "play":
        this.startNewRun();
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
      case "place-item":
        this.placeItemOnTray();
        break;
      case "serve-ticket":
        this.serveTicket();
        break;
      case "reset":
        this.resetBuild();
        break;
      case "ticket-slot":
        this.selectTicketSlot(Number(actionButton.dataset.index));
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
      const customer = this.selectedCustomer();
      if (customer?.prepared.every(Boolean)) this.serveTicket();
      else this.placeItemOnTray();
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
    return undefined;
  }

  private startNewRun(): void {
    this.run = createRun(!this.save.tutorialComplete);
    this.screen = "gameplay";
    this.modal = null;
    this.modalReturnTo = null;
    this.pauseReasons.clear();
    this.rewardFulfilled = false;
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
      this.startNewRun();
      return;
    }
    this.run = structuredClone(this.save.activeRun);
    this.screen = "gameplay";
    this.modal = null;
    this.modalReturnTo = null;
    this.pauseReasons.clear();
    this.departure = undefined;
    this.render();
    this.audio.resume();
    this.startLoop();
  }

  private spawnTutorialCustomer(): void {
    if (!this.run) return;
    const ticket: OrderItem[] = [{ type: "iceCream", base: "cone", scoops: ["vanilla"] }];
    const customer: CustomerState = {
      id: this.run.nextCustomerId++,
      kind: "regular",
      ticket,
      prepared: [null],
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
    const ticket = generateTicket(this.save.upgrades, kind, run.elapsedMs);
    const maxPatienceMs = customerPatienceMs(kind, this.save.upgrades, run.elapsedMs, ticket);
    const id = run.nextCustomerId++;
    const customer: CustomerState = {
      id,
      kind,
      ticket,
      prepared: ticket.map(() => null),
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

  private selectTicketSlot(index: number): void {
    const customer = this.selectedCustomer();
    if (!customer || !this.canUseGameplayControls() || index < 0 || index >= customer.ticket.length) return;
    if (customer.build.type && customer.activeItemIndex !== index) {
      this.showFeedback("Add or reset the current item first", "warning");
      return;
    }
    customer.activeItemIndex = index;
    const prepared = customer.prepared[index];
    if (prepared) {
      customer.prepared[index] = null;
      customer.build = itemToBuild(prepared);
      this.showFeedback(`Editing item ${index + 1}`, "warning");
    }
    this.applyAutoBase();
    this.audio.play("tap");
    this.render();
  }

  private applyAutoBase(): void {
    const customer = this.selectedCustomer();
    if (!customer || !this.save.upgrades.includes("autobase") || customer.build.type) return;
    const expected = customer.ticket[customer.activeItemIndex];
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

  private placeItemOnTray(): void {
    const customer = this.selectedCustomer();
    if (!customer || !this.canUseGameplayControls()) return;
    const item = buildToItem(customer.build);
    if (!item) {
      this.showFeedback("Finish this item first", "warning");
      return;
    }
    customer.prepared[customer.activeItemIndex] = item;
    customer.build = emptyBuild();
    const nextEmpty = customer.prepared.findIndex((prepared) => !prepared);
    if (nextEmpty >= 0) customer.activeItemIndex = nextEmpty;
    this.applyAutoBase();
    this.audio.play("tap");
    this.render();
    this.showFeedback(nextEmpty >= 0 ? `Item ready · build ${nextEmpty + 1}/${customer.ticket.length}` : "Tray complete · serve the order!", "success");
    this.queueSave();
  }

  private serveTicket(): void {
    const run = this.run;
    const customer = this.selectedCustomer();
    if (!run || !customer || !this.canUseGameplayControls()) return;
    if (!customer.prepared.every(Boolean)) {
      this.showFeedback("Fill every tray slot first", "warning");
      return;
    }
    this.advanceToNow();
    if (this.screen !== "gameplay") return;
    const submission = evaluateSubmission(customer.ticket, customer.prepared, customer.kind);
    if (submission.allCorrect) this.completeTicket(customer);
    else this.failTicket(customer, submission.partialCoins, submission.livesLost);
  }

  private completeTicket(customer: CustomerState): void {
    const run = this.run!;
    const remainingRatio = customer.remainingMs / customer.maxPatienceMs;
    const fast = remainingRatio >= FAST_THRESHOLD;
    run.combo = nextCombo(run.combo, remainingRatio, customer.kind !== "regular");
    run.bestCombo = Math.max(run.bestCombo, run.combo);
    const reward = calculateReward(customer.ticket, customer.kind, remainingRatio, run.combo);
    run.xp += reward.xp;
    run.runCoins += reward.coins;
    this.save.coins += reward.coins;
    this.removeCustomer(customer.id, true);
    if (run.tutorial) {
      run.tutorial = false;
      this.save.tutorialComplete = true;
      run.spawnRemainingMs = 500;
    }
    this.applyAutoBase();
    this.render();
    this.audio.play(customer.kind !== "regular" || fast ? "fast" : "success");
    this.showFeedback(
      customer.kind !== "regular"
        ? `VIP ticket complete · +${reward.coins} · COMBO x4`
        : `${fast ? "FAST! · " : ""}+${reward.coins} coins · +${reward.xp} XP`,
      fast || customer.kind !== "regular" ? "fast" : "success",
    );
    this.queueSave();
  }

  private failTicket(customer: CustomerState, partialCoins: number, livesLost: number): void {
    const run = this.run!;
    run.combo = 1;
    if (run.tutorial) {
      customer.prepared = customer.ticket.map(() => null);
      customer.activeItemIndex = 0;
      customer.build = emptyBuild();
      customer.remainingMs = customer.maxPatienceMs;
      this.render();
      this.audio.play("wrong");
      this.showFeedback("Try again — match every picture", "error");
      return;
    }
    run.runCoins += partialCoins;
    this.save.coins += partialCoins;
    this.departure = { kind: customer.kind, variant: customer.variant, remainingMs: 520 };
    this.removeCustomer(customer.id, false);
    if (livesLost > 0) this.loseLives(livesLost);
    if (this.screen === "gameover") return;
    this.render();
    this.audio.play("wrong");
    this.showFeedback(
      customer.kind === "critic"
        ? `Critic rejected the ticket · −2 hearts · +${partialCoins}`
        : `Customer left angry · partial payment +${partialCoins}`,
      "error",
    );
    this.queueSave();
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
    if (run.lives === 0) this.finishRun();
  }

  private finishRun(): void {
    const run = this.run;
    if (!run || this.screen === "gameover") return;
    this.stopLoop();
    this.screen = "gameover";
    this.modal = null;
    this.pauseReasons.clear();
    const newBest = run.xp > this.save.bestScore;
    if (newBest) this.save.bestScore = run.xp;
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

    run.elapsedMs += delta;
    run.spawnRemainingMs -= delta;
    const expired: CustomerState[] = [];
    for (const customer of run.customers) {
      customer.remainingMs -= delta;
      if (customer.remainingMs <= 0) expired.push(customer);
    }
    if (expired.length > 0) {
      for (const customer of expired) {
        if (!run.customers.some((item) => item.id === customer.id)) continue;
        this.removeCustomer(customer.id, false);
        run.combo = 1;
        this.audio.play("timeout");
        this.loseLives(timeoutLivesLost(customer.kind));
        if (this.screen === "gameover") return;
      }
      this.render();
      this.showFeedback(expired.some((item) => item.kind === "critic") ? "Critic left · −2 hearts" : "Customer left · −1 heart", "timeout");
      this.queueSave();
    }

    if (run.spawnRemainingMs <= 0) {
      if (run.customers.length < maxCustomers(this.save.upgrades)) {
        this.spawnCustomer();
        run.spawnRemainingMs = spawnIntervalMs(this.save.upgrades, run.elapsedMs);
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
    this.modal = null;
    this.render();
  }

  private openManualPause(): void {
    if (this.screen !== "gameplay" || this.modal || this.pauseReasons.has("sdk")) return;
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
      this.showFeedback(`Need ${upgrade.price - this.save.coins} more coins`, "warning");
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
    if (!run || run.reviveUsed || this.adState === "requesting" || this.adState === "showing") return;
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
    this.startNewRun();
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
    return items;
  }

  private canUseGameplayControls(): boolean {
    return this.screen === "gameplay" && this.pauseReasons.size === 0 && !this.modal && this.readyCountdownMs <= 0;
  }

  private captureActiveRun(): void {
    this.save.activeRun = this.screen === "gameplay" && this.run ? structuredClone(this.run) : null;
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

  private showFeedback(message: string, tone: "success" | "fast" | "warning" | "error" | "timeout" | "unlock"): void {
    const feedback = this.root.querySelector<HTMLElement>("#feedback");
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = `feedback is-visible feedback-${tone}`;
    if (this.feedbackTimer !== undefined) window.clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => feedback.classList.remove("is-visible"), 1_700);
  }

  private render(): void {
    this.root.classList.toggle("reduce-motion", this.save?.settings.reducedMotion ?? false);
    if (this.screen === "menu") this.renderMenu();
    else if (this.screen === "gameover") this.renderGameOver();
    else this.renderGameplay();
  }

  private renderMenu(): void {
    const hasContinue = Boolean(this.save.activeRun);
    const heroOrder: OrderItem = { type: "iceCream", base: "cone", scoops: ["strawberry", "vanilla"], topping: "sprinkles" };
    this.root.innerHTML = `<main class="menu-screen">
      <div class="parlor-bg" aria-hidden="true"><span class="awning"></span><span class="sun-dot dot-one"></span><span class="sun-dot dot-two"></span></div>
      <section class="menu-card">
        <p class="eyebrow">ENDLESS TIME MANAGEMENT</p>
        <h1 class="game-logo"><span>ICE CREAM</span><strong>RUSH</strong></h1>
        <p class="menu-tagline">Build it. Tray it. Beat the rush.</p>
        <div class="hero-counter" aria-hidden="true">
          <div class="hero-customer">${customerSvg("regular", 3)}</div>
          <div class="hero-order">${orderItemIconsHtml(heroOrder)}</div>
          <div class="hero-dessert">${dessertHtml(heroOrder)}</div>
        </div>
        <button class="primary-button play-button" data-action="${hasContinue ? "continue" : "play"}">${hasContinue ? "CONTINUE RUN" : "PLAY NOW"}<span>→</span></button>
        <div class="menu-links"><button class="text-button" data-action="guide">HOW TO PLAY</button><button class="text-button" data-action="settings">SETTINGS</button></div>
        <div class="menu-stats"><span>BEST <strong>${this.save.bestScore.toLocaleString("en-US")}</strong></span><span>COINS <strong>${this.save.coins.toLocaleString("en-US")}</strong></span></div>
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
    const tutorial = run.tutorial ? this.tutorialHtml() : "";
    const countdown = this.readyCountdownMs > 0
      ? `<div class="countdown-overlay"><p>GET READY</p><strong data-countdown>${Math.max(1, Math.ceil(this.readyCountdownMs / 1000))}</strong></div>`
      : "";
    const trayComplete = Boolean(selected?.prepared.every(Boolean));
    const primaryAction = trayComplete ? "serve-ticket" : "place-item";
    const primaryLabel = trayComplete ? "SERVE ORDER" : "ADD TO TRAY";
    this.root.innerHTML = `<main class="game-screen combo-${run.combo}">
      <header class="game-hud">
        <div class="hud-pill coins-pill"><span class="hud-icon coin-icon">$</span><span><small>COINS</small><strong>${this.save.coins.toLocaleString("en-US")}</strong></span></div>
        <div class="hud-pill score-pill"><span><small>XP</small><strong>${run.xp.toLocaleString("en-US")}</strong></span></div>
        <div class="combo-badge"><small>COMBO</small><strong>x${run.combo}</strong></div>
        <div class="lives" aria-label="${run.lives} lives remaining">${hearts}</div>
        <button class="pause-button" data-action="pause" aria-label="Pause game"><i></i><i></i></button>
      </header>
      <section class="rush-stage">
        <div class="shop-scene" aria-hidden="true"><span class="menu-board">TODAY'S RUSH</span><span class="lamp lamp-left"></span><span class="lamp lamp-right"></span></div>
        <div class="customer-lane" style="--slots:${slots}">${customerCards}${placeholders}</div>
        <section class="assembly-panel">
          ${this.ticketBoardHtml(selected)}
          <div class="assembly-dropzone" aria-label="Current product build">
            <span class="counter-ring" aria-hidden="true"></span>
            ${selected ? productHtml(selected.build) : productHtml(emptyBuild())}
            <span class="drop-hint">DROP HERE</span>
          </div>
          <div class="assembly-actions">
            <button class="reset-button" data-action="reset" aria-label="Reset current build"><span class="trash-lid"></span><span class="trash-can"></span><b>RESET</b></button>
            <button class="serve-button" data-action="${primaryAction}">${primaryLabel}<span>→</span></button>
          </div>
          ${tutorial}
        </section>
        ${this.departure ? `<div class="angry-exit" aria-hidden="true"><span>${customerSvg(this.departure.kind, this.departure.variant)}</span><b>!</b></div>` : ""}
      </section>
      ${this.ingredientTrayHtml()}
      ${this.equipmentDockHtml()}
      ${countdown}
      ${this.modalHtml()}
      <div id="feedback" class="feedback" role="status"></div>
    </main>`;
    this.updateLiveDom();
  }

  private customerCardHtml(customer: CustomerState): string {
    const run = this.run!;
    const ratio = Math.max(0, Math.min(1, customer.remainingMs / customer.maxPatienceMs));
    const selected = customer.id === run.selectedCustomerId;
    const vip = customer.kind !== "regular";
    return `<button class="customer-card mood-happy ${selected ? "is-selected" : ""} ${vip ? "is-vip" : ""} kind-${customer.kind}" style="--patience:${ratio};--stress:${1 - ratio}" data-customer-id="${customer.id}" aria-label="Select ${customer.kind} customer ticket ${customer.id}">
      <span class="customer-stress"></span>
      <span class="order-bubble">${ticketMiniHtml(customer.ticket)}${vip ? `<b>${customer.kind === "critic" ? "CRITIC · 2♥" : "PATIENT VIP"}</b>` : ""}</span>
      <span class="customer-portrait">${customerSvg(customer.kind, customer.variant)}</span>
      <span class="patience-track"><i></i></span>
      <span class="customer-number">#${customer.id} · ${customer.ticket.length} ITEM${customer.ticket.length === 1 ? "" : "S"}</span>
    </button>`;
  }

  private ticketBoardHtml(customer: CustomerState | undefined): string {
    if (!customer) return `<aside class="ticket-board is-empty"><p>WAITING FOR CUSTOMER</p></aside>`;
    const slots = customer.ticket.map((expected, index) => {
      const prepared = customer.prepared[index];
      const active = index === customer.activeItemIndex;
      return `<button class="ticket-slot ${active ? "is-active" : ""} ${prepared ? "is-ready" : ""}" data-action="ticket-slot" data-index="${index}" aria-label="${prepared ? "Edit" : "Build"} ticket item ${index + 1}">
        <small>${index + 1}</small><span class="ticket-expected">${orderItemIconsHtml(expected)}</span>
        <span class="ticket-prepared">${prepared ? orderItemIconsHtml(prepared) : active ? "BUILDING" : "EMPTY"}</span>
      </button>`;
    }).join("");
    return `<aside class="ticket-board"><p>ORDER #${customer.id} · ${customer.prepared.filter(Boolean).length}/${customer.ticket.length} READY</p><div>${slots}</div></aside>`;
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
    const lockedButton = (kind: "base" | "flavor" | "topping" | "fastDrink", id: BaseId | FlavorId | ToppingId | FastDrinkId, upgradeId: UpgradeId) => {
      if (this.save.upgrades.includes(upgradeId)) return ownedButton(kind, id);
      const upgrade = UPGRADES.find((item) => item.id === upgradeId)!;
      const prerequisite = upgradePrerequisite(this.save.upgrades, upgradeId);
      const affordable = this.save.coins >= upgrade.price && !prerequisite;
      return `<button class="ingredient-button locked-product ${affordable ? "can-buy" : ""} ${prerequisite ? "chain-locked" : ""}" data-action="buy-upgrade" data-upgrade="${upgradeId}" aria-label="Unlock ${upgrade.name} for ${upgrade.price} coins${prerequisite ? ` after ${prerequisite.name}` : ""}">
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
    return `<aside class="ingredient-tray" aria-label="Product showcase">
      <div class="ingredient-group"><p>BASES</p><div>${bases}</div></div>
      <div class="ingredient-group"><p>SCOOPS</p><div>${flavors}</div></div>
      <div class="ingredient-group"><p>TOPPINGS</p><div>${toppings}</div></div>
      <div class="ingredient-group drinks-group"><p>DRINKS</p><div>${drinks}</div></div>
    </aside>`;
  }

  private bubbleTeaLockedButton(): string {
    const upgrade = UPGRADES.find((item) => item.id === "bubbleTea")!;
    const prerequisite = upgradePrerequisite(this.save.upgrades, "bubbleTea");
    const affordable = this.save.coins >= upgrade.price && !prerequisite;
    return `<button class="ingredient-button locked-product ${affordable ? "can-buy" : ""} ${prerequisite ? "chain-locked" : ""}" data-action="buy-upgrade" data-upgrade="bubbleTea" aria-label="Unlock Bubble Tea for ${upgrade.price} coins${prerequisite ? ` after ${prerequisite.name}` : ""}">
      ${upgradeIcon("bubbleTea")}<span>Bubble Tea</span><b class="product-lock" aria-hidden="true">🔒</b><b class="unlock-price">$${upgrade.price.toLocaleString("en-US")}</b><em class="product-prerequisite">${prerequisite ? `AFTER ${prerequisite.name}` : "READY TO BUY"}</em>
    </button>`;
  }

  private equipmentDockHtml(): string {
    const items = upgradesForTrack("equipment").map((upgrade) => {
      const owned = this.save.upgrades.includes(upgrade.id);
      const prerequisite = upgradePrerequisite(this.save.upgrades, upgrade.id);
      const next = nextUpgradeInTrack(this.save.upgrades, "equipment")?.id === upgrade.id;
      const affordable = next && this.save.coins >= upgrade.price;
      return `<button class="equipment-button ${owned ? "is-owned" : ""} ${affordable ? "can-buy" : ""} ${prerequisite ? "chain-locked" : ""}" data-action="buy-upgrade" data-upgrade="${upgrade.id}" ${owned ? "aria-disabled=\"true\"" : ""} aria-label="${owned ? `${upgrade.name} owned` : `Unlock ${upgrade.name} for ${upgrade.price} coins`}" title="${upgrade.name} · ${upgrade.effect}">
        ${upgradeIcon(upgrade.id)}<span>${owned ? "✓" : prerequisite ? "🔒" : `$${upgrade.price.toLocaleString("en-US")}`}</span>
      </button>`;
    }).join("");
    return `<aside class="equipment-dock" aria-label="Equipment upgrades"><p>${TRACK_LABELS.equipment}</p>${items}</aside>`;
  }

  private tutorialHtml(): string {
    const customer = this.selectedCustomer();
    if (!customer) return "";
    const build = customer.build;
    const trayReady = customer.prepared.every(Boolean);
    const text = trayReady
      ? "Great! Serve the complete order"
      : !build.type || (build.type === "iceCream" && !build.base)
        ? "Tap or drag the glowing cone"
        : build.type === "iceCream" && build.scoops.length === 0
          ? "Great! Add the vanilla scoop"
          : "Perfect — add it to the tray";
    return `<div class="tutorial-coach"><span>FIRST ORDER</span><strong>${text}</strong><i></i></div>`;
  }

  private renderGameOver(): void {
    const run = this.run;
    if (!run) return;
    const adBusy = this.adState === "requesting" || this.adState === "showing";
    this.root.innerHTML = `<main class="result-screen">
      <div class="result-sprinkles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <section class="result-card">
        <p class="eyebrow">THE RUSH IS OVER</p><h1>NICE SERVING!</h1>
        <div class="result-score"><small>XP SCORE</small><strong>${run.xp.toLocaleString("en-US")}</strong><span>${run.xp > 0 && run.xp === this.save.bestScore ? "NEW BEST" : `BEST ${this.save.bestScore.toLocaleString("en-US")}`}</span></div>
        <div class="result-grid"><span><small>COINS EARNED</small><strong>+${run.runCoins.toLocaleString("en-US")}</strong></span><span><small>BEST COMBO</small><strong>x${run.bestCombo}</strong></span><span><small>PARLOR</small><strong>${this.save.upgrades.length}/${UPGRADES.length}</strong></span></div>
        ${!run.reviveUsed ? `<button class="reward-button" data-action="revive" ${adBusy ? "disabled" : ""}><span class="ad-mark">AD</span><span><strong>CONTINUE WITH 1 HEART</strong><small>Watch a rewarded ad</small></span></button>` : ""}
        <button class="primary-button retry-button" data-action="retry" ${adBusy ? "disabled" : ""}>${adBusy ? "PLEASE WAIT…" : "PLAY AGAIN"}<span>→</span></button>
        <p class="result-note">Your upgrades and coins are saved.</p>
      </section><div id="feedback" class="feedback" role="status"></div>
    </main>`;
  }

  private modalHtml(): string {
    if (!this.modal) return "";
    if (this.modal === "settings") return this.settingsModalHtml();
    if (this.modal === "guide") return this.guideModalHtml();
    if (this.modal === "pause") return this.pauseModalHtml();
    const platformPause = this.modal === "platformPause";
    return `<div class="modal-backdrop pause-backdrop" role="dialog" aria-modal="true" aria-label="Game paused">
      <section class="modal-card pause-card"><span class="pause-symbol">${platformPause ? "Ⅱ" : "▶"}</span><p class="eyebrow">${platformPause ? "YOUTUBE PAUSE" : "READY WHEN YOU ARE"}</p><h2>${platformPause ? "GAME PAUSED" : "TAP TO RESUME"}</h2><p>Your full ticket is frozen exactly where you left it.</p>${platformPause ? "" : `<button class="primary-button" data-action="resume">RESUME</button>`}</section>
    </div>`;
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
      <div class="guide-steps"><article><b>1</b><span class="guide-customer">${customerSvg("regular", 0)}</span><strong>PICK A TICKET</strong><p>Tap the customer you want to serve.</p></article><article><b>2</b><span class="guide-dessert">${productHtml(guideItem)}</span><strong>BUILD ITEMS</strong><p>Tap or drag the pictured ingredients.</p></article><article><b>3</b><span class="guide-serve">＋</span><strong>FILL THE TRAY</strong><p>Add every requested item to its slot.</p></article><article><b>4</b><span class="guide-serve">→</span><strong>SERVE FAST</strong><p>Serve above 70% patience to grow combo.</p></article></div>
      <div class="guide-tip">Locked products show their price. Each product branch unlocks in order.</div></section></div>`;
  }
}

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");
const game = new IceCreamRushApp(root);
void game.initialize();
