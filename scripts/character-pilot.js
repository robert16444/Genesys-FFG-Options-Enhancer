import { Lang } from "./i18n.js";
import { applyStackableNextCheckEffect } from "./next-check-effects.js";
import { GUARDED_STANCE_STATUS_ID, buildGuardedStanceChanges } from "./status-effects.js";

const MODULE_ID = "genesys-ffg-options-enhancer";
const PILOT_FLAG = "characterPilot";
const TURN_STATE_KEY = "turnState";
const MAX_MANEUVERS_KEY = "maxManeuvers";
const PILOT_EFFECT_FLAG = "pilotEffect";
const PILOT_DURATION_FLAG = "pilotDuration";
const DEFAULT_MAX_MANEUVERS = 2;
const EXTRA_MANEUVER_STRAIN = 2;
const PILOT_SOCKET_EFFECT = "PILOT_APPLY_NEXT_CHECK";
const PILOT_SOCKET_END_TURN = "PILOT_END_TURN";



let pilotApp = null;
let hooksRegistered = false;
const combatTurnMemory = new Map();

function t(path, data) {
  return Lang.t(`pilot.${path}`, data);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clone(value) {
  if (value == null) return value;
  try { return foundry.utils.deepClone(value); }
  catch (_) { return JSON.parse(JSON.stringify(value)); }
}

function asInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function positiveInt(value, fallback = 1) {
  return Math.max(1, asInt(value, fallback));
}

function activeEffects(actor) {
  return Array.from(actor?.effects?.contents ?? actor?.effects ?? []).filter(effect => !effect?.disabled);
}

function actorCanBePiloted(actor) {
  if (!actor) return false;
  if (game.user?.isGM) return true;
  return Boolean(actor.isOwner);
}

function availableActors() {
  const actors = Array.from(game.actors ?? []).filter(actor => actorCanBePiloted(actor));
  actors.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  return actors;
}

function selectedActor() {
  const controlled = Array.from(canvas?.tokens?.controlled ?? []);
  const owned = controlled.find(token => actorCanBePiloted(token?.actor));
  return owned?.actor ?? null;
}

function preferredActor() {
  return selectedActor() ?? (actorCanBePiloted(game.user?.character) ? game.user.character : null) ?? availableActors()[0] ?? null;
}

function actorTokens(actor) {
  if (!actor) return [];
  return Array.from(canvas?.tokens?.placeables ?? []).filter(token => token?.actor?.id === actor.id);
}

function actorToken(actor) {
  return actorTokens(actor)[0] ?? null;
}

function currentCombat() {
  const combat = game.combat;
  if (!combat) return null;
  if (!(combat.started === true || asInt(combat.round, 0) > 0)) return null;
  return combat;
}

function currentCombatant(combat = currentCombat()) {
  if (!combat) return null;
  return combat.combatant ?? combat.turns?.[asInt(combat.turn, -1)] ?? null;
}

function combatantActor(combatant) {
  return combatant?.actor ?? (combatant?.actorId ? game.actors?.get(combatant.actorId) : null) ?? null;
}

function combatTurnKey(combat = currentCombat()) {
  if (!combat) return null;
  const combatant = currentCombatant(combat);
  return `${combat.id}:${asInt(combat.round, 0)}:${asInt(combat.turn, -1)}:${combatant?.id ?? "slot"}`;
}

function isActorsTurn(actor, combat = currentCombat()) {
  if (!combat || !actor) return !combat;
  return combatantActor(currentCombatant(combat))?.id === actor.id;
}

function getPilotData(actor) {
  try { return clone(actor?.getFlag?.(MODULE_ID, PILOT_FLAG) ?? {}); }
  catch (_) { return {}; }
}

async function setPilotData(actor, data) {
  if (!actor) return;
  await actor.setFlag(MODULE_ID, PILOT_FLAG, data);
}

function maxManeuversFor(actor) {
  const data = getPilotData(actor);
  return Math.max(DEFAULT_MAX_MANEUVERS, positiveInt(data?.[MAX_MANEUVERS_KEY], DEFAULT_MAX_MANEUVERS));
}

function defaultTurnState(key = "free") {
  return {
    key,
    actionUsed: false,
    actionConverted: false,
    maneuversUsed: 0,
    extraManeuvers: 0,
    lastManeuver: ""
  };
}

async function getTurnState(actor, { initialize = true } = {}) {
  if (!actor) return defaultTurnState();
  const data = getPilotData(actor);
  let state = clone(data?.[TURN_STATE_KEY] ?? null);
  const combat = currentCombat();
  const currentKey = isActorsTurn(actor, combat) ? combatTurnKey(combat) : null;

  if (!state) state = defaultTurnState(currentKey ?? "free");
  else if (currentKey && state.key !== currentKey) state = defaultTurnState(currentKey);

  const max = maxManeuversFor(actor);
  state.maneuversUsed = Math.max(0, Math.min(max, asInt(state.maneuversUsed, 0)));
  state.actionUsed = Boolean(state.actionUsed);
  state.actionConverted = Boolean(state.actionConverted);
  if (state.actionConverted) state.actionUsed = true;
  const paidExtraLimit = Math.max(0, max - 1 - (state.actionConverted ? 1 : 0));
  state.extraManeuvers = Math.max(0, Math.min(paidExtraLimit, asInt(state.extraManeuvers, 0)));

  if (initialize && JSON.stringify(data?.[TURN_STATE_KEY] ?? null) !== JSON.stringify(state)) {
    data[TURN_STATE_KEY] = state;
    await setPilotData(actor, data);
  }
  return state;
}

async function saveTurnState(actor, state) {
  const data = getPilotData(actor);
  data[TURN_STATE_KEY] = state;
  await setPilotData(actor, data);
}

function maneuverCapacity(actor, state) {
  const max = maxManeuversFor(actor);
  return Math.min(max, 1 + Math.max(0, asInt(state?.extraManeuvers, 0)) + (state?.actionConverted ? 1 : 0));
}

function strainData(actor) {
  const stat = actor?.system?.stats?.strain;
  if (!stat) return null;
  const value = Number(stat.value ?? 0);
  const max = Number(stat.max ?? stat.threshold ?? 0);
  return {
    value: Number.isFinite(value) ? value : 0,
    max: Number.isFinite(max) ? max : 0,
    path: "system.stats.strain.value"
  };
}

async function adjustStrain(actor, delta) {
  const data = strainData(actor);
  if (!data) throw new Error(t("errors.noStrain"));
  const next = Math.max(0, data.value + Number(delta || 0));
  await actor.update({ [data.path]: next });
  return { before: data.value, after: next, max: data.max };
}

async function requireOwnTurn(actor) {
  const combat = currentCombat();
  if (!combat) return true;
  if (isActorsTurn(actor, combat)) return true;
  ui.notifications?.warn(t("errors.notYourTurn"));
  return false;
}

async function consumeManeuver(actor, label) {
  if (!(await requireOwnTurn(actor))) return false;
  const state = await getTurnState(actor);
  const capacity = maneuverCapacity(actor, state);
  if (state.maneuversUsed >= capacity) {
    ui.notifications?.warn(t("errors.noManeuver", { max: maxManeuversFor(actor) }));
    return false;
  }
  state.maneuversUsed += 1;
  state.lastManeuver = label ?? "";
  await saveTurnState(actor, state);
  return true;
}

async function buyExtraManeuver(actor) {
  if (!(await requireOwnTurn(actor))) return false;
  const state = await getTurnState(actor);
  const max = maxManeuversFor(actor);
  if (maneuverCapacity(actor, state) >= max) {
    ui.notifications?.warn(t("errors.maxManeuvers", { max }));
    return false;
  }
  await adjustStrain(actor, EXTRA_MANEUVER_STRAIN);
  state.extraManeuvers += 1;
  await saveTurnState(actor, state);
  ui.notifications?.info(t("info.extraManeuverBought", { cost: EXTRA_MANEUVER_STRAIN }));
  return true;
}

async function convertActionToManeuver(actor) {
  if (!(await requireOwnTurn(actor))) return false;
  const state = await getTurnState(actor);
  const max = maxManeuversFor(actor);
  if (state.actionUsed || state.actionConverted) {
    ui.notifications?.warn(t("errors.actionAlreadyUsed"));
    return false;
  }
  if (maneuverCapacity(actor, state) >= max) {
    ui.notifications?.warn(t("errors.maxManeuvers", { max }));
    return false;
  }
  state.actionUsed = true;
  state.actionConverted = true;
  await saveTurnState(actor, state);
  ui.notifications?.info(t("info.actionConverted"));
  return true;
}

function statusEffectsArray() {
  const statuses = CONFIG?.statusEffects;
  if (!statuses) return [];
  if (Array.isArray(statuses)) return statuses;
  return Object.values(statuses);
}

function statusById(id) {
  if (!id) return null;
  const statuses = CONFIG?.statusEffects;
  if (Array.isArray(statuses)) return statuses.find(status => status?.id === id) ?? null;
  if (statuses && typeof statuses === "object") return statuses[id] ?? Object.values(statuses).find(status => status?.id === id) ?? null;
  return null;
}

function findStatus(candidates = [], nameFragments = []) {
  for (const id of candidates.filter(Boolean)) {
    const found = statusById(id);
    if (found) return found;
  }
  const fragments = nameFragments.map(s => String(s).toLowerCase());
  return statusEffectsArray().find(status => {
    const raw = `${status?.id ?? ""} ${status?.name ?? ""} ${status?.label ?? ""}`.toLowerCase();
    return fragments.some(fragment => raw.includes(fragment));
  }) ?? null;
}

function effectHasStatus(effect, statusId) {
  if (!effect || !statusId) return false;
  try {
    if (effect.statuses?.has) return effect.statuses.has(statusId);
    return Array.from(effect.statuses ?? []).includes(statusId);
  } catch (_) { return false; }
}

function findNumericPath(root, candidates) {
  for (const path of candidates) {
    const value = foundry.utils.getProperty(root, path);
    if (typeof value === "number" && Number.isFinite(value)) return path;
  }
  return null;
}

function defensePath(actor, kind) {
  const base = kind === "melee" ? "melee" : "ranged";
  const cap = base[0].toUpperCase() + base.slice(1);
  const candidates = [
    `system.stats.defence.${base}.value`,
    `system.stats.defence.${base}`,
    `system.stats.defense.${base}.value`,
    `system.stats.defense.${base}`,
    `system.stats.${base}Defence.value`,
    `system.stats.${base}Defence`,
    `system.stats.${base}Defense.value`,
    `system.stats.${base}Defense`,
    `system.stats.defence${cap}.value`,
    `system.stats.defence${cap}`,
    `system.stats.defense${cap}.value`,
    `system.stats.defense${cap}`
  ];
  return findNumericPath(actor, candidates);
}

function pilotEffect(actor, kind) {
  return activeEffects(actor).find(effect => effect.getFlag?.(MODULE_ID, PILOT_EFFECT_FLAG)?.kind === kind) ?? null;
}

function effectChange(path, value) {
  return {
    key: path,
    mode: CONST.ACTIVE_EFFECT_MODES.ADD,
    value: String(value),
    priority: 20
  };
}

async function createPilotEffect(actor, { kind, name, img, changes = [], statuses = [], duration = null, extraFlags = {} }) {
  const existing = pilotEffect(actor, kind);
  if (existing) return existing;
  const flags = {
    [MODULE_ID]: {
      [PILOT_EFFECT_FLAG]: { kind },
      ...extraFlags
    }
  };
  const data = {
    name,
    img,
    disabled: false,
    changes,
    statuses,
    flags
  };
  if (duration) data.system = { duration };
  const created = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return created?.[0] ?? null;
}

function guardedStanceEffect(actor) {
  return activeEffects(actor).find(effect => effectHasStatus(effect, GUARDED_STANCE_STATUS_ID) || effect.getFlag?.(MODULE_ID, PILOT_EFFECT_FLAG)?.kind === "guardedStance") ?? null;
}

async function applyGuardedStance(actor) {
  if (guardedStanceEffect(actor)) {
    ui.notifications?.warn(t("errors.guardedAlready"));
    return false;
  }
  const status = statusById(GUARDED_STANCE_STATUS_ID);
  if (!defensePath(actor, "melee")) ui.notifications?.warn(t("warnings.defensePath", { type: t("meleeDefense") }));
  const turnKey = combatTurnKey(currentCombat()) ?? "free";
  const created = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: t("effects.guardedStance"),
    img: status?.img ?? "icons/svg/shield.svg",
    disabled: false,
    changes: buildGuardedStanceChanges(actor),
    statuses: [GUARDED_STANCE_STATUS_ID],
    flags: {
      ...(clone(status?.flags ?? {})),
      [MODULE_ID]: {
        ...((clone(status?.flags ?? {})[MODULE_ID]) ?? {}),
        [PILOT_EFFECT_FLAG]: { kind: "guardedStance" },
        [PILOT_DURATION_FLAG]: { mode: "afterNextTurn", createdTurnKey: turnKey, armed: false }
      }
    }
  }]);
  return Boolean(created?.[0]);
}

