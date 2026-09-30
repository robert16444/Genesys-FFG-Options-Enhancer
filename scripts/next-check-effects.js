import { Lang } from "./i18n.js";

const MODULE_ID = "genesys-ffg-options-enhancer";
const ENHANCEMENTS_MODULE_ID = "ffg-star-wars-enhancements";
const STATUS_COUNTER_MODULE_ID = "statuscounter";
const STACK_FLAG = "nextCheckStack";

export const NEXT_CHECK_DIFFICULTY_STATUS_ID = "gfoe-upgrade-difficulty-once";

const EFFECTS = Object.freeze({
  boost: {
    statusId: "starwarsffg-boost-once",
    valueSuffix: ".boost"
  },
  setback: {
    statusId: "starwarsffg-setback-once",
    valueSuffix: ".setback"
  },
  upgradeAbility: {
    statusId: "starwarsffg-upgrade-once",
    valueSuffix: ".upgrades"
  },
  upgradeDifficulty: {
    statusId: NEXT_CHECK_DIFFICULTY_STATUS_ID,
    valueSuffix: null
  }
});

const PATCH_MARKER = Symbol.for(`${MODULE_ID}.nextCheckDifficultyPatch`);
let statusCounterHooksRegistered = false;
const mechanicalSyncLocks = new Set();

function cloneData(value) {
  if (value == null) return value;
  try {
    return foundry.utils.deepClone(value);
  } catch (_) {
    return JSON.parse(JSON.stringify(value));
  }
}

function safePositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(1, Math.trunc(Number(fallback) || 1));
  return Math.max(1, Math.trunc(parsed));
}

function safeNonNegativeInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(0, Math.trunc(Number(fallback) || 0));
  return Math.max(0, Math.trunc(parsed));
}

function getStatusDefinition(statusId) {
  const statuses = CONFIG?.statusEffects;
  if (!statuses || !statusId) return null;
  if (Array.isArray(statuses)) return statuses.find(status => status?.id === statusId) ?? null;
  if (typeof statuses === "object") return statuses[statusId] ?? Object.values(statuses).find(status => status?.id === statusId) ?? null;
  return null;
}

function localizeStatusName(status, fallback) {
  const raw = status?.name || status?.label || fallback;
  try {
    const localized = game.i18n?.localize?.(raw);
    return localized && localized !== raw ? localized : raw;
  } catch (_) {
    return raw;
  }
}

function effectHasStatus(effect, statusId) {
  if (!effect || !statusId) return false;
  const statuses = effect.statuses;
  if (statuses?.has) return statuses.has(statusId);
  try {
    return Array.from(statuses ?? []).includes(statusId);
  } catch (_) {
    return false;
  }
}

function kindForEffect(effect) {
  if (!effect) return null;

  try {
    const stored = effect.getFlag?.(MODULE_ID, STACK_FLAG)?.kind;
    if (stored && EFFECTS[stored]) return stored;
  } catch (_) {}

  for (const [kind, definition] of Object.entries(EFFECTS)) {
    if (effectHasStatus(effect, definition.statusId)) return kind;
  }
  return null;
}

function findStackEffect(actor, statusId) {
  if (!actor) return null;
  const effects = actor.effects?.contents ?? actor.effects ?? [];
  return Array.from(effects).find(effect => effectHasStatus(effect, statusId) && !effect.disabled) ?? null;
}

function getLegacyStoredStack(effect) {
  try {
    return safeNonNegativeInt(effect?.getFlag?.(MODULE_ID, STACK_FLAG)?.count, 0);
  } catch (_) {
    return 0;
  }
}

function getStatusCounterFlagValue(effect) {
  try {
    const value = Number(effect?.getFlag?.(STATUS_COUNTER_MODULE_ID, "value"));
    if (Number.isFinite(value) && value > 0) return Math.trunc(value);
  } catch (_) {}
  return 0;
}

function getStatusCounterDisplayValue(effect) {
  try {
    const value = Number(effect?.statusCounter?.displayValue);
    if (Number.isFinite(value) && value > 0) return Math.trunc(value);
  } catch (_) {}
  return 0;
}

