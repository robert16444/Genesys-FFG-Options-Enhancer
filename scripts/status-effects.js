const MODULE_ID = "genesys-ffg-options-enhancer";

const FALLBACK_IDS = {
  invisible: "invisible",
  blind: "blind",
  prone: "gfoe-prone",
  immobilized: "gfoe-immobilized",
  guardedStance: "gfoe-guarded-stance",
  upgradeDifficultyOnce: "gfoe-upgrade-difficulty-once"
};

export const GUARDED_STANCE_STATUS_ID = FALLBACK_IDS.guardedStance;

let guardedHooksRegistered = false;
const guardedSyncLocks = new Set();

function moduleLanguage() {
  try {
    return game.settings.get(MODULE_ID, "language") === "pl" ? "pl" : "en";
  } catch (_) {
    return game.i18n?.lang === "pl" ? "pl" : "en";
  }
}

function labels() {
  if (moduleLanguage() === "pl") {
    return {
      invisible: "Niewidzialność",
      blind: "Oślepienie",
      prone: "Prone / Powalony",
      immobilized: "Immobilized",
      guardedStance: "Guarded Stance",
      upgradeDifficultyOnce: "Ulepszenie trudności (następny test)"
    };
  }
  return {
    invisible: "Invisible",
    blind: "Blinded",
    prone: "Prone",
    immobilized: "Immobilized",
    guardedStance: "Guarded Stance",
    upgradeDifficultyOnce: "Upgrade Difficulty (Next Check)"
  };
}

function cloneData(value) {
  if (value == null) return value;
  try { return foundry.utils.deepClone(value); }
  catch (_) { return JSON.parse(JSON.stringify(value)); }
}

function getStatusEffects() {
  return CONFIG?.statusEffects;
}

function findStatusById(id) {
  const statuses = getStatusEffects();
  if (!statuses || !id) return null;

  if (Array.isArray(statuses)) return statuses.find(effect => effect?.id === id) ?? null;
  if (typeof statuses === "object") return statuses[id] ?? Object.values(statuses).find(effect => effect?.id === id) ?? null;
  return null;
}

function findFirstStatus(ids) {
  for (const id of ids) {
    const found = findStatusById(id);
    if (found) return found;
  }
  return null;
}

function addStatusEffect(data) {
  const statuses = getStatusEffects();
  if (!statuses) return false;

  if (Array.isArray(statuses)) {
    if (!statuses.some(effect => effect?.id === data.id)) statuses.push(data);
    return true;
  }

  if (typeof statuses === "object") {
    if (!statuses[data.id]) statuses[data.id] = data;
    return true;
  }

  return false;
}

function ensureSpecialStatus({ specialKey, candidates, fallbackId, name, img }) {
  CONFIG.specialStatusEffects ??= {};

  let statusId = CONFIG.specialStatusEffects[specialKey];
  let existing = statusId ? findStatusById(statusId) : null;

  if (!existing) {
    existing = findFirstStatus(candidates);
    if (existing?.id) statusId = existing.id;
  }

  statusId ||= fallbackId;

  if (!existing) {
    addStatusEffect({
      id: statusId,
      name,
      img,
      changes: [],
      disabled: false,
      duration: {},
      flags: {
        [MODULE_ID]: {
          providedStatus: true,
          specialStatus: specialKey
        }
      }
    });
  }

  CONFIG.specialStatusEffects[specialKey] = statusId;
}

function ensureSimpleStatus({ id, candidates = [], name, img, flags = {} }) {
  const existing = findFirstStatus([id, ...candidates].filter(Boolean));
  if (existing) return existing;

  const data = {
    id,
    name,
    img,
    changes: [],
    disabled: false,
    duration: {},
    flags: {
      [MODULE_ID]: {
        providedStatus: true,
        ...flags
      }
    }
  };
  addStatusEffect(data);
  return data;
}

function ensureUpgradeDifficultyStatus(name) {
  const id = FALLBACK_IDS.upgradeDifficultyOnce;
  if (findStatusById(id)) return;

  addStatusEffect({
    id,
    name,
    img: `systems/starwarsffg/images/dice/${CONFIG.FFG?.theme ?? "starwars"}/red.png`,
    changes: [],
    disabled: false,
    system: { duration: "once" },
    flags: {
      [MODULE_ID]: {
        providedStatus: true,
        nextCheckEffect: "upgradeDifficulty"
      }
    }
  });
}

function effectHasStatus(effect, statusId) {
  if (!effect || !statusId) return false;
  try {
    if (effect.statuses?.has) return effect.statuses.has(statusId);
    return Array.from(effect.statuses ?? []).includes(statusId);
  } catch (_) {
    return false;
  }
}

function findNumericPath(root, candidates) {
  for (const path of candidates) {
    try {
      const value = foundry.utils.getProperty(root, path);
      if (typeof value === "number" && Number.isFinite(value)) return path;
    } catch (_) {}
  }
  return null;
}