async function toggleCover(actor) {
  const existing = pilotEffect(actor, "cover");
  if (existing) {
    await existing.delete();
    ui.notifications?.info(t("info.leftCover"));
    return { removed: true };
  }
  const ranged = defensePath(actor, "ranged");
  const changes = [];
  if (ranged) changes.push(effectChange(ranged, 1));
  else ui.notifications?.warn(t("warnings.defensePath", { type: t("rangedDefense") }));
  await createPilotEffect(actor, {
    kind: "cover",
    name: t("effects.cover"),
    img: "icons/svg/barrier.svg",
    changes
  });
  return { removed: false };
}

function matchingEffect(actor, candidates, fragments) {
  const statusIds = new Set(candidates.filter(Boolean));
  const lower = fragments.map(s => s.toLowerCase());
  return activeEffects(actor).find(effect => {
    if (Array.from(statusIds).some(id => effectHasStatus(effect, id))) return true;
    const raw = `${effect.name ?? ""} ${Array.from(effect.statuses ?? []).join(" ")}`.toLowerCase();
    return lower.some(fragment => raw.includes(fragment));
  }) ?? null;
}

function proneEffect(actor) {
  return matchingEffect(actor, ["prone", "starwarsffg-prone", "gfoe-prone"], ["prone", "powal", "leżą"]);
}