function inferStackFromChanges(effect, effectDefinition) {
  if (!effect || !effectDefinition?.valueSuffix) return 1;
  const change = Array.from(effect.changes ?? []).find(entry =>
    typeof entry?.key === "string" && entry.key.endsWith(effectDefinition.valueSuffix)
  );
  const value = Number(change?.value);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.trunc(value)) : 1;
}

function currentStackCount(effect, effectDefinition) {
  if (!effect) return 0;

  const counterFlag = getStatusCounterFlagValue(effect);
  if (counterFlag > 0) return counterFlag;

  const counterDisplay = getStatusCounterDisplayValue(effect);
  if (counterDisplay > 0) return counterDisplay;

  const legacy = getLegacyStoredStack(effect);
  if (legacy > 0) return legacy;

  return inferStackFromChanges(effect, effectDefinition);
}

function scaleChanges(changes, count) {
  return (cloneData(changes) ?? []).map(change => {
    const numeric = Number(change?.value);
    if (!Number.isFinite(numeric)) return change;
    return { ...change, value: String(numeric * count) };
  });
}

function canonicalBaseChanges(kind) {
  const definition = EFFECTS[kind];
  if (!definition) return [];
  const status = getStatusDefinition(definition.statusId);
  return cloneData(status?.changes ?? []);
}

function baseNameForKind(kind) {
  const definition = EFFECTS[kind];
  const status = definition ? getStatusDefinition(definition.statusId) : null;
  return localizeStatusName(status, definition?.statusId ?? kind);
}

function buildLegacyMirror(kind, count) {
  return {
    kind,
    count,
    baseName: baseNameForKind(kind)
  };
}

function getCounterApi() {
  return game.modules?.get?.(STATUS_COUNTER_MODULE_ID)?.api ?? null;
}

function stackDependenciesActive() {
  return Boolean(
    game.modules?.get?.(ENHANCEMENTS_MODULE_ID)?.active &&
    game.modules?.get?.(STATUS_COUNTER_MODULE_ID)?.active
  );
}

function assertStackDependencies() {
  if (!game.modules?.get?.(ENHANCEMENTS_MODULE_ID)?.active) {
    throw new Error("FFG Star Wars Enhancements is required for next-check effect stacking.");
  }
  if (!game.modules?.get?.(STATUS_COUNTER_MODULE_ID)?.active) {
    throw new Error("Status Icon Counters is required for next-check effect stacking.");
  }
  if (!getCounterApi()) {
    throw new Error("Status Icon Counters API is not available.");
  }
}

function buildBaseEffectData(kind) {
  const definition = EFFECTS[kind];
  if (!definition) throw new Error(`Unknown next-check effect kind: ${kind}`);

  const status = getStatusDefinition(definition.statusId);
  if (!status) throw new Error(`Missing status effect definition: ${definition.statusId}`);

  const baseName = baseNameForKind(kind);
  const flags = cloneData(status.flags ?? {});
  flags[MODULE_ID] = {
    ...(flags[MODULE_ID] ?? {}),
    [STACK_FLAG]: buildLegacyMirror(kind, 1)
  };

  flags[STATUS_COUNTER_MODULE_ID] = {
    ...(flags[STATUS_COUNTER_MODULE_ID] ?? {}),
    value: 1,
    visible: true,
    config: {
      ...(flags[STATUS_COUNTER_MODULE_ID]?.config ?? {}),
      dataSource: `flags.${STATUS_COUNTER_MODULE_ID}.value`
    }
  };

  return {
    name: baseName,
    img: status.img ?? status.icon ?? "icons/svg/aura.svg",
    disabled: false,
    changes: canonicalBaseChanges(kind),
    statuses: [definition.statusId],
    system: {
      ...(cloneData(status.system ?? {})),
      duration: "once"
    },
    flags
  };
}

function counterChangeValue(changes) {
  if (!changes || typeof changes !== "object") return undefined;

  const flat = changes[`flags.${STATUS_COUNTER_MODULE_ID}.value`];
  if (flat !== undefined) return flat;

  try {
    const nested = foundry.utils.getProperty(changes, `flags.${STATUS_COUNTER_MODULE_ID}.value`);
    if (nested !== undefined) return nested;
  } catch (_) {}

  return undefined;
}

function setUpdatePath(update, path, value) {
  try {
    foundry.utils.setProperty(update, path, value);
  } catch (_) {
    update[path] = value;
  }
}

