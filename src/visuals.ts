import { COLORS, LABELS } from "./config";
import type {
  BaseId,
  BuildState,
  CustomerKind,
  DrinkComponentId,
  FastDrinkId,
  FlavorId,
  IceCreamOrder,
  OrderItem,
  ToppingId,
  UpgradeId,
} from "./types";

const sprinklePieces = Array.from({ length: 18 }, (_, index) => `<i style="--piece:${index}"></i>`).join("");

export function dessertHtml(dessert: Pick<BuildState, "base" | "scoops" | "topping"> | IceCreamOrder, compact = false): string {
  const hasBase = Boolean(dessert.base);
  const topIndex = dessert.scoops.length - 1;
  const topping = dessert.topping
    ? `<span class="dessert-topping topping-${dessert.topping}">${dessert.topping === "sprinkles" ? sprinklePieces : ""}</span>`
    : "";
  const scoops = dessert.scoops
    .map(
      (flavor, index) =>
        `<span class="dessert-scoop ${index === topIndex ? "is-top-scoop" : ""}" style="--scoop:${COLORS[flavor]};--stack:${index}" title="${LABELS[flavor]}">${index === topIndex ? topping : ""}</span>`,
    )
    .join("");
  const base = hasBase ? `<span class="dessert-base base-${dessert.base}"></span>` : `<span class="dessert-base-placeholder"></span>`;
  return `<span class="dessert ${compact ? "dessert-compact" : ""} scoops-${dessert.scoops.length}" aria-hidden="true">${scoops}${base}</span>`;
}

export function productHtml(product: OrderItem | BuildState, compact = false): string {
  if (!product.type || product.type === "iceCream") return dessertHtml(product, compact);
  if (product.type === "fastDrink") return drinkHtml(product.drink, 1, compact);
  const progress = "bubbleSteps" in product ? product.bubbleSteps.length : 3;
  return drinkHtml("bubbleTea", progress, compact);
}

function drinkHtml(drink: FastDrinkId | "bubbleTea" | undefined, progress: number, compact: boolean): string {
  const kind = drink ?? "lemonade";
  const fill = kind === "bubbleTea" ? Math.max(0, Math.min(3, progress)) : 1;
  const liquidFill = kind === "bubbleTea" ? (fill >= 2 ? 74 : 0) : 74;
  return `<span class="drink-cup drink-${kind} bubble-progress-${fill} ${compact ? "drink-compact" : ""}" style="--drink-fill:${liquidFill}%" aria-hidden="true">
    <i class="drink-lid"></i><i class="drink-liquid"></i><i class="drink-pearls"></i><i class="drink-straw"></i>
  </span>`;
}

export function orderItemIconsHtml(order: OrderItem): string {
  if (order.type === "fastDrink") {
    return `<span class="order-sequence"><span class="order-token drink-token drink-token-${order.drink}" title="${LABELS[order.drink]}"><i></i></span></span>`;
  }
  if (order.type === "bubbleTea") {
    return `<span class="order-sequence"><span class="order-token drink-token drink-token-bubbleTea" title="Bubble Tea"><i></i></span></span>`;
  }
  const scoops = order.scoops
    .map(
      (flavor) =>
        `<span class="order-token scoop-token" style="--token:${COLORS[flavor]}" title="${LABELS[flavor]}"><i></i></span>`,
    )
    .join("");
  const topping = order.topping
    ? `<span class="order-token topping-token topping-token-${order.topping}" title="${LABELS[order.topping]}"><i></i></span>`
    : "";
  return `<span class="order-sequence"><span class="order-token base-token base-token-${order.base}" title="${LABELS[order.base]}"><i></i></span>${scoops}${topping}</span>`;
}

export function ticketMiniHtml(ticket: readonly OrderItem[]): string {
  return `<span class="ticket-mini">${ticket.map((item) => `<i class="ticket-mini-item type-${item.type}">${orderItemIconsHtml(item)}</i>`).join("")}</span>`;
}