function ensureStatusDefinition({ id, name, img, specialKey = null }) {
  let status = statusById(id);
  if (!status) {
    const data = { id, name, img, changes: [], disabled: false, flags: { [MODULE_ID]: { providedByPilot: true } } };
    if (Array.isArray(CONFIG.statusEffects)) CONFIG.statusEffects.push(data);
    else if (CONFIG.statusEffects && typeof CONFIG.statusEffects === "object") CONFIG.statusEffects[id] = data;
    status = data;
  }
  if (specialKey) {
    CONFIG.specialStatusEffects ??= {};
    CONFIG.specialStatusEffects[specialKey] = id;
  }
  return status;
}

function statusSpec(kind) {
  const specs = {
    prone: { candidates: ["prone", "starwarsffg-prone", "gfoe-prone"], fragments: ["prone", "powal"], fallback: "gfoe-prone" },
    staggered: { candidates: ["starwarsffg-staggered", "staggered"], fragments: ["staggered", "oszołom"], fallback: null },
    disoriented: { candidates: ["starwarsffg-disoriented", "disoriented"], fragments: ["disoriented", "dezorient"], fallback: null },
    immobilized: { candidates: ["starwarsffg-immobilized", "immobilized", "gfoe-immobilized"], fragments: ["immobilized", "unieruch"], fallback: "gfoe-immobilized" },
    invisible: { candidates: [CONFIG.specialStatusEffects?.INVISIBLE, "invisible", "gfoe-invisible"], fragments: ["invisible", "niewidzial"], fallback: CONFIG.specialStatusEffects?.INVISIBLE || "gfoe-invisible" },
    blinded: { candidates: [CONFIG.specialStatusEffects?.BLIND, "blind", "blinded", "gfoe-blind"], fragments: ["blind", "oślep"], fallback: CONFIG.specialStatusEffects?.BLIND || "gfoe-blind" }
  };
  return specs[kind] ?? null;
}

async function toggleActorStatus(actor, kind) {
  const spec = statusSpec(kind);
  if (!spec) throw new Error(`Unknown status: ${kind}`);
  const existing = matchingEffect(actor, spec.candidates, spec.fragments);
  if (existing) {
    await existing.delete();
    return false;
  }
  const status = findStatus(spec.candidates, spec.fragments) ?? (spec.fallback ? statusById(spec.fallback) : null);
  if (!status) {
    ui.notifications?.warn(t("warnings.statusMissing", { status: kind }));
    return false;
  }
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n?.localize?.(status.name ?? status.label ?? kind) ?? status.name ?? status.label ?? kind,
    img: status.img ?? status.icon ?? "icons/svg/aura.svg",
    disabled: false,
    changes: clone(status.changes ?? []),
    statuses: [status.id],
    system: clone(status.system ?? {}),
    flags: clone(status.flags ?? {})
  }]);
  return true;
}