function changesEqual(a, b) {
  try { return JSON.stringify(a ?? []) === JSON.stringify(b ?? []); }
  catch (_) { return false; }
}

async function syncMechanicalStack(effect, explicitCount = null) {
  if (!effect || effect.disabled) return;
  const kind = kindForEffect(effect);
  if (!kind) return;

  const id = effect.uuid ?? effect.id;
  if (id && mechanicalSyncLocks.has(id)) return;

  const definition = EFFECTS[kind];
  const count = explicitCount == null
    ? currentStackCount(effect, definition)
    : safeNonNegativeInt(explicitCount, 0);
  if (count <= 0) return;

  const desiredChanges = scaleChanges(canonicalBaseChanges(kind), count);
  const desiredName = baseNameForKind(kind);
  const desiredMirror = buildLegacyMirror(kind, count);
  const currentMirror = (() => {
    try { return effect.getFlag?.(MODULE_ID, STACK_FLAG) ?? null; }
    catch (_) { return null; }
  })();

  const update = {};
  if (!changesEqual(effect.changes, desiredChanges)) update.changes = desiredChanges;
  if (effect.name !== desiredName) update.name = desiredName;
  if (JSON.stringify(currentMirror) !== JSON.stringify(desiredMirror)) {
    setUpdatePath(update, `flags.${MODULE_ID}.${STACK_FLAG}`, desiredMirror);
  }

  if (!Object.keys(update).length) return;

  try {
    if (id) mechanicalSyncLocks.add(id);
    await effect.update(update, { gfoeNextCheckMechanicalSync: true });
  } finally {
    if (id) mechanicalSyncLocks.delete(id);
  }
}

async function setStatusCounterValue(effect, count) {
  if (!effect) return null;
  assertStackDependencies();

  const next = safeNonNegativeInt(count, 0);
  const counter = effect.statusCounter;
  if (counter?.setValue) {
    await counter.setValue(next);
  } else {
    if (next <= 0) {
      await effect.delete();
      return null;
    }
    await effect.update({
      [`flags.${STATUS_COUNTER_MODULE_ID}.value`]: next,
      [`flags.${STATUS_COUNTER_MODULE_ID}.visible`]: true
    });
  }

  const parent = effect.parent;
  const current = parent?.effects?.get?.(effect.id) ?? effect;
  if (next > 0 && current) await syncMechanicalStack(current, next);
  return current;
}

export function getNextCheckStackCount(actor, kind) {
  const definition = EFFECTS[kind];
  if (!definition || !actor) return 0;
  const effect = findStackEffect(actor, definition.statusId);
  return currentStackCount(effect, definition);
}

export async function applyStackableNextCheckEffect(actor, kind, amount = 1) {
  if (!actor) throw new Error("No actor supplied for next-check effect.");
  const definition = EFFECTS[kind];
  if (!definition) throw new Error(`Unknown next-check effect kind: ${kind}`);
  assertStackDependencies();

  const add = safePositiveInt(amount, 1);
  const existing = findStackEffect(actor, definition.statusId);
  const previousCount = currentStackCount(existing, definition);
  const nextCount = previousCount + add;

  if (existing) {
    await setStatusCounterValue(existing, nextCount);
    return {
      type: "nextCheckEffectStack",
      actor,
      effect: existing,
      effectId: existing.id,
      kind,
      created: false,
      previousCount,
      newCount: nextCount
    };
  }

  const created = await actor.createEmbeddedDocuments("ActiveEffect", [buildBaseEffectData(kind)]);
  const effect = created?.[0];
  if (!effect) throw new Error("Failed to create next-check Active Effect.");

  // The base effect starts at one. Status Counter becomes the authoritative
  // stack store immediately, including effects granted from Spend Results.
  await setStatusCounterValue(effect, nextCount);

  return {
    type: "nextCheckEffectStack",
    actor,
    effect,
    effectId: effect.id,
    kind,
    created: true,
    previousCount: 0,
    newCount: nextCount
  };
}

export async function rollbackStackableNextCheckEffect(result) {
  if (!result?.actor || result.type !== "nextCheckEffectStack") return;

  const effect = result.actor.effects?.get?.(result.effectId) ?? result.effect;
  if (result.created) {
    if (effect) await effect.delete();
    return;
  }

  if (!effect) return;
  await setStatusCounterValue(effect, safeNonNegativeInt(result.previousCount, 0));
}

