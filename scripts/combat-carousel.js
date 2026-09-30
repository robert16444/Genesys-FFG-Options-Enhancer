import { Lang } from "./i18n.js";

const MODULE_ID = "genesys-ffg-options-enhancer";
const CAROUSEL_ID = "gfoe-combat-carousel";
const MYSTERY_IMG = "icons/svg/mystery-man.svg";
let hooksRegistered = false;
let renderTimer = null;

function isEnabled() {
  try {
    return Boolean(game.settings.get(MODULE_ID, "enableCombatCarousel"));
  } catch (_) {
    return true;
  }
}

function genericSlotsEnabled() {
  try {
    return Boolean(game.settings.get("starwarsffg", "useGenericSlots"));
  } catch (_) {
    return false;
  }
}

function combatSceneId(combat) {
  const scene = combat?.scene;
  return typeof scene === "string" ? scene : scene?.id ?? combat?._source?.scene ?? null;
}

function activeCombat() {
  const combat = game.combat;
  if (!combat) return null;
  if (!(combat.started === true || Number(combat.round ?? 0) > 0)) return null;
  if (!Array.from(combat.turns ?? []).length) return null;
  const sceneId = combatSceneId(combat);
  if (sceneId && canvas?.scene?.id && sceneId !== canvas.scene.id) return null;
  return combat;
}

function dispositionOf(value) {
  const raw = value?.disposition
    ?? value?.token?.disposition
    ?? value?.token?.document?.disposition
    ?? value?.actor?.token?.disposition
    ?? value?.flags?.starwarsffg?.disposition
    ?? value?.flags?.disposition;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : CONST.TOKEN_DISPOSITIONS.NEUTRAL;
}

