const MODULE_ID = "genesys-ffg-options-enhancer";

const FALLBACK_IDS = {
  invisible: "invisible",
  blind: "blind",
  upgradeDifficultyOnce: "gfoe-upgrade-difficulty-once"
};

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
      upgradeDifficultyOnce: "Ulepszenie trudności (następny test)"
    };
  }
  return {
    invisible: "Invisible",
    blind: "Blinded",
    upgradeDifficultyOnce: "Upgrade Difficulty (Next Check)"
  };
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

  ensureUpgradeDifficultyStatus(text.upgradeDifficultyOnce);
}