export async function removeStackableNextCheckEffect(actor, kind, amount = 1) {
  if (!actor) throw new Error("No actor supplied for next-check effect.");
  const definition = EFFECTS[kind];
  if (!definition) throw new Error(`Unknown next-check effect kind: ${kind}`);
  assertStackDependencies();

  const existing = findStackEffect(actor, definition.statusId);
  if (!existing) return { kind, previousCount: 0, newCount: 0, deleted: false };

  const remove = safePositiveInt(amount, 1);
  const previousCount = currentStackCount(existing, definition);
  const nextCount = Math.max(0, previousCount - remove);

  await setStatusCounterValue(existing, nextCount);
  return { kind, previousCount, newCount: nextCount, deleted: nextCount <= 0 };
}

async function migrateLegacyStackEffects() {
  if (!game.user?.isGM || !stackDependenciesActive()) return;

  for (const actor of Array.from(game.actors ?? [])) {
    const effects = Array.from(actor?.effects?.contents ?? actor?.effects ?? []);
    for (const effect of effects) {
      const kind = kindForEffect(effect);
      if (!kind || effect.disabled) continue;

      const definition = EFFECTS[kind];
      const legacy = getLegacyStoredStack(effect);
      const counter = getStatusCounterFlagValue(effect) || getStatusCounterDisplayValue(effect);
      const inferred = inferStackFromChanges(effect, definition);
      const desired = Math.max(1, legacy || counter || inferred || 1);

      try {
        if (counter !== desired) await setStatusCounterValue(effect, desired);
        else await syncMechanicalStack(effect, desired);
      } catch (err) {
        console.warn(`${MODULE_ID} | next-check effects | failed to migrate ${actor.name ?? actor.id}`, err);
      }
    }
  }
}

export function registerNextCheckStatusCounterIntegration() {
  if (statusCounterHooksRegistered) return true;

  if (!stackDependenciesActive()) {
    console.error(`${MODULE_ID} | next-check effects | required stacking modules are inactive`);
    return false;
  }

  assertStackDependencies();
  statusCounterHooksRegistered = true;

  Hooks.on("preUpdateActiveEffect", (effect, changes, options) => {
    if (options?.gfoeNextCheckMechanicalSync) return;
    const kind = kindForEffect(effect);
    if (!kind) return;

    const raw = counterChangeValue(changes);
    if (raw === undefined) return;
    const count = safeNonNegativeInt(raw, 0);
    if (count <= 0) return;

    changes.changes = scaleChanges(canonicalBaseChanges(kind), count);
    changes.name = baseNameForKind(kind);
    setUpdatePath(changes, `flags.${MODULE_ID}.${STACK_FLAG}`, buildLegacyMirror(kind, count));
  });

  Hooks.on("createActiveEffect", effect => {
    const kind = kindForEffect(effect);
    if (!kind) return;
    queueMicrotask(() => {
      const definition = EFFECTS[kind];
      const count = currentStackCount(effect, definition) || 1;
      syncMechanicalStack(effect, count).catch(err =>
        console.warn(`${MODULE_ID} | next-check effects | failed to initialize counter mechanics`, err)
      );
    });
  });

  Hooks.on("updateActiveEffect", (effect, changes, options) => {
    if (options?.gfoeNextCheckMechanicalSync) return;
    const kind = kindForEffect(effect);
    if (!kind) return;

    const counterTouched = counterChangeValue(changes) !== undefined
      || (() => {
        try { return foundry.utils.getProperty(changes, `flags.${STATUS_COUNTER_MODULE_ID}`) !== undefined; }
        catch (_) { return false; }
      })();
    if (!counterTouched) return;

    queueMicrotask(() => {
      syncMechanicalStack(effect).catch(err =>
        console.warn(`${MODULE_ID} | next-check effects | failed to synchronize counter mechanics`, err)
      );
    });
  });

  setTimeout(() => { migrateLegacyStackEffects().catch(() => {}); }, 0);
  return true;
}


function resolveActorFromRollData(data) {
  if (!data) return null;
  if (data.document?.documentName === "Actor" || data.document?.type) return data.document;

  const actorId = data.actor?._id ?? data.actor?.id ?? data.actorId ?? null;
  if (actorId) return game.actors?.get(actorId) ?? null;
  return null;
}