function slotKind(disposition) {
  if (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return "pc";
  if (disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE || disposition === CONST.TOKEN_DISPOSITIONS.SECRET) return "npc";
  return "neutral";
}

function slotLabel(kind) {
  if (kind === "pc") return Lang.t("combatCarousel.pcSlot");
  if (kind === "npc") return Lang.t("combatCarousel.npcSlot");
  return Lang.t("combatCarousel.neutralSlot");
}

function claimForSlot(combat, slotId) {
  try {
    return combat.getSlotClaims?.(combat.round, slotId)
      ?? combat.getFlag?.("starwarsffg", "combatClaims")?.[combat.round]?.[slotId]
      ?? null;
  } catch (_) {
    return null;
  }
}

function claimantForSlot(combat, slotId) {
  const claimantId = claimForSlot(combat, slotId);
  if (!claimantId) return null;
  return combat.combatants?.get?.(claimantId)
    ?? Array.from(combat.combatants ?? []).find(entry => entry?.id === claimantId)
    ?? null;
}

function tokenHidden(combatant) {
  return Boolean(combatant?.token?.hidden ?? combatant?.hidden ?? false);
}

function claimantImage(combatant) {
  return combatant?.img
    ?? combatant?.token?.texture?.src
    ?? combatant?.token?.document?.texture?.src
    ?? combatant?.actor?.img
    ?? MYSTERY_IMG;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatInitiative(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toFixed(2);
}

function canUserClaimSlot(disposition, claimed) {
  if (claimed) return false;
  if (game.user?.isGM) return true;
  return disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
}

function waitingCombatantCount(combat, disposition) {
  try {
    if (typeof combat._getCombatantStateCount === "function") return Number(combat._getCombatantStateCount(disposition)) || 0;
  } catch (_) {}
  return Array.from(combat.combatants ?? []).filter(entry => dispositionOf(entry) === disposition && !entry.isDefeated && !combat.hasClaims?.(entry.id)).length;
}

function slotData(combat, turn, index, unused = false) {
  const base = combat.combatants?.get?.(turn.id) ?? turn;
  const disposition = dispositionOf(base);
  const kind = slotKind(disposition);
  const claimant = claimantForSlot(combat, turn.id);
  const hidden = claimant ? tokenHidden(claimant) : false;
  const hideIdentity = Boolean(claimant && hidden && !game.user?.isGM);
  const name = claimant
    ? (hideIdentity ? (kind === "npc" ? Lang.t("combatCarousel.hiddenNpc") : Lang.t("combatCarousel.hiddenCombatant")) : claimant.name)
    : Lang.t("combatCarousel.freeSlot");
  const image = claimant ? (hideIdentity ? MYSTERY_IMG : claimantImage(claimant)) : null;
  const active = Number(combat.turn) === index;
  return {
    index,
    slotId: turn.id,
    disposition,
    kind,
    label: slotLabel(kind),
    initiative: formatInitiative(turn.initiative),
    claimant,
    name,
    image,
    active,
    claimed: Boolean(claimant),
    canClaim: active && !unused && canUserClaimSlot(disposition, Boolean(claimant)),
    hiddenIdentity: hideIdentity,
    unused
  };
}

function renderSlot(slot) {
  const classes = ["gfoe-carousel-slot", `gfoe-carousel-${slot.kind}`];
  if (slot.active) classes.push("is-active");
  if (slot.claimed) classes.push("is-claimed");
  else classes.push("is-free");
  if (slot.unused) classes.push("is-unused");
  const body = slot.claimed
    ? `<button type="button" class="gfoe-carousel-portrait" data-gfoe-carousel-focus="${escapeHtml(slot.claimant?.id)}" title="${escapeHtml(slot.name)}" ${slot.hiddenIdentity ? "disabled" : ""}><img src="${escapeHtml(slot.image)}" alt="${escapeHtml(slot.name)}"></button><div class="gfoe-carousel-name" title="${escapeHtml(slot.name)}">${escapeHtml(slot.name)}</div>`
    : `<div class="gfoe-carousel-empty"><i class="fa-solid ${slot.unused ? "fa-ban" : slot.kind === "pc" ? "fa-user-plus" : slot.kind === "npc" ? "fa-skull" : "fa-circle-question"}"></i><span>${escapeHtml(slot.unused ? Lang.t("combatCarousel.unused") : Lang.t("combatCarousel.free"))}</span></div>`;
  const claimButton = slot.canClaim
    ? `<button type="button" class="gfoe-carousel-claim" data-gfoe-carousel-claim="${escapeHtml(slot.slotId)}"><i class="fa-solid fa-hand"></i>${escapeHtml(Lang.t("combatCarousel.claim"))}</button>`
    : "";
  const activeBadge = slot.active ? `<span class="gfoe-carousel-active-badge">${escapeHtml(Lang.t("combatCarousel.current"))}</span>` : "";
  return `<article class="${classes.join(" ")}" data-gfoe-carousel-index="${slot.index}" data-gfoe-carousel-slot="${escapeHtml(slot.slotId)}">
    <div class="gfoe-carousel-slot-head"><span>${escapeHtml(slot.label)}</span><span class="gfoe-carousel-init">${escapeHtml(slot.initiative)}</span></div>
    ${activeBadge}
    <div class="gfoe-carousel-slot-body">${body}</div>
    ${claimButton}
  </article>`;
}

function buildHtml(combat) {
  const counters = new Map();
  const waiting = new Map();
  const slots = Array.from(combat.turns ?? []).map((turn, index) => {
    const base = combat.combatants?.get?.(turn.id) ?? turn;
    const disposition = dispositionOf(base);
    const claimant = claimantForSlot(combat, turn.id);
    let unused = false;
    if (!claimant) {
      const count = (counters.get(disposition) ?? 0) + 1;
      counters.set(disposition, count);
      if (!waiting.has(disposition)) waiting.set(disposition, waitingCombatantCount(combat, disposition));
      unused = count > (waiting.get(disposition) ?? 0);
    }
    return slotData(combat, turn, index, unused);
  });
  return `<div id="${CAROUSEL_ID}" class="gfoe-combat-carousel" data-combat-id="${escapeHtml(combat.id)}">
    <div class="gfoe-carousel-shell">
      <button type="button" class="gfoe-carousel-nav gfoe-carousel-prev" aria-label="${escapeHtml(Lang.t("combatCarousel.previous"))}" title="${escapeHtml(Lang.t("combatCarousel.previous"))}"><i class="fa-solid fa-chevron-left"></i></button>
      <div class="gfoe-carousel-viewport">
        <div class="gfoe-carousel-track">${slots.map(renderSlot).join("")}</div>
      </div>
      <button type="button" class="gfoe-carousel-nav gfoe-carousel-next" aria-label="${escapeHtml(Lang.t("combatCarousel.next"))}" title="${escapeHtml(Lang.t("combatCarousel.next"))}"><i class="fa-solid fa-chevron-right"></i></button>
      <div class="gfoe-carousel-round">${escapeHtml(Lang.t("combatCarousel.round", { round: combat.round ?? 1 }))}</div>
    </div>
  </div>`;
}

function removeCarousel() {
  document.getElementById(CAROUSEL_ID)?.remove();
}

function scrollToCard(root, index, behavior = "smooth") {
  const viewport = root?.querySelector?.(".gfoe-carousel-viewport");
  const card = root?.querySelector?.(`[data-gfoe-carousel-index="${index}"]`);
  if (!viewport || !card) return;
  const target = card.offsetLeft - (viewport.clientWidth - card.offsetWidth) / 2;
  viewport.scrollTo({ left: Math.max(0, target), behavior });
}

function nearestCardIndex(root) {
  const viewport = root?.querySelector?.(".gfoe-carousel-viewport");
  const cards = Array.from(root?.querySelectorAll?.("[data-gfoe-carousel-index]") ?? []);
  if (!viewport || !cards.length) return 0;
  const center = viewport.scrollLeft + viewport.clientWidth / 2;
  let best = cards[0];
  let distance = Infinity;
  for (const card of cards) {
    const cardCenter = card.offsetLeft + card.offsetWidth / 2;
    const nextDistance = Math.abs(cardCenter - center);
    if (nextDistance < distance) {
      best = card;
      distance = nextDistance;
    }
  }
  return Number(best.dataset.gfoeCarouselIndex ?? 0);
}

function resolveClaimToken() {
  const controlled = Array.from(canvas?.tokens?.controlled ?? []);
  const owned = Array.from(canvas?.tokens?.ownedTokens ?? []);
  if (owned.length === 1) return owned[0];
  if (controlled.length === 1) return controlled[0];
  return null;
}

function combatantForToken(combat, token) {
  if (!combat || !token) return null;
  const tokenId = token.document?.id ?? token.id;
  const actorId = token.actor?.id;
  return Array.from(combat.combatants ?? []).find(entry => entry?.tokenId === tokenId)
    ?? Array.from(combat.combatants ?? []).find(entry => entry?.actorId === actorId)
    ?? null;
}

async function claimSlot(slotId) {
  const combat = activeCombat();
  if (!combat || !slotId) return;
  if (claimForSlot(combat, slotId)) {
    ui.notifications?.warn(Lang.t("combatCarousel.alreadyClaimed"));
    return;
  }
  const token = resolveClaimToken();
  if (!token) {
    ui.notifications?.warn(Lang.t("combatCarousel.selectOneToken"));
    return;
  }
  const claimant = combatantForToken(combat, token);
  if (!claimant) {
    ui.notifications?.warn(Lang.t("combatCarousel.notInCombat"));
    return;
  }
  if (claimant.isDefeated) {
    ui.notifications?.warn(Lang.t("combatCarousel.defeated"));
    return;
  }
  if (combat.findSlotClaims?.(combat.round, claimant.id)) {
    ui.notifications?.warn(Lang.t("combatCarousel.alreadyHasSlot"));
    return;
  }
  const turns = Array.from(combat.turns ?? []);
  const slotIndex = turns.findIndex(turn => turn?.id === slotId);
  if (slotIndex < 0 || slotIndex !== Number(combat.turn)) {
    ui.notifications?.warn(Lang.t("combatCarousel.onlyCurrent"));
    return;
  }
  const slotCombatant = combat.combatants?.get?.(slotId) ?? turns[slotIndex];
  const slotDisposition = dispositionOf(slotCombatant);
  let freeBefore = 0;
  for (let index = 0; index <= slotIndex; index += 1) {
    const turn = turns[index];
    const turnBase = combat.combatants?.get?.(turn.id) ?? turn;
    if (dispositionOf(turnBase) !== slotDisposition) continue;
    if (!claimantForSlot(combat, turn.id)) freeBefore += 1;
  }
  if (freeBefore > waitingCombatantCount(combat, slotDisposition)) {
    ui.notifications?.warn(Lang.t("combatCarousel.unusedSlot"));
    return;
  }
  const claimantDisposition = dispositionOf(claimant);
  if (slotDisposition !== claimantDisposition) {
    ui.notifications?.warn(Lang.t("combatCarousel.wrongSlotType"));
    return;
  }
  if (!game.user?.isGM && slotDisposition !== CONST.TOKEN_DISPOSITIONS.FRIENDLY) {
    ui.notifications?.warn(Lang.t("combatCarousel.gmOnlyNpc"));
    return;
  }
  await combat.claimSlot(combat.round, slotId, claimant.id);
  queueCarouselRender(80);
}

async function focusClaimant(combatantId) {
  if (!combatantId) return;
  const combat = activeCombat();
  const combatant = combat?.combatants?.get?.(combatantId);
  const tokenId = combatant?.tokenId ?? combatant?.token?.id;
  if (!tokenId) return;
  const token = canvas?.tokens?.get?.(tokenId) ?? canvas?.tokens?.placeables?.find?.(entry => entry?.id === tokenId);
  if (!token || (token.document?.hidden && !game.user?.isGM)) return;
  try {
    token.control({ releaseOthers: true });
  } catch (_) {}
  try {
    await canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
  } catch (_) {}
}

async function changeCombatTurn(direction) {
  const combat = activeCombat();
  if (!combat || !game.user?.isGM) return;
  if (direction < 0) {
    if (typeof combat.previousTurn === "function") await combat.previousTurn();
  } else if (typeof combat.nextTurn === "function") {
    await combat.nextTurn();
  }
  queueCarouselRender(20, true);
}

function activateCarousel(root) {
  const viewport = root.querySelector(".gfoe-carousel-viewport");
  const previousButton = root.querySelector(".gfoe-carousel-prev");
  const nextButton = root.querySelector(".gfoe-carousel-next");
  if (!game.user?.isGM) {
    if (previousButton) previousButton.disabled = true;
    if (nextButton) nextButton.disabled = true;
  }
  previousButton?.addEventListener("click", async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try {
      await changeCombatTurn(-1);
    } catch (error) {
      console.error(`${MODULE_ID} | previous combat turn failed`, error);
    } finally {
      button.disabled = false;
    }
  });
  nextButton?.addEventListener("click", async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try {
      await changeCombatTurn(1);
    } catch (error) {
      console.error(`${MODULE_ID} | next combat turn failed`, error);
    } finally {
      button.disabled = false;
    }
  });
  viewport?.addEventListener("wheel", event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    viewport.scrollBy({ left: event.deltaY, behavior: "auto" });
  }, { passive: false });
  root.querySelectorAll("[data-gfoe-carousel-claim]").forEach(button => {
    button.addEventListener("click", async event => {
      const current = event.currentTarget;
      if (current.disabled) return;
      current.disabled = true;
      try {
        await claimSlot(current.dataset.gfoeCarouselClaim);
      } catch (error) {
        console.error(`${MODULE_ID} | combat carousel claim failed`, error);
        ui.notifications?.error(Lang.t("combatCarousel.claimFailed"));
      } finally {
        current.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-gfoe-carousel-focus]").forEach(button => {
    button.addEventListener("click", event => void focusClaimant(event.currentTarget.dataset.gfoeCarouselFocus));
  });
}

export function renderCombatCarousel({ centerActive = false } = {}) {
  if (!isEnabled() || !genericSlotsEnabled()) {
    removeCarousel();
    return;
  }
  const combat = activeCombat();
  if (!combat) {
    removeCarousel();
    return;
  }
  const previous = document.getElementById(CAROUSEL_ID);
  const previousScroll = previous?.querySelector?.(".gfoe-carousel-viewport")?.scrollLeft ?? 0;
  previous?.remove();
  document.body.insertAdjacentHTML("beforeend", buildHtml(combat));
  const root = document.getElementById(CAROUSEL_ID);
  if (!root) return;
  activateCarousel(root);
  const viewport = root.querySelector(".gfoe-carousel-viewport");
  if (viewport && !centerActive) viewport.scrollLeft = previousScroll;
  const activeIndex = Number.isInteger(Number(combat.turn)) ? Number(combat.turn) : 0;
  if (centerActive || !previous) requestAnimationFrame(() => scrollToCard(root, activeIndex, "auto"));
}

export function queueCarouselRender(delay = 30, centerActive = false) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderCombatCarousel({ centerActive }), delay);
}