function primaryActiveGM() {
  return Array.from(game.users ?? [])
    .filter(user => user?.isGM && user?.active)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

function sendPilotRequestToGM(payload) {
  const gm = primaryActiveGM();
  if (!gm) {
    ui.notifications?.warn(t("errors.noActiveGM"));
    return false;
  }
  game.socket?.emit?.(`module.${MODULE_ID}`, {
    ...payload,
    fromUser: game.user?.id,
    toGM: gm.id
  });
  return true;
}

async function applyNextCheckAuthorized(actor, kind, amount = 1, source = "", originActor = null) {
  if (!actor) return null;
  if (game.user?.isGM || actor.isOwner) return applyStackableNextCheckEffect(actor, kind, amount);
  const sent = sendPilotRequestToGM({
    type: PILOT_SOCKET_EFFECT,
    actorId: actor.id,
    actorUuid: actor.uuid ?? null,
    originActorId: originActor?.id ?? null,
    originActorUuid: originActor?.uuid ?? null,
    kind,
    amount: positiveInt(amount, 1),
    source: String(source ?? "")
  });
  if (sent) ui.notifications?.info(t("info.gmRequestSent"));
  return null;
}

function currentTargetTokens() {
  return Array.from(game.user?.targets ?? []);
}

function singleTargetActor() {
  const targets = currentTargetTokens();
  if (targets.length !== 1) {
    ui.notifications?.warn(targets.length ? t("errors.oneTarget") : t("errors.noTarget"));
    return null;
  }
  return targets[0]?.actor ?? null;
}

function dispositionOfActor(actor) {
  const token = actorToken(actor);
  const n = Number(token?.document?.disposition ?? token?.disposition);
  return Number.isFinite(n) ? n : null;
}

function alliedActors(actor) {
  const originDisposition = dispositionOfActor(actor);
  const seen = new Set();
  const out = [];
  for (const token of Array.from(canvas?.tokens?.placeables ?? [])) {
    const other = token?.actor;
    if (!other || other.id === actor?.id || seen.has(other.id)) continue;
    if (!game.user?.isGM && !other.isOwner && originDisposition == null) continue;
    const disposition = Number(token?.document?.disposition ?? token?.disposition);
    if (originDisposition != null && Number.isFinite(disposition) && disposition !== originDisposition) continue;
    seen.add(other.id);
    out.push(other);
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function promptActorChoice(title, actors) {
  if (!actors.length) {
    ui.notifications?.warn(t("errors.noAllies"));
    return null;
  }
  const options = actors.map(actor => `<option value="${esc(actor.id)}">${esc(actor.name)}</option>`).join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title },
    content: `<div class="gfoe-pilot-dialog"><label>${esc(t("chooseCharacter"))}<select name="actorId">${options}</select></label></div>`,
    rejectClose: false,
    ok: {
      label: t("choose"),
      callback: (_event, button) => button.form.elements.actorId.value
    }
  });
}

function itemQuantity(item) {
  const raw = item?.system?.quantity?.value ?? item?.system?.quantity ?? 1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 1;
}

function isWeapon(item) {
  return String(item?.type ?? "").toLowerCase() === "weapon";
}

function weaponEquippedState(item) {
  if (typeof item?.system?.equipped === "boolean") return { value: item.system.equipped, path: "system.equipped" };
  if (typeof item?.system?.equipped?.value === "boolean") return { value: item.system.equipped.value, path: "system.equipped.value" };
  if (typeof item?.system?.isEquipped === "boolean") return { value: item.system.isEquipped, path: "system.isEquipped" };
  return { value: Boolean(item?.getFlag?.(MODULE_ID, "pilotDrawn")), path: null };
}

async function promptWeapon(actor) {
  const weapons = Array.from(actor?.items ?? []).filter(isWeapon);
  if (!weapons.length) {
    ui.notifications?.warn(t("errors.noWeapons"));
    return null;
  }
  const options = weapons.map(item => {
    const state = weaponEquippedState(item).value ? t("drawn") : t("holstered");
    return `<option value="${esc(item.id)}">${esc(item.name)} — ${esc(state)}</option>`;
  }).join("");
  const id = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("actions.manageGear") },
    content: `<div class="gfoe-pilot-dialog"><label>${esc(t("chooseWeapon"))}<select name="itemId">${options}</select></label></div>`,
    rejectClose: false,
    ok: { label: t("choose"), callback: (_event, button) => button.form.elements.itemId.value }
  });
  return id ? actor.items?.get?.(id) ?? null : null;
}

async function toggleWeapon(item) {
  const state = weaponEquippedState(item);
  if (state.path) await item.update({ [state.path]: !state.value });
  else await item.setFlag(MODULE_ID, "pilotDrawn", !state.value);
  ui.notifications?.info(!state.value ? t("info.weaponDrawn", { item: item.name }) : t("info.weaponHolstered", { item: item.name }));
}

function usableItems(actor) {
  const excluded = new Set(["talent", "specialization", "species", "career", "signatureability", "forcepower", "ability", "criticalinjury", "criticaldamage"]);
  return Array.from(actor?.items ?? []).filter(item => {
    const type = String(item?.type ?? "").toLowerCase();
    if (excluded.has(type) || isWeapon(item)) return false;
    return itemQuantity(item) > 0;
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function promptUsableItem(actor) {
  const items = usableItems(actor);
  if (!items.length) {
    ui.notifications?.warn(t("errors.noUsableItems"));
    return null;
  }
  const options = items.map(item => `<option value="${esc(item.id)}">${esc(item.name)} ×${itemQuantity(item)}</option>`).join("");
  const id = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("actions.useItem") },
    content: `<div class="gfoe-pilot-dialog"><label>${esc(t("chooseItem"))}<select name="itemId">${options}</select></label></div>`,
    rejectClose: false,
    ok: { label: t("use"), callback: (_event, button) => button.form.elements.itemId.value }
  });
  return id ? actor.items?.get?.(id) ?? null : null;
}

async function useItem(item) {
  if (!item) return;
  if (typeof item.use === "function") return item.use();
  if (typeof item.roll === "function") return item.roll();
  if (typeof item.toMessage === "function") return item.toMessage();
  return item.sheet?.render?.(true);
}

function effectSummary(actor) {
  return activeEffects(actor).map(effect => ({
    id: effect.id,
    name: effect.name,
    img: effect.img ?? "icons/svg/aura.svg"
  }));
}

async function resetTurnState(actor) {
  const state = defaultTurnState(isActorsTurn(actor) ? combatTurnKey() ?? "free" : "free");
  await saveTurnState(actor, state);
}

async function saveMaxManeuvers(actor, value) {
  if (!game.user?.isGM) return;
  const max = Math.max(DEFAULT_MAX_MANEUVERS, positiveInt(value, DEFAULT_MAX_MANEUVERS));
  const data = getPilotData(actor);
  data[MAX_MANEUVERS_KEY] = max;
  const state = clone(data[TURN_STATE_KEY] ?? defaultTurnState());
  state.extraManeuvers = Math.min(state.extraManeuvers ?? 0, Math.max(0, max - 1 - (state.actionConverted ? 1 : 0)));
  state.maneuversUsed = Math.min(state.maneuversUsed ?? 0, max);
  data[TURN_STATE_KEY] = state;
  await setPilotData(actor, data);
  ui.notifications?.info(t("info.maxManeuversSaved", { max }));
}