export function ingredientIcon(
  kind: "base" | "flavor" | "topping" | "fastDrink" | "bubble",
  id: BaseId | FlavorId | ToppingId | FastDrinkId | DrinkComponentId,
): string {
  if (kind === "flavor") {
    const flavor = id as FlavorId;
    return `<span class="ingredient-art scoop-art" style="--flavor:${COLORS[flavor]}"><i></i></span>`;
  }
  if (kind === "base") return `<span class="ingredient-art base-art base-art-${id}"><i></i></span>`;
  if (kind === "topping") {
    return `<span class="ingredient-art topping-art topping-art-${id}"><i>${id === "sprinkles" ? sprinklePieces : ""}</i></span>`;
  }
  if (kind === "fastDrink") return `<span class="ingredient-art drink-art drink-art-${id}"><i></i></span>`;
  return `<span class="ingredient-art bubble-art bubble-art-${id}"><i></i></span>`;
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
  if (id === "bubbleTea") return `<span class="ingredient-art upgrade-art upgrade-bubble"><i></i></span>`;
  return `<span class="equipment-art equipment-${id}"><i></i></span>`;
}

export function customerSvg(kind: CustomerKind, variant: number): string {
  const skin = ["#8b553d", "#f1bd91", "#c98663", "#ffd5b5", "#6e402f", "#dca77f"][variant % 6];
  const hair = ["#402f3a", "#80523d", "#24233d", "#d58c46", "#5d3546", "#303c55"][variant % 6];
  const shirt = ["#7059d9", "#1fa9a4", "#f45b78", "#ef9e32", "#4c76d9", "#9a62d0"][variant % 6];
  const accessory = kind === "critic"
    ? `<path d="M49 76h25M86 76h25" stroke="#342d42" stroke-width="5"/><rect x="45" y="67" width="34" height="23" rx="8" fill="none" stroke="#342d42" stroke-width="5"/><rect x="81" y="67" width="34" height="23" rx="8" fill="none" stroke="#342d42" stroke-width="5"/>`
    : kind === "patient"
      ? `<path d="M121 58l10-13 7 17" fill="#ffd65a" stroke="#342d42" stroke-width="4" stroke-linejoin="round"/>`
      : "";
  return `<svg viewBox="0 0 160 176" role="img" aria-label="${kind === "regular" ? "Customer" : `${kind} VIP customer`}">
    <ellipse cx="80" cy="160" rx="56" ry="15" fill="#392c4d" opacity=".14"/>
    <path d="M35 161c2-42 18-61 45-61s44 19 46 61" fill="${shirt}" stroke="#342d42" stroke-width="6" stroke-linejoin="round"/>
    <path d="M61 114h38v28c-8 9-30 9-38 0z" fill="${skin}" stroke="#342d42" stroke-width="5"/>
    <ellipse cx="80" cy="70" rx="46" ry="51" fill="${skin}" stroke="#342d42" stroke-width="6"/>
    <path d="M38 66c-5-30 14-52 42-52 33 0 49 24 43 55-10-15-19-20-31-28-9 15-29 24-54 25z" fill="${hair}" stroke="#342d42" stroke-width="6" stroke-linejoin="round"/>
    <g class="face-eyes"><circle cx="62" cy="76" r="5" fill="#342d42"/><circle cx="98" cy="76" r="5" fill="#342d42"/></g>
    <g class="face-worried"><path d="M54 68l14 3M92 71l14-3" fill="none" stroke="#342d42" stroke-width="4" stroke-linecap="round"/><path d="M68 97h24" fill="none" stroke="#342d42" stroke-width="5" stroke-linecap="round"/></g>
    <g class="face-angry"><path d="M53 71l15-6M92 65l15 6" fill="none" stroke="#342d42" stroke-width="5" stroke-linecap="round"/><path d="M67 101c8-8 18-8 26 0" fill="none" stroke="#342d42" stroke-width="5" stroke-linecap="round"/></g>
    <path class="face-happy" d="M68 95c8 7 16 7 24 0" fill="none" stroke="#342d42" stroke-width="5" stroke-linecap="round"/>
    <circle cx="52" cy="90" r="7" fill="#f07982" opacity=".38"/><circle cx="108" cy="90" r="7" fill="#f07982" opacity=".38"/>
    ${accessory}
  </svg>`;
}

export function heartSvg(filled: boolean): string {
  return `<svg viewBox="0 0 40 36" aria-hidden="true"><path d="M20 33S3 23 3 11C3 3 13 0 20 8c7-8 17-5 17 3 0 12-17 22-17 22z" fill="${filled ? "#ff4f75" : "#eadde5"}" stroke="#5a3f5e" stroke-width="3"/></svg>`;
}
