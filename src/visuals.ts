import { LABELS } from "./config";
import type {
  BaseId,
  BuildState,
  CinnamonGlazeId,
  CustomerKind,
  DrinkComponentId,
  FastDrinkId,
  FlavorId,
  IceCreamOrder,
  OrderItem,
  ToppingId,
  UpgradeId,
} from "./types";

const ASSET_ROOT = `${import.meta.env.BASE_URL}assets`;

const productAsset = (name: string) => `${ASSET_ROOT}/products/${name}.webp`;
const equipmentAsset = (name: string) => `${ASSET_ROOT}/equipment/${name}.webp`;
const characterAsset = (name: string) => `${ASSET_ROOT}/characters/${name}.webp`;

export function dessertHtml(dessert: Pick<BuildState, "base" | "scoops" | "topping"> | IceCreamOrder, compact = false): string {
  const topIndex = dessert.scoops.length - 1;
  const scoops = dessert.scoops.map((flavor, index) => {
    const topping = index === topIndex && dessert.topping
      ? `<img class="dessert-topping topping-${dessert.topping}" src="${productAsset(dessert.topping)}" alt="" draggable="false">`
      : "";
    return `<span class="dessert-scoop ${index === topIndex ? "is-top-scoop" : ""}" style="--stack:${index}" title="${LABELS[flavor]}"><img src="${productAsset(flavor)}" alt="" draggable="false">${topping}</span>`;
  }).join("");
  const base = dessert.base
    ? `<img class="dessert-base base-${dessert.base}" src="${productAsset(dessert.base)}" alt="" draggable="false">`
    : `<span class="dessert-base-placeholder"></span>`;
  return `<span class="dessert imagegen-dessert ${compact ? "dessert-compact" : ""} scoops-${dessert.scoops.length}" aria-hidden="true">${scoops}${base}</span>`;
}

export function productHtml(product: OrderItem | BuildState, compact = false): string {
  if (!product.type || product.type === "iceCream") return dessertHtml(product, compact);
  if (product.type === "fastDrink") return drinkHtml(product.drink ?? "lemonade", compact);
  if (product.type === "cinnamonRoll") {
    const glaze = "glaze" in product ? product.glaze : product.cinnamonGlaze;
    return cinnamonRollHtml(glaze, compact);
  }
  const progress = "bubbleSteps" in product ? product.bubbleSteps.length : 3;
  const asset = progress <= 1 ? "tea-cup" : progress === 2 ? "milk-tea" : "bubble-tea";
  return drinkHtml(asset, compact);
}

function cinnamonRollHtml(glaze: CinnamonGlazeId | undefined, compact: boolean): string {
  const suffix = glaze ? `-${glaze.replace("Glaze", "")}` : "";
  return `<span class="cinnamon-roll-product imagegen-cinnamon ${compact ? "cinnamon-compact" : ""}" aria-hidden="true"><img src="${productAsset(`cinnamon-roll${suffix}`)}" alt="" draggable="false"></span>`;
}

function drinkHtml(drink: FastDrinkId | "tea-cup" | "milk-tea" | "bubble-tea", compact: boolean): string {
  const asset = drink === "berrySoda" ? "berry-soda" : drink;
  return `<span class="drink-cup imagegen-drink ${compact ? "drink-compact" : ""}" aria-hidden="true"><img src="${productAsset(asset)}" alt="" draggable="false"></span>`;
}

export function orderItemIconsHtml(order: OrderItem): string {
  const title = order.type === "fastDrink"
    ? LABELS[order.drink]
    : order.type === "bubbleTea"
      ? "Bubble Tea"
      : order.type === "cinnamonRoll" ? `${LABELS[order.glaze]} Cinnamon Roll` : "Ice Cream";
  return `<span class="order-sequence order-product-preview" title="${title}">${productHtml(order, true)}</span>`;
}

export function ticketMiniHtml(ticket: readonly OrderItem[], activeIndex = 0): string {
  return `<span class="ticket-mini items-${ticket.length}">${ticket.map((item, index) => `<i class="ticket-mini-item type-${item.type} ${index === activeIndex ? "is-active" : ""}" data-ticket-index="${index}">${orderItemIconsHtml(item)}</i>`).join("")}</span>`;
}

export function ingredientIcon(
  kind: "base" | "flavor" | "topping" | "fastDrink" | "bubble" | "cinnamon",
  id: BaseId | FlavorId | ToppingId | FastDrinkId | DrinkComponentId | CinnamonGlazeId | "roll",
): string {
  const names: Record<string, string> = {
    berrySoda: "berry-soda",
    teaCup: "tea-cup",
    milkTea: "milk-tea",
    pearls: "pearls",
    roll: "cinnamon-roll",
    vanillaGlaze: "cinnamon-roll-vanilla",
    chocolateGlaze: "cinnamon-roll-chocolate",
    berryGlaze: "cinnamon-roll-berry",
  };
  return `<span class="ingredient-art imagegen-ingredient kind-${kind}"><img src="${productAsset(names[id] ?? id)}" alt="" draggable="false"></span>`;
}