function meleeDefensePath(actor) {
  return findNumericPath(actor, [
    "system.stats.defence.melee.value",
    "system.stats.defence.melee",
    "system.stats.defense.melee.value",
    "system.stats.defense.melee",
    "system.stats.meleeDefence.value",
    "system.stats.meleeDefence",
    "system.stats.meleeDefense.value",
    "system.stats.meleeDefense",
    "system.stats.defenceMelee.value",
    "system.stats.defenceMelee",
    "system.stats.defenseMelee.value",
    "system.stats.defenseMelee"
  ]);
}

function setbackBaseChanges() {
  const status = findStatusById("starwarsffg-setback-once");
  return cloneData(status?.changes ?? []);
}

function addChange(path, value) {
  return {
    key: path,
    mode: CONST.ACTIVE_EFFECT_MODES.ADD,
    value: String(value),
    priority: 20
  };
}

export function buildGuardedStanceChanges(actor) {
  const changes = setbackBaseChanges();
  const melee = meleeDefensePath(actor);
  if (melee) changes.push(addChange(melee, 1));
  return changes;
}

function changesEqual(a, b) {
  try { return JSON.stringify(a ?? []) === JSON.stringify(b ?? []); }
  catch (_) { return false; }
}

async function syncGuardedStanceEffect(effect) {
  if (!effect || effect.disabled || !effectHasStatus(effect, GUARDED_STANCE_STATUS_ID)) return;
  const id = effect.uuid ?? effect.id;
  if (id && guardedSyncLocks.has(id)) return;
  const actor = effect.parent;
  if (!actor || actor.documentName !== "Actor") return;

  const desired = buildGuardedStanceChanges(actor);
  if (changesEqual(effect.changes, desired)) return;

  try {
    if (id) guardedSyncLocks.add(id);
    await effect.update({ changes: desired }, { gfoeGuardedStanceSync: true });
  } finally {
    if (id) guardedSyncLocks.delete(id);
  }
}

export function registerGuardedStanceAutomation() {
  if (guardedHooksRegistered) return;
  guardedHooksRegistered = true;

  Hooks.on("createActiveEffect", (effect, _options, userId) => {
    if (userId && userId !== game.user?.id) return;
    if (!effectHasStatus(effect, GUARDED_STANCE_STATUS_ID)) return;
    queueMicrotask(() => syncGuardedStanceEffect(effect).catch(err =>
      console.warn(`${MODULE_ID} | guarded stance | failed to initialize effect`, err)
    ));
  });

  Hooks.on("updateActiveEffect", (effect, _changes, options, userId) => {
    if (userId && userId !== game.user?.id) return;
    if (options?.gfoeGuardedStanceSync || !effectHasStatus(effect, GUARDED_STANCE_STATUS_ID)) return;
    queueMicrotask(() => syncGuardedStanceEffect(effect).catch(err =>
      console.warn(`${MODULE_ID} | guarded stance | failed to synchronize effect`, err)
    ));
  });

  if (game.user?.isGM) {
    setTimeout(() => {
      for (const actor of Array.from(game.actors ?? [])) {
        for (const effect of Array.from(actor?.effects?.contents ?? actor?.effects ?? [])) {
          if (!effectHasStatus(effect, GUARDED_STANCE_STATUS_ID)) continue;
          syncGuardedStanceEffect(effect).catch(() => {});
        }
      }
    }, 0);
  }
}

export function registerVisionStatusEffects() {
  const text = labels();

  ensureSpecialStatus({
    specialKey: "INVISIBLE",
    candidates: [CONFIG.specialStatusEffects?.INVISIBLE, "invisible", "gfoe-invisible"].filter(Boolean),
    fallbackId: FALLBACK_IDS.invisible,
    name: text.invisible,
    img: "icons/svg/invisible.svg"
  });

  ensureSpecialStatus({
    specialKey: "BLIND",
    candidates: [CONFIG.specialStatusEffects?.BLIND, "blind", "blinded", "gfoe-blind"].filter(Boolean),
    fallbackId: FALLBACK_IDS.blind,
    name: text.blind,
    img: "icons/svg/blind.svg"
  });

  ensureSimpleStatus({
    id: FALLBACK_IDS.prone,
    candidates: ["prone", "starwarsffg-prone"],
    name: text.prone,
    img: "icons/svg/falling.svg"
  });

  ensureSimpleStatus({
    id: FALLBACK_IDS.immobilized,
    candidates: ["immobilized", "starwarsffg-immobilized"],
    name: text.immobilized,
    img: "icons/svg/net.svg"
  });

  ensureSimpleStatus({
    id: GUARDED_STANCE_STATUS_ID,
    name: text.guardedStance,
    img: "icons/svg/shield.svg",
    flags: { guardedStance: true }
  });

  ensureUpgradeDifficultyStatus(text.upgradeDifficultyOnce);
}