export function registerCombatCarouselSettings() {
  game.settings.register(MODULE_ID, "enableCombatCarousel", {
    name: game.i18n?.localize?.("settings.enableCombatCarouselName") ?? "Enable combat carousel",
    hint: game.i18n?.localize?.("settings.enableCombatCarouselHint") ?? "Shows a Genesys initiative-slot carousel at the top of the canvas and allows slots to be claimed from it.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => queueCarouselRender(0, true)
  });
}

export function initializeCombatCarousel() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  Hooks.on("updateCombat", (combat, changes) => {
    const center = Object.prototype.hasOwnProperty.call(changes ?? {}, "turn") || Object.prototype.hasOwnProperty.call(changes ?? {}, "round");
    queueCarouselRender(25, center);
  });
  Hooks.on("createCombat", () => queueCarouselRender());
  Hooks.on("deleteCombat", () => queueCarouselRender());
  Hooks.on("createCombatant", () => queueCarouselRender());
  Hooks.on("updateCombatant", () => queueCarouselRender());
  Hooks.on("deleteCombatant", () => queueCarouselRender());
  Hooks.on("canvasReady", () => queueCarouselRender(50, true));
  Hooks.on("controlToken", () => queueCarouselRender(20));
  queueCarouselRender(50, true);
}