export function upgradeIcon(id: UpgradeId): string {
  const ingredientMap: Partial<Record<UpgradeId, ["base" | "flavor" | "topping" | "fastDrink", BaseId | FlavorId | ToppingId | FastDrinkId]>> = {
    strawberry: ["flavor", "strawberry"],
    cup: ["base", "cup"],
    sprinkles: ["topping", "sprinkles"],
    mint: ["flavor", "mint"],
    waffle: ["base", "waffle"],
    drizzle: ["topping", "drizzle"],
    lemonade: ["fastDrink", "lemonade"],
    berrySoda: ["fastDrink", "berrySoda"],
  };
  const mapped = ingredientMap[id];
  if (mapped) return ingredientIcon(mapped[0], mapped[1]);
  if (id === "bubbleTea") return `<span class="ingredient-art imagegen-ingredient"><img src="${productAsset("bubble-tea")}" alt="" draggable="false"></span>`;
  if (id === "rollOven") return ingredientIcon("cinnamon", "roll");
  if (id === "chocolateIcing") return ingredientIcon("cinnamon", "chocolateGlaze");
  if (id === "berryIcing") return ingredientIcon("cinnamon", "berryGlaze");
  return `<span class="equipment-art imagegen-equipment"><img src="${equipmentAsset(id)}" alt="" draggable="false"></span>`;
}

export function customerSvg(kind: CustomerKind, variant: number): string {
  const count = kind === "regular" ? 4 : 2;
  const identity = `${kind}-${variant % count}`;
  const label = kind === "regular" ? "Customer" : `${kind} VIP customer`;
  return `<span class="customer-sprite" role="img" aria-label="${label}">
    <img class="mood-sprite mood-happy" src="${characterAsset(`${identity}-happy`)}" alt="" draggable="false">
    <img class="mood-sprite mood-worried" src="${characterAsset(`${identity}-worried`)}" alt="" draggable="false">
    <img class="mood-sprite mood-angry" src="${characterAsset(`${identity}-angry`)}" alt="" draggable="false">
    <img class="mood-sprite mood-urgent" src="${characterAsset(`${identity}-urgent`)}" alt="" draggable="false">
  </span>`;
}

export function heartSvg(filled: boolean): string {
  const fill = filled ? "#ff5f87" : "#eee4e9";
  const shade = filled ? "#dc365f" : "#d8cbd3";
  return `<svg class="heart-icon ${filled ? "is-filled" : "is-empty"}" viewBox="-3 -3 54 50" overflow="visible" aria-hidden="true">
    <path d="M24 40C17 35 5 27 5 15 5 7 10 3 17 3c4 0 7 2 9 6 2-4 5-6 9-6 7 0 12 5 12 12 0 12-12 20-23 25z" fill="${shade}" opacity=".38" transform="translate(0 2)"/>
    <path d="M24 38C16 33 4 25 4 14 4 6 10 2 17 2c4 0 7 2 9 7 2-5 5-7 9-7 7 0 13 5 13 12 0 11-12 19-24 24z" fill="${fill}" stroke="#49334f" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M11 13c1-4 4-6 8-6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" opacity="${filled ? ".72" : ".55"}"/>
  </svg>`;
}

export function cashSvg(): string {
  return `<svg class="cash-svg" viewBox="0 0 52 38" aria-hidden="true">
    <rect x="2" y="5" width="48" height="28" rx="7" fill="#70d6ae" stroke="#49334f" stroke-width="3"/>
    <path d="M8 12c4 0 6-2 7-4h22c1 2 3 4 7 4v14c-4 0-6 2-7 4H15c-1-2-3-4-7-4z" fill="#bdf0d6" stroke="#3d806b" stroke-width="2"/>
    <circle cx="26" cy="19" r="7" fill="#fff6c4" stroke="#49334f" stroke-width="2"/>
    <path d="M29 15.5c-1-1-5-1.2-5 1 0 2.4 5.6 1.1 5.6 4 0 2.2-4 2.5-6 1M26.5 13.7v10.6" fill="none" stroke="#49334f" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

export function resetSvg(): string {
  return `<svg class="reset-svg" viewBox="0 0 48 48" aria-hidden="true">
    <path d="M13 17a15 15 0 1 1-2 17" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M7 8v12h12" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M16 16l-9 4" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
    <circle cx="26" cy="25" r="5" fill="#ffcf61" stroke="currentColor" stroke-width="2.5"/>
  </svg>`;
}