export function applyNextCheckDifficultyUpgradeToPool(actor, dicePool) {
  if (!actor || !dicePool) return 0;
  const count = getNextCheckStackCount(actor, "upgradeDifficulty");
  if (count <= 0) return 0;

  if (typeof dicePool.upgradeDifficulty === "function") {
    for (let i = 0; i < count; i += 1) dicePool.upgradeDifficulty();
    return count;
  }

  return 0;
}

export function registerNextCheckRollAutomation() {
  const DiceHelpers = game.ffg?.DiceHelpers;
  if (!DiceHelpers || typeof DiceHelpers.displayRollDialog !== "function") {
    console.warn(`${MODULE_ID} | next-check effects | DiceHelpers.displayRollDialog is unavailable`);
    return false;
  }

  if (DiceHelpers.displayRollDialog[PATCH_MARKER]) return true;

  const original = DiceHelpers.displayRollDialog;
  const wrapped = async function(data, dicePool, ...rest) {
    try {
      const actor = resolveActorFromRollData(data);
      applyNextCheckDifficultyUpgradeToPool(actor, dicePool);
    } catch (err) {
      console.warn(`${MODULE_ID} | next-check effects | failed to apply difficulty upgrade`, err);
    }
    return original.call(this, data, dicePool, ...rest);
  };

  Object.defineProperty(wrapped, PATCH_MARKER, { value: true });
  DiceHelpers.displayRollDialog = wrapped;
  return true;
}


const PENDING_NEXT_ALLY_FLAG = "pendingNextAllySlotEffects";
const pendingCombatLocks = new Set();
let pendingHooksRegistered = false;

function safeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function activePrimaryGM() {
  return Array.from(game.users ?? [])
    .filter(user => user?.active && user?.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

function isPrimaryGMClient() {
  return Boolean(game.user?.isGM && activePrimaryGM()?.id === game.user.id);
}

function resolveMessageScene(message) {
  const raw = message?.speaker?.scene;
  const id = typeof raw === "string" ? raw : raw?.id;
  return (id ? game.scenes?.get?.(id) : null) ?? globalThis.canvas?.scene ?? game.scenes?.current ?? null;
}

function resolveMessageTokenDocument(message) {
  const raw = message?.speaker?.token;
  const id = typeof raw === "string" ? raw : raw?.id;
  if (!id) return null;
  const scene = resolveMessageScene(message);
  return scene?.tokens?.get?.(id) ?? globalThis.canvas?.tokens?.get?.(id)?.document ?? null;
}

function combatSceneId(combat) {
  const scene = combat?.scene;
  return typeof scene === "string" ? scene : scene?.id ?? combat?._source?.scene ?? null;
}

function combatForMessage(message) {
  const scene = resolveMessageScene(message);
  const sceneId = scene?.id ?? null;
  const combat = game.combat;
  if (!combat) return null;
  const cScene = combatSceneId(combat);
  if (sceneId && cScene && sceneId !== cScene) return null;
  if (!(combat.started === true || safeInt(combat.round, 0) > 0)) return null;
  return combat;
}

function tokenDisposition(tokenLike) {
  const raw = tokenLike?.disposition
    ?? tokenLike?.document?.disposition
    ?? tokenLike?.data?.disposition
    ?? tokenLike?._source?.disposition;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function combatantDisposition(combatant) {
  return tokenDisposition(combatant)
    ?? tokenDisposition(combatant?.token)
    ?? tokenDisposition(combatant?.token?.document)
    ?? null;
}

function currentTurnIndex(combat) {
  const turn = safeInt(combat?.turn, Number.NaN);
  if (Number.isInteger(turn) && turn >= 0) return turn;
  const current = safeInt(combat?.current?.turn, Number.NaN);
  return Number.isInteger(current) && current >= 0 ? current : -1;
}

function currentRound(combat) {
  return Math.max(1, safeInt(combat?.round, 1));
}

function resolveOriginDisposition(message, combat) {
  const fromRoll = tokenDisposition(resolveMessageTokenDocument(message));
  if (fromRoll != null) return fromRoll;
  const index = currentTurnIndex(combat);
  const current = Array.from(combat?.turns ?? [])[index] ?? combat?.combatant ?? null;
  return combatantDisposition(current);
}

export function findNextAlliedInitiativeSlot(message) {
  const combat = combatForMessage(message);
  if (!combat) return null;

  const turns = Array.from(combat.turns ?? []);
  if (!turns.length) return null;
  const fromIndex = currentTurnIndex(combat);
  if (fromIndex < 0) return null;

  const disposition = resolveOriginDisposition(message, combat);
  if (disposition == null) return null;

  const inspect = (index, wrapped) => {
    const slot = turns[index];
    if (!slot || combatantDisposition(slot) !== disposition) return null;
    return {
      combat,
      combatId: combat.id,
      slot,
      slotCombatantId: slot.id,
      slotIndex: index,
      slotInitiative: Number.isFinite(Number(slot.initiative)) ? Number(slot.initiative) : null,
      targetRound: currentRound(combat) + (wrapped ? 1 : 0),
      disposition,
      initialActorId: slot.actor?.id ?? slot.actorId ?? null,
      initialTokenId: slot.token?.id ?? slot.tokenId ?? null,
      slotLabel: slot.name || Lang.t("resultSpender.nextAllySlotGeneric")
    };
  };

  for (let i = fromIndex + 1; i < turns.length; i += 1) {
    const result = inspect(i, false);
    if (result) return result;
  }
  for (let i = 0; i <= fromIndex; i += 1) {
    const result = inspect(i, true);
    if (result) return result;
  }
  return null;
}

function readPending(combat) {
  try {
    const value = combat?.getFlag?.(MODULE_ID, PENDING_NEXT_ALLY_FLAG);
    return Array.isArray(value) ? cloneData(value) : [];
  } catch (_) {
    return [];
  }
}

async function writePending(combat, entries) {
  if (!combat) return;
  if (!entries.length) {
    try { await combat.unsetFlag(MODULE_ID, PENDING_NEXT_ALLY_FLAG); } catch (_) { await combat.setFlag(MODULE_ID, PENDING_NEXT_ALLY_FLAG, []); }
    return;
  }
  await combat.setFlag(MODULE_ID, PENDING_NEXT_ALLY_FLAG, entries);
}

export async function queueNextAlliedSlotEffect(message, kind, amount = 1) {
  const slot = findNextAlliedInitiativeSlot(message);
  if (!slot) throw new Error(Lang.t("resultSpender.noNextAllySlot"));

  const entry = {
    id: foundry.utils.randomID(),
    effectKind: kind,
    amount: safePositiveInt(amount, 1),
    sourceMessageId: message?.id ?? null,
    sourceUserId: message?.author?.id ?? message?.user?.id ?? (typeof message?.user === "string" ? message.user : null),
    combatId: slot.combatId,
    slotCombatantId: slot.slotCombatantId,
    slotIndex: slot.slotIndex,
    slotInitiative: slot.slotInitiative,
    targetRound: slot.targetRound,
    disposition: slot.disposition,
    initialActorId: slot.initialActorId,
    initialTokenId: slot.initialTokenId,
    createdAt: Date.now()
  };

  const pending = readPending(slot.combat);
  pending.push(entry);
  await writePending(slot.combat, pending);

  return {
    type: "pendingNextAllySlot",
    combatId: slot.combatId,
    pendingId: entry.id,
    slotCombatantId: slot.slotCombatantId,
    slotIndex: slot.slotIndex,
    targetRound: slot.targetRound,
    slotLabel: slot.slotLabel,
    effectKind: kind
  };
}

export async function rollbackPendingNextAlliedSlotEffect(result) {
  if (!result?.combatId || !result?.pendingId) return;
  const combat = game.combats?.get?.(result.combatId) ?? (game.combat?.id === result.combatId ? game.combat : null);
  if (!combat) return;
  const pending = readPending(combat).filter(entry => entry?.id !== result.pendingId);
  await writePending(combat, pending);
}

function claimantIdForEntry(combat, entry) {
  if (!combat || !entry?.slotCombatantId) return null;
  const round = Math.max(1, safeInt(entry.targetRound, currentRound(combat)));

  try {
    const viaSystem = combat.getSlotClaims?.(round, entry.slotCombatantId);
    if (viaSystem) return viaSystem;
  } catch (_) {}

  try {
    const claims = combat.getFlag?.("starwarsffg", "combatClaims") ?? {};
    return claims?.[round]?.[entry.slotCombatantId] ?? null;
  } catch (_) {
    return null;
  }
}

function claimedActorForEntry(combat, entry) {
  const claimantId = claimantIdForEntry(combat, entry);
  if (!claimantId) return null;

  const claimant = combat.combatants?.get?.(claimantId)
    ?? Array.from(combat.combatants ?? []).find(combatant => combatant?.id === claimantId)
    ?? null;
  if (!claimant) return null;

  const disp = combatantDisposition(claimant);
  if (entry.disposition != null && disp != null && Number(entry.disposition) !== Number(disp)) return null;

  return claimant.actor ?? claimant.token?.actor ?? null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function announcePendingApplied(entry, actor, newCount) {
  const effect = escapeHtml(Lang.t(`resultSpender.automation.effectNames.${entry.effectKind}`));
  const actorName = escapeHtml(actor.name || "Actor");
  const content = `<div class="gfoe-spend-chat-card">
    <div class="gfoe-spend-chat-title"><i class="fa-solid fa-wand-magic-sparkles"></i> ${escapeHtml(Lang.t("resultSpender.automation.nextAllyAppliedTitle"))}</div>
    <div class="gfoe-spend-chat-description">${Lang.t("resultSpender.automation.nextAllyApplied", { effect, actor: actorName, count: Number(newCount) || 1 })}</div>
  </div>`;
  const data = {
    content,
    speaker: { alias: Lang.t("resultSpender.dialogTitle") },
    flags: { [MODULE_ID]: { pendingNextAllyApplied: { pendingId: entry.id, sourceMessageId: entry.sourceMessageId, actorId: actor.id, effectKind: entry.effectKind, count: newCount } } }
  };

  const sourceMessage = entry.sourceMessageId ? game.messages?.get?.(entry.sourceMessageId) : null;
  const whisper = Array.isArray(sourceMessage?.whisper)
    ? sourceMessage.whisper.map(user => typeof user === "string" ? user : user?.id).filter(Boolean)
    : [];
  if (whisper.length) data.whisper = whisper;
  if (sourceMessage?.blind) data.blind = true;

  await ChatMessage.create(data);
}

async function processPendingForCombat(combat, trigger = {}) {
  if (!combat || !isPrimaryGMClient()) return;
  if (pendingCombatLocks.has(combat.id)) return;
  const pending = readPending(combat);
  if (!pending.length) return;

  pendingCombatLocks.add(combat.id);
  try {
    const keep = [];
    for (const entry of pending) {
      try {
        const actor = claimedActorForEntry(combat, entry);
        if (!actor) {
          keep.push(entry);
          continue;
        }

        const result = await applyStackableNextCheckEffect(actor, entry.effectKind, entry.amount ?? 1);
        try {
          await announcePendingApplied(entry, actor, result.newCount);
        } catch (chatErr) {
          console.warn(`${MODULE_ID} | next-check effects | failed to announce pending next-ally effect`, chatErr);
        }
      } catch (err) {
        console.error(`${MODULE_ID} | next-check effects | failed to apply pending next-ally effect`, err);
        keep.push(entry);
      }
    }
    if (keep.length !== pending.length) await writePending(combat, keep);
  } finally {
    pendingCombatLocks.delete(combat.id);
  }
}

export function registerPendingNextAllySlotAutomation() {
  if (pendingHooksRegistered) return;
  pendingHooksRegistered = true;

  Hooks.on("updateCombat", (combat, changes) => {
    const keys = Object.keys(changes ?? {});
    const hasClaimUpdate = keys.some(key => key.startsWith("flags.starwarsffg"))
      || Boolean(changes?.flags?.starwarsffg?.combatClaims);
    const hasTurnUpdate = Object.prototype.hasOwnProperty.call(changes ?? {}, "turn")
      || Object.prototype.hasOwnProperty.call(changes ?? {}, "round");
    if (!hasClaimUpdate && !hasTurnUpdate) return;
    void processPendingForCombat(combat, { type: hasClaimUpdate ? "claim" : "turn", changes });
  });

  if (game.combat) void processPendingForCombat(game.combat, { type: "ready" });
}