async function endTurn(actor) {
  const combat = currentCombat();
  if (!combat) return ui.notifications?.warn(t("errors.noCombat"));
  if (!isActorsTurn(actor, combat)) return ui.notifications?.warn(t("errors.notYourTurn"));
  if (game.user?.isGM) {
    if (typeof combat.nextTurn === "function") await combat.nextTurn();
    else ui.notifications?.warn(t("errors.cannotEndTurn"));
    return;
  }
  const sent = sendPilotRequestToGM({ type: PILOT_SOCKET_END_TURN, actorId: actor.id, actorUuid: actor.uuid ?? null, combatId: combat.id });
  if (sent) ui.notifications?.info(t("info.endTurnRequested"));
}

async function clearAllActorEffects(actor) {
  if (!game.user?.isGM || !actor) return false;
  const effects = Array.from(actor.effects?.contents ?? actor.effects ?? []);
  if (!effects.length) {
    ui.notifications?.info(t("info.noEffectsToClear", { name: actor.name }));
    return false;
  }

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: {
      title: t("clearEffectsTitle"),
      icon: "fa-solid fa-trash-can"
    },
    content: `<p>${esc(t("clearEffectsConfirm", { name: actor.name, count: effects.length }))}</p>`,
    modal: true,
    rejectClose: false,
    yes: {
      label: t("actions.clearAllEffects"),
      icon: "fa-solid fa-trash-can"
    },
    no: {
      label: t("cancel"),
      icon: "fa-solid fa-xmark"
    }
  });
  if (!confirmed) return false;

  const ids = effects.map(effect => effect.id).filter(Boolean);
  if (!ids.length) return false;
  await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  ui.notifications?.info(t("info.effectsCleared", { name: actor.name, count: ids.length }));
  return true;
}

async function gmTargetAction(action) {
  if (!game.user?.isGM) return;
  const actor = singleTargetActor();
  if (!actor) return;
  switch (action) {
    case "target-strain-plus": await adjustStrain(actor, 1); break;
    case "target-strain-minus": await adjustStrain(actor, -1); break;
    case "target-boost": await applyStackableNextCheckEffect(actor, "boost", 1); break;
    case "target-setback": await applyStackableNextCheckEffect(actor, "setback", 1); break;
    case "target-upgrade-ability": await applyStackableNextCheckEffect(actor, "upgradeAbility", 1); break;
    case "target-upgrade-difficulty": await applyStackableNextCheckEffect(actor, "upgradeDifficulty", 1); break;
    case "target-prone": await toggleActorStatus(actor, "prone"); break;
    case "target-staggered": await toggleActorStatus(actor, "staggered"); break;
    case "target-disoriented": await toggleActorStatus(actor, "disoriented"); break;
    case "target-immobilized": await toggleActorStatus(actor, "immobilized"); break;
    case "target-invisible": await toggleActorStatus(actor, "invisible"); break;
    case "target-blinded": await toggleActorStatus(actor, "blinded"); break;
    case "target-clear-effects": await clearAllActorEffects(actor); break;
  }
}

function turnMemory(combat) {
  if (!combat) return null;
  const actor = combatantActor(currentCombatant(combat));
  return {
    key: combatTurnKey(combat),
    actorId: actor?.id ?? null,
    actorUuid: actor?.uuid ?? null
  };
}

function actorFromTurnMemory(memory) {
  if (!memory) return null;
  try {
    const byUuid = memory.actorUuid ? globalThis.fromUuidSync?.(memory.actorUuid) : null;
    if (byUuid?.documentName === "Actor") return byUuid;
  } catch (_) {}
  return memory.actorId ? game.actors?.get(memory.actorId) ?? null : null;
}

async function armEnteringActorEffects(actor, key) {
  if (!actor) return;
  for (const effect of activeEffects(actor)) {
    const duration = effect.getFlag?.(MODULE_ID, PILOT_DURATION_FLAG);
    if (!duration || duration.mode !== "afterNextTurn" || duration.armed) continue;
    if (duration.createdTurnKey === key) continue;
    await effect.update({ [`flags.${MODULE_ID}.${PILOT_DURATION_FLAG}.armed`]: true });
  }
}

async function expireLeavingActorEffects(actor) {
  if (!actor) return;
  const ids = activeEffects(actor)
    .filter(effect => {
      const duration = effect.getFlag?.(MODULE_ID, PILOT_DURATION_FLAG);
      return duration?.mode === "afterNextTurn" && duration?.armed;
    })
    .map(effect => effect.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

async function handleCombatTransition(combat) {
  if (!combat) return;
  const previous = combatTurnMemory.get(combat.id) ?? null;
  const current = turnMemory(combat);
  if (previous?.key === current?.key) return;

  if (previous?.actorId) await expireLeavingActorEffects(actorFromTurnMemory(previous));
  if (current?.actorId) {
    const actor = actorFromTurnMemory(current);
    if (actor) {
      await getTurnState(actor, { initialize: true });
      await armEnteringActorEffects(actor, current.key);
    }
  }
  combatTurnMemory.set(combat.id, current);
  refreshPilot();
}

function refreshPilot() {
  try {
    if (pilotApp?.rendered) pilotApp.render({ force: true });
  } catch (_) {}
}

export class CharacterPilotApp extends foundry.applications.api.ApplicationV2 {
  constructor(options = {}) {
    super({ ...options, window: { ...(options.window ?? {}), title: t("title") } });
    const initial = options.actorUuid ? actorFromSocketRef(options.actorUuid, options.actorId) : null;
    const actor = initial ?? (options.actorId ? game.actors?.get(options.actorId) : null) ?? preferredActor();
    this.actorId = actor?.id ?? null;
    this.actorUuid = actor?.uuid ?? null;
  }

  static DEFAULT_OPTIONS = {
    id: "gfoe-character-pilot",
    classes: ["gfoe-character-pilot"],
    tag: "section",
    window: {
      title: "Character Pilot",
      icon: "fa-solid fa-gamepad",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 520
    }
  };

  get actor() {
    const byUuid = actorFromSocketRef(this.actorUuid, this.actorId);
    if (actorCanBePiloted(byUuid)) return byUuid;
    const controlled = Array.from(canvas?.tokens?.controlled ?? [])
      .find(token => token?.actor?.id === this.actorId && actorCanBePiloted(token.actor));
    if (controlled?.actor) return controlled.actor;
    const direct = this.actorId ? game.actors?.get(this.actorId) : null;
    return actorCanBePiloted(direct) ? direct : preferredActor();
  }

  async _renderHTML() {
    const actor = this.actor;
    const template = document.createElement("template");
    if (!actor) {
      template.innerHTML = `<div class="gfoe-pilot-empty">${esc(t("errors.noActor"))}</div>`;
      return template.content;
    }
    this.actorId = actor.id;
    this.actorUuid = actor.uuid ?? null;
    const state = await getTurnState(actor);
    const max = maxManeuversFor(actor);
    const capacity = maneuverCapacity(actor, state);
    const strain = strainData(actor);
    const actors = availableActors();
    const effects = effectSummary(actor);
    const targets = currentTargetTokens();
    const inCombat = Boolean(currentCombat());
    const ownTurn = isActorsTurn(actor);
    const coverActive = Boolean(pilotEffect(actor, "cover"));
    const guardedActive = Boolean(guardedStanceEffect(actor));
    const prone = Boolean(proneEffect(actor));

    const actorOptions = actors.map(entry => `<option value="${esc(entry.id)}" ${entry.id === actor.id ? "selected" : ""}>${esc(entry.name)}</option>`).join("");
    const effectHtml = effects.length
      ? effects.map(effect => `<div class="gfoe-pilot-effect"><img src="${esc(effect.img)}" alt=""><span>${esc(effect.name)}</span></div>`).join("")
      : `<div class="gfoe-pilot-muted">${esc(t("noEffects"))}</div>`;
    const targetHtml = targets.length
      ? targets.map(token => `<span class="gfoe-pilot-target-chip"><img src="${esc(token.document?.texture?.src ?? token.actor?.img ?? "icons/svg/mystery-man.svg")}" alt="">${esc(token.name ?? token.actor?.name)}</span>`).join("")
      : `<span class="gfoe-pilot-muted">${esc(t("noTarget"))}</span>`;

    const gmTools = game.user?.isGM ? `
      <section class="gfoe-pilot-section">
        <h3><i class="fa-solid fa-crosshairs"></i> ${esc(t("gmTargetTools"))}</h3>
        <div class="gfoe-pilot-actions gfoe-pilot-actions-3">
          ${button("target-strain-plus", t("actions.sufferStrain"), "fa-solid fa-bolt", !targets.length)}
          ${button("target-strain-minus", t("actions.healStrain"), "fa-solid fa-heart", !targets.length)}
          ${button("target-boost", t("actions.addBoost"), "fa-solid fa-plus", !targets.length)}
          ${button("target-setback", t("actions.addSetback"), "fa-solid fa-minus", !targets.length)}
          ${button("target-upgrade-ability", t("actions.upgradeAbility"), "fa-solid fa-arrow-up", !targets.length)}
          ${button("target-upgrade-difficulty", t("actions.upgradeDifficulty"), "fa-solid fa-triangle-exclamation", !targets.length)}
          ${button("target-prone", t("statuses.prone"), "fa-solid fa-person-falling", !targets.length)}
          ${button("target-staggered", t("statuses.staggered"), "fa-solid fa-dizzy", !targets.length)}
          ${button("target-disoriented", t("statuses.disoriented"), "fa-solid fa-compass", !targets.length)}
          ${button("target-immobilized", t("statuses.immobilized"), "fa-solid fa-link", !targets.length)}
          ${button("target-invisible", t("statuses.invisible"), "fa-solid fa-eye-slash", !targets.length)}
          ${button("target-blinded", t("statuses.blinded"), "fa-solid fa-eye", !targets.length)}
          ${button("target-clear-effects", t("actions.clearAllEffects"), "fa-solid fa-trash-can", targets.length !== 1, "gfoe-pilot-danger")}
        </div>
      </section>
      <section class="gfoe-pilot-section gfoe-pilot-config">
        <h3><i class="fa-solid fa-gear"></i> ${esc(t("gmConfig"))}</h3>
        <div class="gfoe-pilot-inline">
          <label>${esc(t("maxManeuvers"))}<input type="number" min="2" step="1" data-role="max-maneuvers" value="${max}"></label>
          ${button("save-max-maneuvers", t("save"), "fa-solid fa-floppy-disk")}
        </div>
        <p class="gfoe-pilot-muted">${esc(t("maxManeuversHint"))}</p>
      </section>` : "";

    template.innerHTML = `
      <div class="gfoe-pilot-root" data-actor-id="${esc(actor.id)}">
        <header class="gfoe-pilot-header">
          <img src="${esc(actor.img ?? "icons/svg/mystery-man.svg")}" alt="">
          <div class="gfoe-pilot-heading">
            <strong>${esc(actor.name)}</strong>
            <select data-role="actor-select">${actorOptions}</select>
          </div>
          <button type="button" data-pilot-action="open-sheet" title="${esc(t("openSheet"))}"><i class="fa-solid fa-address-card"></i></button>
        </header>

        <section class="gfoe-pilot-state-grid">
          ${stateCard(t("action"), state.actionUsed ? t("used") : t("available"), state.actionUsed ? "spent" : "ready")}
          ${stateCard(t("maneuvers"), `${state.maneuversUsed}/${capacity} (${t("max")}: ${max})`, state.maneuversUsed < capacity ? "ready" : "spent")}
          ${stateCard(t("incidental"), "∞", "ready")}
          ${stateCard(t("strain"), strain ? `${strain.value}/${strain.max || "—"}` : "—", strain && strain.max && strain.value > strain.max ? "danger" : "normal")}
        </section>
        <div class="gfoe-pilot-turn-note ${inCombat && !ownTurn ? "not-turn" : ""}">
          <i class="fa-solid fa-clock"></i> ${esc(inCombat ? (ownTurn ? t("yourTurn") : t("notYourTurn")) : t("outsideCombat"))}
        </div>

        <section class="gfoe-pilot-section">
          <h3><i class="fa-solid fa-list-check"></i> ${esc(t("turnControls"))}</h3>
          <div class="gfoe-pilot-actions gfoe-pilot-actions-3">
            ${button("toggle-action", state.actionUsed ? t("actions.restoreAction") : t("actions.markAction"), "fa-solid fa-burst")}
            ${button("action-to-maneuver", t("actions.actionToManeuver"), "fa-solid fa-arrow-right-arrow-left", state.actionUsed || state.actionConverted || capacity >= max)}
            ${button("buy-extra-maneuver", t("actions.extraManeuver", { cost: EXTRA_MANEUVER_STRAIN }), "fa-solid fa-forward", capacity >= max)}
            ${button("reset-turn", t("actions.resetTurn"), "fa-solid fa-rotate-left")}
          </div>
        </section>

        <section class="gfoe-pilot-section">
          <h3><i class="fa-solid fa-person-running"></i> ${esc(t("maneuverActions"))}</h3>
          <div class="gfoe-pilot-actions gfoe-pilot-actions-3">
            ${button("aim", t("actions.aim"), "fa-solid fa-crosshairs")}
            ${button("guarded", guardedActive ? t("actions.guardedActive") : t("actions.guardedStance"), "fa-solid fa-shield-halved", guardedActive)}
            ${button("cover", coverActive ? t("actions.leaveCover") : t("actions.takeCover"), "fa-solid fa-shield")}
            ${button("stand-up", t("actions.standUp"), "fa-solid fa-person", !prone)}
            ${button("assist", t("actions.assist"), "fa-solid fa-handshake-angle")}
            ${button("move", t("actions.move"), "fa-solid fa-person-walking")}
            ${button("manage-gear", t("actions.manageGear"), "fa-solid fa-gun")}
          </div>
        </section>

        <section class="gfoe-pilot-section">
          <h3><i class="fa-solid fa-toolbox"></i> ${esc(t("quickActions"))}</h3>
          <div class="gfoe-pilot-actions gfoe-pilot-actions-2">
            ${button("use-item", t("actions.useItem"), "fa-solid fa-flask")}
            ${button("end-turn", t("actions.endTurn"), "fa-solid fa-forward-step", !inCombat)}
          </div>
        </section>

        <section class="gfoe-pilot-section">
          <h3><i class="fa-solid fa-bullseye"></i> ${esc(t("currentTargets"))}</h3>
          <div class="gfoe-pilot-targets">${targetHtml}</div>
        </section>

        <section class="gfoe-pilot-section">
          <h3><i class="fa-solid fa-wand-magic-sparkles"></i> ${esc(t("activeEffects"))}</h3>
          <div class="gfoe-pilot-effects">${effectHtml}</div>
        </section>

        ${gmTools}
      </div>`;
    return template.content;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element?.querySelector?.(".gfoe-pilot-root");
    if (!root) return;

    root.querySelector("[data-role='actor-select']")?.addEventListener("change", event => {
      this.actorId = event.currentTarget.value;
      this.actorUuid = game.actors?.get(this.actorId)?.uuid ?? null;
      this.render({ force: true });
    });

    root.addEventListener("click", async event => {
      const target = event.target.closest?.("[data-pilot-action]");
      if (!target || target.disabled) return;
      event.preventDefault();
      const action = target.dataset.pilotAction;
      try {
        await this._handleAction(action, root);
      } catch (err) {
        console.error(`${MODULE_ID} | character pilot action failed`, action, err);
        ui.notifications?.error(err?.message ?? t("errors.generic"));
      }
      if (this.rendered) await this.render({ force: true });
    });
  }

  async _handleAction(action, root) {
    const actor = this.actor;
    if (!actor) return;

    if (action.startsWith("target-")) return gmTargetAction(action);
    switch (action) {
      case "open-sheet": return actor.sheet?.render?.(true);
      case "toggle-action": {
        if (!(await requireOwnTurn(actor))) return;
        const state = await getTurnState(actor);
        if (state.actionUsed) {
          if (state.actionConverted) {
            const capacityWithoutAction = Math.min(maxManeuversFor(actor), 1 + Math.max(0, asInt(state.extraManeuvers, 0)));
            if (state.maneuversUsed > capacityWithoutAction) {
              ui.notifications?.warn(t("errors.convertedManeuverUsed"));
              return;
            }
          }
          state.actionUsed = false;
          state.actionConverted = false;
        } else {
          state.actionUsed = true;
          state.actionConverted = false;
        }
        return saveTurnState(actor, state);
      }
      case "action-to-maneuver": return convertActionToManeuver(actor);
      case "buy-extra-maneuver": return buyExtraManeuver(actor);
      case "reset-turn": return resetTurnState(actor);
      case "aim": {
        if (!(await consumeManeuver(actor, t("actions.aim")))) return;
        return applyStackableNextCheckEffect(actor, "boost", 1);
      }
      case "guarded": {
        if (guardedStanceEffect(actor)) return;
        if (!(await consumeManeuver(actor, t("actions.guardedStance")))) return;
        return applyGuardedStance(actor);
      }
      case "cover": {
        if (pilotEffect(actor, "cover")) return toggleCover(actor);
        if (!(await consumeManeuver(actor, t("actions.takeCover")))) return;
        return toggleCover(actor);
      }
      case "stand-up": {
        const prone = proneEffect(actor);
        if (!prone) return;
        if (!(await consumeManeuver(actor, t("actions.standUp")))) return;
        return prone.delete();
      }
      case "assist": {
        const allies = alliedActors(actor);
        const actorId = await promptActorChoice(t("actions.assist"), allies);
        if (!actorId) return;
        if (!(await consumeManeuver(actor, t("actions.assist")))) return;
        const ally = game.actors?.get(actorId);
        if (ally) await applyNextCheckAuthorized(ally, "boost", 1, `${t("actions.assist")}: ${actor.name}`, actor);
        return;
      }
      case "move": return consumeManeuver(actor, t("actions.move"));
      case "manage-gear": {
        const item = await promptWeapon(actor);
        if (!item) return;
        if (!(await consumeManeuver(actor, t("actions.manageGear")))) return;
        return toggleWeapon(item);
      }
      case "use-item": {
        const item = await promptUsableItem(actor);
        if (!item) return;
        return useItem(item);
      }
      case "end-turn": return endTurn(actor);
      case "save-max-maneuvers": return saveMaxManeuvers(actor, root.querySelector("[data-role='max-maneuvers']")?.value);
    }
  }
}

function button(action, label, icon, disabled = false, className = "") {
  const classAttr = className ? ` class="${esc(className)}"` : "";
  return `<button type="button"${classAttr} data-pilot-action="${esc(action)}" ${disabled ? "disabled" : ""}><i class="${esc(icon)}"></i><span>${esc(label)}</span></button>`;
}

function stateCard(label, value, state = "normal") {
  return `<div class="gfoe-pilot-state ${esc(state)}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

export function openCharacterPilot(actor = null) {
  if (actor && !actorCanBePiloted(actor)) actor = null;
  const initial = actor ?? preferredActor();
  if (!pilotApp) pilotApp = new CharacterPilotApp({ actorId: initial?.id ?? null, actorUuid: initial?.uuid ?? null });
  else if (actor) {
    pilotApp.actorId = actor.id;
    pilotApp.actorUuid = actor.uuid ?? null;
  }
  pilotApp.render({ force: true });
  return pilotApp;
}

function actorFromSocketRef(uuid, id) {
  try {
    const byUuid = uuid ? globalThis.fromUuidSync?.(uuid) : null;
    if (byUuid?.documentName === "Actor") return byUuid;
  } catch (_) {}
  return id ? game.actors?.get?.(id) ?? null : null;
}

export async function handleCharacterPilotSocket(payload) {
  if (!payload?.type || !game.user?.isGM || payload.toGM !== game.user.id) return false;

  if (payload.type === PILOT_SOCKET_EFFECT) {
    const sender = game.users?.get?.(payload.fromUser);
    const target = actorFromSocketRef(payload.actorUuid, payload.actorId);
    const origin = actorFromSocketRef(payload.originActorUuid, payload.originActorId);
    if (!sender || !target) return true;
    if (!sender.isGM) {
      if (payload.kind !== "boost") return true;
      if (origin && !origin.testUserPermission?.(sender, "OWNER")) return true;
    }
    await applyStackableNextCheckEffect(target, payload.kind, positiveInt(payload.amount, 1));
    return true;
  }

  if (payload.type === PILOT_SOCKET_END_TURN) {
    const sender = game.users?.get?.(payload.fromUser);
    const actor = actorFromSocketRef(payload.actorUuid, payload.actorId);
    const combat = game.combats?.get?.(payload.combatId) ?? currentCombat();
    if (!sender || !actor || !combat) return true;
    if (!sender.isGM && !actor.testUserPermission?.(sender, "OWNER")) return true;
    if (combatantActor(currentCombatant(combat))?.id !== actor.id) return true;
    if (typeof combat.nextTurn === "function") await combat.nextTurn();
    return true;
  }

  return false;
}

function tokenFromHudApp(app) {
  const direct = app?.object;
  if (direct?.actor) return direct;
  const document = app?.document ?? app?.object?.document ?? null;
  if (document?.object?.actor) return document.object;
  if (document?.id) return canvas?.tokens?.get?.(document.id) ?? null;
  return null;
}

function tokenHudRoot(app, html) {
  if (app?.element instanceof HTMLElement) return app.element;
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function addPilotButtonToTokenHud(app, html) {
  const token = tokenFromHudApp(app);
  const actor = token?.actor;
  if (!actorCanBePiloted(actor)) return;

  const root = tokenHudRoot(app, html);
  if (!root || root.querySelector("[data-gfoe-token-pilot]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon gfoe-token-pilot-control";
  button.dataset.gfoeTokenPilot = "true";
  button.title = t("openFromToken");
  button.setAttribute("aria-label", t("openFromToken"));
  button.innerHTML = '<i class="fa-solid fa-gamepad"></i>';
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openCharacterPilot(actor);
  });

  const preferredColumn = root.querySelector(
    ".col.right, .right.col, .control-column.right, [data-control-column=\"right\"], .right"
  );
  if (preferredColumn) preferredColumn.append(button);
  else {
    button.classList.add("gfoe-token-pilot-floating");
    root.append(button);
  }
}

export function registerCharacterPilotHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  Hooks.on("renderTokenHUD", (app, html) => addPilotButtonToTokenHud(app, html));
  Hooks.on("renderApplicationV2", (app, html) => {
    if (app?.constructor?.name !== "TokenHUD") return;
    addPilotButtonToTokenHud(app, html);
  });

  Hooks.on("controlToken", (token, controlled) => {
    if (!controlled || !pilotApp?.rendered || !actorCanBePiloted(token?.actor)) return;
    pilotApp.actorId = token.actor.id;
    pilotApp.actorUuid = token.actor.uuid ?? null;
    refreshPilot();
  });
  Hooks.on("targetToken", () => refreshPilot());
  Hooks.on("updateActor", actor => { if (pilotApp?.actorId === actor?.id) refreshPilot(); });
  Hooks.on("createActiveEffect", effect => { if (pilotApp?.actorId === effect?.parent?.id) refreshPilot(); });
  Hooks.on("updateActiveEffect", effect => { if (pilotApp?.actorId === effect?.parent?.id) refreshPilot(); });
  Hooks.on("deleteActiveEffect", effect => { if (pilotApp?.actorId === effect?.parent?.id) refreshPilot(); });
  Hooks.on("updateCombat", combat => { handleCombatTransition(combat).catch(err => console.warn(`${MODULE_ID} | character pilot combat transition failed`, err)); });
  Hooks.on("createCombat", combat => { combatTurnMemory.set(combat.id, turnMemory(combat)); refreshPilot(); });
  Hooks.on("deleteCombat", combat => { combatTurnMemory.delete(combat.id); refreshPilot(); });

  const combat = currentCombat();
  if (combat) combatTurnMemory.set(combat.id, turnMemory(combat));
}

export function initializeCharacterPilot() {
  registerCharacterPilotHooks();
}
