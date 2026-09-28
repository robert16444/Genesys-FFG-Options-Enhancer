import { Lang } from "./i18n.js";

const MODULE_ID = "genesys-ffg-options-enhancer";
const FEATURE_SETTING = "enableResultSpender";
const CUSTOM_OPTIONS_SETTING = "resultSpenderCustomOptions";
const FLAG_KEY = "resultSpender";
const MAX_HISTORY = 100;
const SYMBOLS = ["advantage", "threat", "triumph", "despair"];
const POSITIVE_SYMBOLS = new Set(["advantage", "triumph"]);
const NEGATIVE_SYMBOLS = new Set(["threat", "despair"]);
const spendLocks = new Set();
let hooksRegistered = false;

const MSG = {
  SPEND_REQUEST: "RESULT_SPENDER_SPEND_REQUEST",
  FEEDBACK: "RESULT_SPENDER_FEEDBACK"
};

const SOCIAL_OPTION_DEFINITIONS = Object.freeze([
  { id: "social-recover-strain", costs: { advantage: 1, triumph: 1 }, automation: { type: "strain", delta: -1 }, titleKey: "resultSpender.builtins.socialRecoverStrain.title", descriptionKey: "resultSpender.builtins.socialRecoverStrain.description" },
  { id: "social-next-ally-boost", costs: { advantage: 1, triumph: 1 }, titleKey: "resultSpender.builtins.socialNextAllyBoost.title", descriptionKey: "resultSpender.builtins.socialNextAllyBoost.description" },
  { id: "social-notice-detail", costs: { advantage: 1, triumph: 1 }, titleKey: "resultSpender.builtins.socialNoticeDetail.title", descriptionKey: "resultSpender.builtins.socialNoticeDetail.description" },

  { id: "social-learn-strength-flaw", costs: { advantage: 2, triumph: 1 }, titleKey: "resultSpender.builtins.socialLearnStrengthFlaw.title", descriptionKey: "resultSpender.builtins.socialLearnStrengthFlaw.description" },
  { id: "social-target-boost", costs: { advantage: 2, triumph: 1 }, titleKey: "resultSpender.builtins.socialTargetBoost.title", descriptionKey: "resultSpender.builtins.socialTargetBoost.description" },
  { id: "social-any-ally-boost", costs: { advantage: 2, triumph: 1 }, titleKey: "resultSpender.builtins.socialAnyAllyBoost.title", descriptionKey: "resultSpender.builtins.socialAnyAllyBoost.description" },

  { id: "social-learn-desire-fear", costs: { advantage: 3, triumph: 1 }, titleKey: "resultSpender.builtins.socialLearnDesireFear.title", descriptionKey: "resultSpender.builtins.socialLearnDesireFear.description" },
  { id: "social-conceal-goal", costs: { advantage: 3, triumph: 1 }, titleKey: "resultSpender.builtins.socialConcealGoal.title", descriptionKey: "resultSpender.builtins.socialConcealGoal.description" },
  { id: "social-learn-true-goal", costs: { advantage: 3, triumph: 1 }, titleKey: "resultSpender.builtins.socialLearnTrueGoal.title", descriptionKey: "resultSpender.builtins.socialLearnTrueGoal.description" },

  { id: "social-learn-motivation", costs: { triumph: 1 }, titleKey: "resultSpender.builtins.socialLearnMotivation.title", descriptionKey: "resultSpender.builtins.socialLearnMotivation.description" },
  { id: "social-upgrade-target-difficulty", costs: { triumph: 1 }, titleKey: "resultSpender.builtins.socialUpgradeTargetDifficulty.title", descriptionKey: "resultSpender.builtins.socialUpgradeTargetDifficulty.description" },
  { id: "social-upgrade-ally-ability", costs: { triumph: 1 }, titleKey: "resultSpender.builtins.socialUpgradeAllyAbility.title", descriptionKey: "resultSpender.builtins.socialUpgradeAllyAbility.description" },
  { id: "social-do-vital", costs: { triumph: 1 }, titleKey: "resultSpender.builtins.socialDoVital.title", descriptionKey: "resultSpender.builtins.socialDoVital.description" },

  { id: "social-suffer-strain", costs: { threat: { cost: 1, variable: true, scaleAutomation: true }, despair: 1 }, automation: { type: "strain", delta: 1 }, titleKey: "resultSpender.builtins.socialSufferStrain.title", descriptionKey: "resultSpender.builtins.socialSufferStrain.description" },
  { id: "social-distracted", costs: { threat: 1, despair: 1 }, titleKey: "resultSpender.builtins.socialDistracted.title", descriptionKey: "resultSpender.builtins.socialDistracted.description" },

  { id: "social-reveal-strength-flaw", costs: { threat: 2, despair: 1 }, titleKey: "resultSpender.builtins.socialRevealStrengthFlaw.title", descriptionKey: "resultSpender.builtins.socialRevealStrengthFlaw.description" },
  { id: "social-target-gets-boost", costs: { threat: 2, despair: 1 }, titleKey: "resultSpender.builtins.socialTargetGetsBoost.title", descriptionKey: "resultSpender.builtins.socialTargetGetsBoost.description" },
  { id: "social-ally-setback", costs: { threat: 2, despair: 1 }, titleKey: "resultSpender.builtins.socialAllySetback.title", descriptionKey: "resultSpender.builtins.socialAllySetback.description" },

  { id: "social-reveal-desire-fear", costs: { threat: 3, despair: 1 }, titleKey: "resultSpender.builtins.socialRevealDesireFear.title", descriptionKey: "resultSpender.builtins.socialRevealDesireFear.description" },
  { id: "social-reveal-goal", costs: { threat: 3, despair: 1 }, titleKey: "resultSpender.builtins.socialRevealGoal.title", descriptionKey: "resultSpender.builtins.socialRevealGoal.description" },

  { id: "social-reveal-ally-motivation", costs: { despair: 1 }, titleKey: "resultSpender.builtins.socialRevealAllyMotivation.title", descriptionKey: "resultSpender.builtins.socialRevealAllyMotivation.description" },
  { id: "social-false-motivation", costs: { despair: 1 }, titleKey: "resultSpender.builtins.socialFalseMotivation.title", descriptionKey: "resultSpender.builtins.socialFalseMotivation.description" },
  { id: "social-upgrade-ally-difficulty", costs: { despair: 1 }, titleKey: "resultSpender.builtins.socialUpgradeAllyDifficulty.title", descriptionKey: "resultSpender.builtins.socialUpgradeAllyDifficulty.description" },
  { id: "social-lose-next-round", costs: { despair: 1 }, titleKey: "resultSpender.builtins.socialLoseNextRound.title", descriptionKey: "resultSpender.builtins.socialLoseNextRound.description" }
]);

const COMBAT_OPTION_DEFINITIONS = Object.freeze([
  { id: "combat-recover-strain", costs: { advantage: 1, triumph: 1 }, automation: { type: "strain", delta: -1 }, titleKey: "resultSpender.builtins.combatRecoverStrain.title", descriptionKey: "resultSpender.builtins.combatRecoverStrain.description" },
  { id: "combat-next-ally-boost", costs: { advantage: 1, triumph: 1 }, titleKey: "resultSpender.builtins.combatNextAllyBoost.title", descriptionKey: "resultSpender.builtins.combatNextAllyBoost.description" },
  { id: "combat-notice-detail", costs: { advantage: 1, triumph: 1 }, titleKey: "resultSpender.builtins.combatNoticeDetail.title", descriptionKey: "resultSpender.builtins.combatNoticeDetail.description" },
  { id: "combat-critical-injury", costs: { advantage: { cost: 1, variable: true }, triumph: 1 }, titleKey: "resultSpender.builtins.combatCriticalInjury.title", descriptionKey: "resultSpender.builtins.combatCriticalInjury.description" },
  { id: "combat-item-quality", costs: { advantage: { cost: 1, variable: true }, triumph: 1 }, titleKey: "resultSpender.builtins.combatItemQuality.title", descriptionKey: "resultSpender.builtins.combatItemQuality.description" },

  { id: "combat-free-maneuver", costs: { advantage: 2, triumph: 1 }, titleKey: "resultSpender.builtins.combatFreeManeuver.title", descriptionKey: "resultSpender.builtins.combatFreeManeuver.description" },
  { id: "combat-target-boost", costs: { advantage: 2, triumph: 1 }, titleKey: "resultSpender.builtins.combatTargetBoost.title", descriptionKey: "resultSpender.builtins.combatTargetBoost.description" },
  { id: "combat-any-ally-boost", costs: { advantage: 2, triumph: 1 }, titleKey: "resultSpender.builtins.combatAnyAllyBoost.title", descriptionKey: "resultSpender.builtins.combatAnyAllyBoost.description" },

  { id: "combat-negate-defense", costs: { advantage: 3, triumph: 1 }, titleKey: "resultSpender.builtins.combatNegateDefense.title", descriptionKey: "resultSpender.builtins.combatNegateDefense.description" },
  { id: "combat-ignore-environment", costs: { advantage: 3, triumph: 1 }, titleKey: "resultSpender.builtins.combatIgnoreEnvironment.title", descriptionKey: "resultSpender.builtins.combatIgnoreEnvironment.description" },
  { id: "combat-disable-target", costs: { advantage: 3, triumph: 1 }, titleKey: "resultSpender.builtins.combatDisableTarget.title", descriptionKey: "resultSpender.builtins.combatDisableTarget.description" },
  { id: "combat-gain-defense", costs: { advantage: 3, triumph: 1 }, titleKey: "resultSpender.builtins.combatGainDefense.title", descriptionKey: "resultSpender.builtins.combatGainDefense.description" },
  { id: "combat-drop-weapon", costs: { advantage: 3, triumph: 1 }, titleKey: "resultSpender.builtins.combatDropWeapon.title", descriptionKey: "resultSpender.builtins.combatDropWeapon.description" },

  { id: "combat-upgrade-target-difficulty", costs: { triumph: 1 }, titleKey: "resultSpender.builtins.combatUpgradeTargetDifficulty.title", descriptionKey: "resultSpender.builtins.combatUpgradeTargetDifficulty.description" },
  { id: "combat-upgrade-ally-ability", costs: { triumph: 1 }, titleKey: "resultSpender.builtins.combatUpgradeAllyAbility.title", descriptionKey: "resultSpender.builtins.combatUpgradeAllyAbility.description" },
  { id: "combat-do-vital", costs: { triumph: 1 }, titleKey: "resultSpender.builtins.combatDoVital.title", descriptionKey: "resultSpender.builtins.combatDoVital.description" },
  { id: "combat-initiative-maneuver", costs: { triumph: 1 }, titleKey: "resultSpender.builtins.combatInitiativeManeuver.title", descriptionKey: "resultSpender.builtins.combatInitiativeManeuver.description" },
  { id: "combat-destroy-equipment", costs: { triumph: 2 }, titleKey: "resultSpender.builtins.combatDestroyEquipment.title", descriptionKey: "resultSpender.builtins.combatDestroyEquipment.description" },

  { id: "combat-suffer-strain", costs: { threat: { cost: 1, variable: true, scaleAutomation: true }, despair: 1 }, automation: { type: "strain", delta: 1 }, titleKey: "resultSpender.builtins.combatSufferStrain.title", descriptionKey: "resultSpender.builtins.combatSufferStrain.description" },
  { id: "combat-lose-maneuver-benefit", costs: { threat: 1, despair: 1 }, titleKey: "resultSpender.builtins.combatLoseManeuverBenefit.title", descriptionKey: "resultSpender.builtins.combatLoseManeuverBenefit.description" },

  { id: "combat-opponent-free-maneuver", costs: { threat: 2, despair: 1 }, titleKey: "resultSpender.builtins.combatOpponentFreeManeuver.title", descriptionKey: "resultSpender.builtins.combatOpponentFreeManeuver.description" },
  { id: "combat-target-gets-boost", costs: { threat: 2, despair: 1 }, titleKey: "resultSpender.builtins.combatTargetGetsBoost.title", descriptionKey: "resultSpender.builtins.combatTargetGetsBoost.description" },
  { id: "combat-ally-setback", costs: { threat: 2, despair: 1 }, titleKey: "resultSpender.builtins.combatAllySetback.title", descriptionKey: "resultSpender.builtins.combatAllySetback.description" },

  { id: "combat-fall-prone", costs: { threat: 3, despair: 1 }, titleKey: "resultSpender.builtins.combatFallProne.title", descriptionKey: "resultSpender.builtins.combatFallProne.description" },
  { id: "combat-enemy-advantage", costs: { threat: 3, despair: 1 }, titleKey: "resultSpender.builtins.combatEnemyAdvantage.title", descriptionKey: "resultSpender.builtins.combatEnemyAdvantage.description" },

  { id: "combat-out-of-ammo", costs: { despair: 1 }, titleKey: "resultSpender.builtins.combatOutOfAmmo.title", descriptionKey: "resultSpender.builtins.combatOutOfAmmo.description" },
  { id: "combat-upgrade-ally-difficulty", costs: { despair: 1 }, titleKey: "resultSpender.builtins.combatUpgradeAllyDifficulty.title", descriptionKey: "resultSpender.builtins.combatUpgradeAllyDifficulty.description" },
  { id: "combat-damage-weapon-tool", costs: { despair: 1 }, titleKey: "resultSpender.builtins.combatDamageWeaponTool.title", descriptionKey: "resultSpender.builtins.combatDamageWeaponTool.description" }
]);

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ResultSpenderConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-result-spender-config`,
    tag: "form",
    classes: ["gfoe-result-spender-config"],
    position: { width: 780, height: "auto" },
    window: { icon: "fa-solid fa-coins", resizable: true },
    form: {
      closeOnSubmit: false,
      handler: this.#onSubmit
    },
    actions: {
      addCustom: this.#addCustom,
      deleteCustom: this.#deleteCustom,
      clearCustom: this.#clearCustom
    }
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/result-spender-config.hbs`
    }
  };

  constructor(options = {}) {
    super(options);
    this._draft = null;
  }

  get title() {
    return Lang.t("resultSpender.settingsTitle");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const custom = this._draft ?? getCustomOptions();
    return {
      ...context,
      intro: Lang.t("resultSpender.settingsIntro"),
      builtInTitle: Lang.t("resultSpender.builtInTitle"),
      builtInHint: Lang.t("resultSpender.builtInHint"),
      customTitle: Lang.t("resultSpender.customTitle"),
      customHint: Lang.t("resultSpender.customHint"),
      addLabel: Lang.t("resultSpender.addCustom"),
      clearLabel: Lang.t("resultSpender.clearCustom"),
      saveLabel: Lang.t("resultSpender.save"),
      noCustom: Lang.t("resultSpender.noCustom"),
      fieldName: Lang.t("resultSpender.fieldName"),
      fieldResult: Lang.t("resultSpender.fieldResult"),
      fieldCost: Lang.t("resultSpender.fieldCost"),
      fieldDescription: Lang.t("resultSpender.fieldDescription"),
      deleteLabel: Lang.t("resultSpender.delete"),
      symbolAdvantageLabel: symbolLabel("advantage"),
      symbolThreatLabel: symbolLabel("threat"),
      symbolTriumphLabel: symbolLabel("triumph"),
      symbolDespairLabel: symbolLabel("despair"),
      socialBuiltInTitle: Lang.t("resultSpender.socialBuiltInTitle"),
      combatBuiltInTitle: Lang.t("resultSpender.combatBuiltInTitle"),
      socialBuiltIns: getBuiltInOptions("social").map(prepareOptionForTemplate),
      combatBuiltIns: getBuiltInOptions("combat").map(prepareOptionForTemplate),
      customOptions: custom.map(prepareOptionForTemplate)
    };
  }

  static async #addCustom() {
    this._draft = collectCustomOptionsFromForm(this.form, { allowBlankTitle: true });
    this._draft.push({
      id: `custom-${foundry.utils.randomID()}`,
      symbol: "advantage",
      cost: 1,
      title: "",
      description: ""
    });
    await this.render({ force: true });
  }

  static async #deleteCustom(_event, target) {
    const id = target?.dataset?.optionId;
    this._draft = collectCustomOptionsFromForm(this.form, { allowBlankTitle: true })
      .filter(option => option.id !== id);
    await this.render({ force: true });
  }

  static async #clearCustom() {
    this._draft = [];
    await this.render({ force: true });
  }

  static async #onSubmit(_event, form) {
    let custom;
    try {
      custom = collectCustomOptionsFromForm(form, { allowBlankTitle: false });
    } catch (err) {
      ui.notifications?.error(err?.message || Lang.t("resultSpender.invalidCustom"));
      return;
    }

    await game.settings.set(MODULE_ID, CUSTOM_OPTIONS_SETTING, JSON.stringify(custom));
    ui.notifications?.info(Lang.t("resultSpender.settingsSaved"));
    await this.close();
  }
}

export function registerResultSpenderSettings() {
  game.settings.register(MODULE_ID, FEATURE_SETTING, {
    name: game.i18n?.localize?.("settings.enableResultSpenderName") ?? "Enable Spend Results",
    hint: game.i18n?.localize?.("settings.enableResultSpenderHint") ?? "Adds interactive spending of Advantage, Threat, Triumph, and Despair to FFG roll chat messages.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      try {
        if (game.user?.isGM && game.socket) game.socket.emit(`module.${MODULE_ID}`, { type: "reloadAll" });
      } catch (_) {}
      setTimeout(() => { try { window.location.reload(); } catch (_) {} }, 100);
    }
  });

  game.settings.register(MODULE_ID, CUSTOM_OPTIONS_SETTING, {
    name: "Result spender custom options",
    scope: "world",
    config: false,
    type: String,
    default: "[]"
  });

  game.settings.registerMenu(MODULE_ID, "resultSpenderOptions", {
    name: game.i18n?.localize?.("settings.resultSpenderMenuName") ?? "Spend Results options",
    label: game.i18n?.localize?.("settings.resultSpenderMenuLabel") ?? "Configure Spend Results",
    hint: game.i18n?.localize?.("settings.resultSpenderMenuHint") ?? "Add custom ways to spend narrative dice results and define their costs.",
    icon: "fa-solid fa-coins",
    type: ResultSpenderConfig,
    restricted: true
  });
}

export function registerResultSpenderFeature() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  Hooks.on("renderChatMessageHTML", (message, html) => {
    try {
      renderRemainingResults(message, html);
    } catch (err) {
      console.warn(`${MODULE_ID} | result-spender | failed to render remaining results`, err);
    }
  });

  // Use a single delegated listener instead of attaching a click handler to each
  // freshly-rendered chat button. Foundry may replace chat message DOM nodes when
  // messages are updated, which would otherwise discard direct listeners.
  document.addEventListener("click", onSpendResultsButtonClick, true);
}

async function onSpendResultsButtonClick(event) {
  const button = event.target?.closest?.(".gfoe-open-result-spender");
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();

  const messageId = button.dataset?.messageId
    || button.closest?.("[data-message-id]")?.dataset?.messageId
    || button.closest?.("[data-document-id]")?.dataset?.documentId
    || button.closest?.("[data-entry-id]")?.dataset?.entryId;

  const message = messageId ? game.messages?.get(messageId) : null;
  if (!message) {
    console.warn(`${MODULE_ID} | result-spender | could not resolve chat message for Spend Results button`, { messageId });
    ui.notifications?.warn(Lang.t("resultSpender.notSpendable"));
    return;
  }

  try {
    await openSpendDialog(message);
  } catch (err) {
    console.error(`${MODULE_ID} | result-spender | failed to open Spend Results dialog`, err);
    ui.notifications?.error(err?.message || Lang.t("resultSpender.failed"));
  }
}

export async function handleResultSpenderSocket(payload) {
  if (!payload?.type) return false;

  if (payload.type === MSG.SPEND_REQUEST) {
    if (isPrimaryGM()) await processSpendRequest(payload);
    return true;
  }

  if (payload.type === MSG.FEEDBACK) {
    if (payload.toUserId === game.user?.id && payload.message) {
      const method = payload.level === "error" ? "error" : payload.level === "warn" ? "warn" : "info";
      ui.notifications?.[method]?.(payload.message);
    }
    return true;
  }

  return false;
}

function isEnabled() {
  try {
    return game.settings.get(MODULE_ID, FEATURE_SETTING);
  } catch (_) {
    return true;
  }
}

function expandBuiltInDefinitions(definitions, context) {
  return definitions.flatMap(definition => Object.entries(definition.costs).map(([symbol, costSpec]) => {
    const normalized = typeof costSpec === "object" && costSpec !== null
      ? costSpec
      : { cost: costSpec };
    return {
      id: `${definition.id}-${symbol}`,
      symbol,
      cost: safeNonNegativeInt(normalized.cost, 1) || 1,
      variableCost: Boolean(normalized.variable),
      scaleAutomation: Boolean(normalized.scaleAutomation),
      title: Lang.t(definition.titleKey),
      description: Lang.t(definition.descriptionKey),
      builtin: true,
      context,
      automation: definition.automation ? cloneData(definition.automation) : null
    };
  }));
}

function getBuiltInOptions(context = getSpendingContext()) {
  if (context === "combat") return expandBuiltInDefinitions(COMBAT_OPTION_DEFINITIONS, "combat");
  return expandBuiltInDefinitions(SOCIAL_OPTION_DEFINITIONS, "social");
}

function getSpendingContext() {
  return isActiveCombatOnActiveScene() ? "combat" : "social";
}

function isActiveCombatOnActiveScene() {
  const combat = game.combat;
  if (!combat) return false;

  const activeSceneId = globalThis.canvas?.scene?.id ?? game.scenes?.current?.id ?? null;
  const sceneRef = combat.scene;
  const combatSceneId = typeof sceneRef === "string"
    ? sceneRef
    : sceneRef?.id ?? combat?._source?.scene ?? null;

  if (activeSceneId && combatSceneId && activeSceneId !== combatSceneId) return false;

  // A combat merely created in the tracker is not treated as an active combat
  // encounter until it has actually started.
  return combat.started === true || safeNonNegativeInt(combat.round, 0) > 0;
}

function getCustomOptions() {
  let raw = "[]";
  try {
    raw = game.settings.get(MODULE_ID, CUSTOM_OPTIONS_SETTING) || "[]";
  } catch (_) {}

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeCustomOption).filter(Boolean);
  } catch (err) {
    console.warn(`${MODULE_ID} | result-spender | invalid custom options JSON`, err);
    return [];
  }
}

function getAllOptions() {
  return [...getBuiltInOptions(), ...getCustomOptions()];
}

function sanitizeCustomOption(option) {
  if (!option || typeof option !== "object") return null;
  const symbol = SYMBOLS.includes(option.symbol) ? option.symbol : null;
  const cost = Number.parseInt(option.cost, 10);
  const title = String(option.title ?? "").trim();
  const description = String(option.description ?? "").trim();
  if (!symbol || !Number.isSafeInteger(cost) || cost < 1 || cost > 99 || !title) return null;
  return {
    id: String(option.id || `custom-${foundry.utils.randomID()}`),
    symbol,
    cost,
    title,
    description,
    builtin: false
  };
}

function prepareOptionForTemplate(option) {
  return {
    ...option,
    symbolLabel: symbolLabel(option.symbol),
    symbolShort: symbolShort(option.symbol),
    isAdvantage: option.symbol === "advantage",
    isThreat: option.symbol === "threat",
    isTriumph: option.symbol === "triumph",
    isDespair: option.symbol === "despair"
  };
}

function collectCustomOptionsFromForm(form, { allowBlankTitle = false } = {}) {
  if (!form) return [];
  const rows = [...form.querySelectorAll("[data-gfoe-custom-option]")];
  return rows.map(row => {
    const id = String(row.dataset.optionId || `custom-${foundry.utils.randomID()}`);
    const title = String(row.querySelector('[name="title"]')?.value ?? "").trim();
    const symbol = String(row.querySelector('[name="symbol"]')?.value ?? "advantage");
    const cost = Number.parseInt(row.querySelector('[name="cost"]')?.value ?? "1", 10);
    const description = String(row.querySelector('[name="description"]')?.value ?? "").trim();

    if (!allowBlankTitle && !title) throw new Error(Lang.t("resultSpender.nameRequired"));
    if (!SYMBOLS.includes(symbol)) throw new Error(Lang.t("resultSpender.invalidCustom"));
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > 99) throw new Error(Lang.t("resultSpender.invalidCost"));

    return { id, title, symbol, cost, description };
  });
}

function getMessageAuthorId(message) {
  return message?.author?.id ?? message?.user?.id ?? (typeof message?.user === "string" ? message.user : null);
}

function canUserSpendFromMessage(user, message) {
  if (!user || !message) return false;
  if (user.isGM) return true;
  if (getMessageAuthorId(message) === user.id) return true;

  const actorId = message.speaker?.actor;
  const actor = actorId ? game.actors?.get(actorId) : null;
  try {
    return Boolean(actor?.testUserPermission?.(user, "OWNER"));
  } catch (_) {
    return false;
  }
}

function extractRollResults(message) {
  const rolls = Array.isArray(message?.rolls) ? message.rolls : Array.from(message?.rolls ?? []);
  const roll = rolls.find(candidate => candidate?.ffg && typeof candidate.ffg === "object");
  const ffg = roll?.ffg;
  if (!ffg) return emptyResults();

  return {
    advantage: readResultCount(ffg, ["advantage", "advantages", "adv"]),
    threat: readResultCount(ffg, ["threat", "threats"]),
    triumph: readResultCount(ffg, ["triumph", "triumphs"]),
    despair: readResultCount(ffg, ["despair", "despairs"])
  };
}

function readResultCount(source, keys) {
  for (const key of keys) {
    if (!(key in source)) continue;
    const value = Number(source[key]);
    if (Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  }
  return 0;
}

function emptyResults() {
  return { advantage: 0, threat: 0, triumph: 0, despair: 0 };
}

function hasAny(results) {
  return SYMBOLS.some(symbol => Number(results?.[symbol] ?? 0) > 0);
}

function normalizeState(message, originalFromRoll = extractRollResults(message)) {
  const flag = message?.getFlag?.(MODULE_ID, FLAG_KEY);
  const original = {
    advantage: safeNonNegativeInt(flag?.original?.advantage, originalFromRoll.advantage),
    threat: safeNonNegativeInt(flag?.original?.threat, originalFromRoll.threat),
    triumph: safeNonNegativeInt(flag?.original?.triumph, originalFromRoll.triumph),
    despair: safeNonNegativeInt(flag?.original?.despair, originalFromRoll.despair)
  };
  const spent = {
    advantage: Math.min(original.advantage, safeNonNegativeInt(flag?.spent?.advantage, 0)),
    threat: Math.min(original.threat, safeNonNegativeInt(flag?.spent?.threat, 0)),
    triumph: Math.min(original.triumph, safeNonNegativeInt(flag?.spent?.triumph, 0)),
    despair: Math.min(original.despair, safeNonNegativeInt(flag?.spent?.despair, 0))
  };
  const history = Array.isArray(flag?.history) ? flag.history.slice(-MAX_HISTORY) : [];
  return { version: 1, original, spent, history };
}

function getRemainingResults(message, originalFromRoll = extractRollResults(message)) {
  const state = normalizeState(message, originalFromRoll);
  return {
    advantage: Math.max(0, state.original.advantage - state.spent.advantage),
    threat: Math.max(0, state.original.threat - state.spent.threat),
    triumph: Math.max(0, state.original.triumph - state.spent.triumph),
    despair: Math.max(0, state.original.despair - state.spent.despair)
  };
}

function safeNonNegativeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.trunc(Number(fallback) || 0));
  return Math.max(0, Math.trunc(n));
}

function renderRemainingResults(message, html) {
  if (!isEnabled()) return;
  const original = extractRollResults(message);
  if (!hasAny(original)) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".gfoe-results-remaining")) return;

  const remaining = getRemainingResults(message, original);
  const spent = normalizeState(message, original).spent;
  const target = root.querySelector(".message-content") ?? root;
  const panel = document.createElement("div");
  panel.className = "gfoe-results-remaining";
  const canSpendHere = canUserSpendFromMessage(game.user, message) && (
    game.user?.isGM
      ? hasAny(remaining)
      : remaining.advantage > 0 || remaining.triumph > 0
  );

  panel.innerHTML = `
    <div class="gfoe-results-remaining-title"><i class="fa-solid fa-coins"></i> ${escapeHtml(Lang.t("resultSpender.remaining"))}</div>
    <div class="gfoe-result-badges">${renderResultBadges(remaining)}</div>
    ${hasAny(spent) ? `<div class="gfoe-results-spent-summary">${escapeHtml(Lang.t("resultSpender.spentSoFar"))}: ${renderResultBadges(spent, { compact: true })}</div>` : ""}
    ${canSpendHere ? `<button type="button" class="gfoe-open-result-spender" data-message-id="${escapeHtml(message.id)}"><i class="fa-solid fa-coins"></i> ${escapeHtml(Lang.t("resultSpender.contextLabel"))}</button>` : ""}
  `;

  target.appendChild(panel);
}

function renderResultBadges(results, { compact = false } = {}) {
  return SYMBOLS.map(symbol => {
    const value = safeNonNegativeInt(results?.[symbol], 0);
    return `<span class="gfoe-result-badge gfoe-result-${symbol}" title="${escapeHtml(symbolLabel(symbol))}"><b>${escapeHtml(symbolShort(symbol))}</b>${compact ? " " : " × "}${value}</span>`;
  }).join("");
}

async function openSpendDialog(message) {
  if (!isEnabled()) return;
  const original = extractRollResults(message);
  if (!hasAny(original)) return ui.notifications?.warn(Lang.t("resultSpender.notSpendable"));
  if (!canUserSpendFromMessage(game.user, message)) return ui.notifications?.warn(Lang.t("resultSpender.noPermission"));

  const remaining = getRemainingResults(message, original);
  const spendingContext = getSpendingContext();
  const allowedSymbols = game.user?.isGM ? new Set(SYMBOLS) : POSITIVE_SYMBOLS;
  const options = getAllOptions()
    .filter(option => allowedSymbols.has(option.symbol))
    .sort((a, b) => SYMBOLS.indexOf(a.symbol) - SYMBOLS.indexOf(b.symbol) || a.cost - b.cost || a.title.localeCompare(b.title));

  if (!options.length) return ui.notifications?.warn(Lang.t("resultSpender.noOptions"));

  const grouped = SYMBOLS
    .filter(symbol => allowedSymbols.has(symbol))
    .map(symbol => ({ symbol, options: options.filter(option => option.symbol === symbol) }))
    .filter(group => group.options.length);

  const groupsHtml = grouped.map(group => {
    const rows = group.options.map(option => {
      const affordable = remaining[option.symbol] >= option.cost;
      const costControl = option.variableCost && affordable
        ? `<div class="gfoe-variable-spend-cost" data-gfoe-variable-cost data-min="${option.cost}" data-max="${remaining[option.symbol]}">
            <button type="button" data-gfoe-cost-step="-1" disabled aria-label="${escapeHtml(Lang.t("resultSpender.decreaseCost"))}">−</button>
            <span data-gfoe-variable-value data-value="${option.cost}">${option.cost}</span>
            <button type="button" data-gfoe-cost-step="1" ${remaining[option.symbol] <= option.cost ? "disabled" : ""} aria-label="${escapeHtml(Lang.t("resultSpender.increaseCost"))}">+</button>
            <span>× ${escapeHtml(symbolShort(option.symbol))}</span>
          </div>`
        : `<span class="gfoe-result-badge gfoe-result-${option.symbol}">${option.cost}${option.variableCost ? "+" : ""} × ${escapeHtml(symbolShort(option.symbol))}</span>`;
      return `
        <div class="gfoe-spend-option ${affordable ? "" : "is-unaffordable"}">
          <div class="gfoe-spend-option-main">
            <div class="gfoe-spend-option-title">${escapeHtml(option.title)}</div>
            ${option.description ? `<div class="gfoe-spend-option-description">${escapeHtml(option.description)}</div>` : ""}
          </div>
          <div class="gfoe-spend-option-actions">
            ${costControl}
            <button type="button" data-gfoe-spend-option="${escapeHtml(option.id)}" ${affordable ? "" : "disabled"}>${escapeHtml(Lang.t("resultSpender.spend"))}</button>
          </div>
        </div>`;
    }).join("");
    return `
      <section class="gfoe-spend-group">
        <h3>${escapeHtml(symbolLabel(group.symbol))} <span class="gfoe-spend-group-remaining">${escapeHtml(Lang.t("resultSpender.availableNow", { count: remaining[group.symbol] }))}</span></h3>
        ${rows}
      </section>`;
  }).join("");

  const content = `
    <div class="gfoe-spend-results-dialog">
      <div class="gfoe-spend-current">
        <div><b>${escapeHtml(Lang.t("resultSpender.remaining"))}</b></div>
        <div class="gfoe-result-badges">${renderResultBadges(remaining)}</div>
        <div class="notes"><b>${escapeHtml(Lang.t("resultSpender.encounterContext"))}:</b> ${escapeHtml(Lang.t(`resultSpender.contexts.${spendingContext}`))}</div>
      </div>
      ${!game.user?.isGM ? `<p class="notes">${escapeHtml(Lang.t("resultSpender.playerRestriction"))}</p>` : ""}
      <div class="gfoe-spend-groups">${groupsHtml}</div>
    </div>`;

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) throw new Error("Foundry DialogV2 API is unavailable.");

  // Passing an HTMLElement avoids HTML sanitization altering our data attributes.
  const dialogContent = document.createElement("div");
  dialogContent.innerHTML = content;

  await DialogV2.wait({
    window: {
      title: Lang.t("resultSpender.dialogTitle"),
      icon: "fa-solid fa-coins"
    },
    position: { width: 660, height: "auto" },
    content: dialogContent,
    modal: false,
    rejectClose: false,
    buttons: [{
      action: "close",
      label: Lang.t("common.close"),
      icon: "fa-solid fa-xmark"
    }],
    render: (_event, app) => {
      const root = app.element;

      root?.querySelectorAll?.("[data-gfoe-cost-step]").forEach(button => {
        button.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();

          const control = event.currentTarget?.closest?.("[data-gfoe-variable-cost]");
          const valueNode = control?.querySelector?.("[data-gfoe-variable-value]");
          if (!control || !valueNode) return;

          const min = Math.max(1, Number.parseInt(control.dataset.min ?? "1", 10) || 1);
          const max = Math.max(min, Number.parseInt(control.dataset.max ?? String(min), 10) || min);
          const delta = Number.parseInt(event.currentTarget?.dataset?.gfoeCostStep ?? "0", 10) || 0;
          const current = Math.max(min, Math.min(max, Number.parseInt(valueNode.dataset.value ?? String(min), 10) || min));
          const next = Math.max(min, Math.min(max, current + delta));

          valueNode.dataset.value = String(next);
          valueNode.textContent = String(next);
          const minus = control.querySelector('[data-gfoe-cost-step="-1"]');
          const plus = control.querySelector('[data-gfoe-cost-step="1"]');
          if (minus) minus.disabled = next <= min;
          if (plus) plus.disabled = next >= max;
        });
      });

      root?.querySelectorAll?.("[data-gfoe-spend-option]").forEach(button => {
        button.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();

          const optionId = event.currentTarget?.dataset?.gfoeSpendOption;
          if (!optionId) return;

          const optionRow = event.currentTarget?.closest?.(".gfoe-spend-option");
          const variableValue = optionRow?.querySelector?.("[data-gfoe-variable-value]");
          const requestedCost = variableValue
            ? Number.parseInt(variableValue.dataset.value ?? variableValue.textContent ?? "", 10)
            : null;

          event.currentTarget.disabled = true;
          try {
            await requestSpend(message.id, optionId, requestedCost);
            await app.close();
          } catch (err) {
            event.currentTarget.disabled = false;
            console.error(`${MODULE_ID} | result-spender | spend request failed`, err);
            ui.notifications?.error(err?.message || Lang.t("resultSpender.failed"));
          }
        });
      });
    }
  });
}

async function requestSpend(messageId, optionId, requestedCost = null) {
  const primaryGM = getPrimaryGM();
  if (!primaryGM) {
    ui.notifications?.error(Lang.t("resultSpender.noGM"));
    return;
  }

  const payload = {
    type: MSG.SPEND_REQUEST,
    requestId: foundry.utils.randomID(),
    messageId,
    optionId,
    requestedCost,
    requestingUserId: game.user.id
  };

  if (game.user.isGM && primaryGM.id === game.user.id) {
    await processSpendRequest(payload);
  } else {
    game.socket.emit(`module.${MODULE_ID}`, payload);
  }
}

async function processSpendRequest(payload) {
  const requester = game.users?.get(payload.requestingUserId);
  const message = game.messages?.get(payload.messageId);
  if (!requester || !message) return;

  const feedback = async (text, level = "warn") => {
    if (requester.id === game.user.id) ui.notifications?.[level]?.(text);
    else game.socket.emit(`module.${MODULE_ID}`, { type: MSG.FEEDBACK, toUserId: requester.id, message: text, level });
  };

  if (!isEnabled()) return feedback(Lang.t("resultSpender.disabled"));
  if (!canUserSpendFromMessage(requester, message)) return feedback(Lang.t("resultSpender.noPermission"));

  const option = getAllOptions().find(entry => entry.id === payload.optionId);
  if (!option) return feedback(Lang.t("resultSpender.optionMissing"));
  if (!requester.isGM && NEGATIVE_SYMBOLS.has(option.symbol)) return feedback(Lang.t("resultSpender.gmOnlyNegative"));
  if (!requester.isGM && !POSITIVE_SYMBOLS.has(option.symbol)) return feedback(Lang.t("resultSpender.noPermission"));

  const requestedCost = Number.parseInt(payload.requestedCost, 10);
  const spendCost = option.variableCost
    ? requestedCost
    : option.cost;
  if (!Number.isSafeInteger(spendCost) || spendCost < option.cost) {
    return feedback(Lang.t("resultSpender.invalidVariableCost"));
  }

  if (spendLocks.has(message.id)) return feedback(Lang.t("resultSpender.busy"));
  spendLocks.add(message.id);

  try {
    const originalFromRoll = extractRollResults(message);
    if (!hasAny(originalFromRoll)) return feedback(Lang.t("resultSpender.notSpendable"));

    const previousFlag = cloneData(message.getFlag(MODULE_ID, FLAG_KEY));
    const state = normalizeState(message, originalFromRoll);
    const remaining = getRemainingFromState(state);
    if (remaining[option.symbol] < spendCost) {
      return feedback(Lang.t("resultSpender.notEnough", {
        symbol: symbolLabel(option.symbol),
        needed: spendCost,
        remaining: remaining[option.symbol]
      }));
    }

    state.spent[option.symbol] += spendCost;
    const after = getRemainingFromState(state);
    state.history.push({
      id: foundry.utils.randomID(),
      at: Date.now(),
      byUserId: requester.id,
      optionId: option.id,
      optionTitle: option.title,
      symbol: option.symbol,
      cost: spendCost
    });
    state.history = state.history.slice(-MAX_HISTORY);

    let flagWritten = false;
    let automationResult = null;

    try {
      await message.setFlag(MODULE_ID, FLAG_KEY, state);
      flagWritten = true;

      automationResult = await applyOptionAutomation(message, { ...option, cost: spendCost });
      await postSpendChatMessage(message, requester, { ...option, cost: spendCost }, after, automationResult);
    } catch (err) {
      if (automationResult) {
        try {
          await rollbackOptionAutomation(automationResult);
        } catch (rollbackErr) {
          console.error(`${MODULE_ID} | result-spender | failed to rollback automated effect`, rollbackErr);
        }
      }

      if (flagWritten) {
        try {
          if (previousFlag == null) await message.unsetFlag(MODULE_ID, FLAG_KEY);
          else await message.setFlag(MODULE_ID, FLAG_KEY, previousFlag);
        } catch (rollbackErr) {
          console.error(`${MODULE_ID} | result-spender | failed to rollback result spending`, rollbackErr);
        }
      }
      throw err;
    }
  } catch (err) {
    console.error(`${MODULE_ID} | result-spender | spending failed`, err);
    await feedback(Lang.t("resultSpender.failed"), "error");
  } finally {
    spendLocks.delete(message.id);
  }
}

function resolveRollActor(message) {
  const speaker = message?.speaker ?? {};
  const sceneId = typeof speaker.scene === "string" ? speaker.scene : speaker.scene?.id;
  const tokenId = typeof speaker.token === "string" ? speaker.token : speaker.token?.id;

  if (sceneId && tokenId) {
    const scene = game.scenes?.get(sceneId);
    const tokenDocument = scene?.tokens?.get(tokenId);
    if (tokenDocument?.actor) return tokenDocument.actor;
  }

  if (tokenId) {
    const token = globalThis.canvas?.tokens?.get?.(tokenId);
    if (token?.actor) return token.actor;
  }

  const actorId = typeof speaker.actor === "string" ? speaker.actor : speaker.actor?.id;
  if (actorId) return game.actors?.get(actorId) ?? null;

  return null;
}

async function applyOptionAutomation(message, option) {
  const automation = option?.automation;
  if (!automation) return null;
  if (automation.type !== "strain") return null;

  const actor = resolveRollActor(message);
  if (!actor) throw new Error(Lang.t("resultSpender.automation.actorMissing"));

  const strain = actor.system?.stats?.strain;
  if (!strain || strain.value == null) {
    throw new Error(Lang.t("resultSpender.automation.strainUnavailable", { actor: actor.name || "Actor" }));
  }

  const current = safeNonNegativeInt(strain.value, 0);
  const baseDelta = Number(automation.delta);
  if (!Number.isFinite(baseDelta) || baseDelta === 0) return null;

  // Suffer Strain paid with Threat can spend several Threat at once. Each
  // Threat spent applies one point of Strain. Other strain effects (including
  // recovery and the Despair alternative) remain fixed at their base value.
  const multiplier = option?.scaleAutomation
    ? Math.max(1, safeNonNegativeInt(option?.cost, 1))
    : 1;
  const delta = Math.trunc(baseDelta) * multiplier;

  // Recovering strain may never reduce the current value below 0. Suffering
  // strain is intentionally not clamped to the threshold; exceeding the
  // threshold is meaningful in Genesys/Star Wars FFG.
  const next = delta < 0
    ? Math.max(0, current + delta)
    : current + delta;

  await actor.update({ "system.stats.strain.value": next });

  return {
    type: "strain",
    actor,
    actorName: actor.name || "Actor",
    previousValue: current,
    newValue: next
  };
}

async function rollbackOptionAutomation(result) {
  if (!result || result.type !== "strain" || !result.actor) return;
  await result.actor.update({ "system.stats.strain.value": result.previousValue });
}

function getRemainingFromState(state) {
  return {
    advantage: Math.max(0, state.original.advantage - state.spent.advantage),
    threat: Math.max(0, state.original.threat - state.spent.threat),
    triumph: Math.max(0, state.original.triumph - state.spent.triumph),
    despair: Math.max(0, state.original.despair - state.spent.despair)
  };
}

async function postSpendChatMessage(sourceMessage, requester, option, remaining, automationResult = null) {
  const sourceAlias = sourceMessage.speaker?.alias || sourceMessage.author?.name || Lang.t("resultSpender.roll");
  const content = `
    <div class="gfoe-spend-chat-card">
      <div class="gfoe-spend-chat-title"><i class="fa-solid fa-coins"></i> ${escapeHtml(Lang.t("resultSpender.chatTitle"))}</div>
      <div class="gfoe-spend-chat-line">${Lang.t("resultSpender.chatSpent", {
        user: `<b>${escapeHtml(requester.name)}</b>`,
        cost: `<span class="gfoe-result-badge gfoe-result-${option.symbol}">${option.cost} × ${escapeHtml(symbolLabel(option.symbol))}</span>`,
        option: `<b>${escapeHtml(option.title)}</b>`,
        roll: `<b>${escapeHtml(sourceAlias)}</b>`
      })}</div>
      ${option.description ? `<div class="gfoe-spend-chat-description">${escapeHtml(option.description)}</div>` : ""}
      ${automationResult?.type === "strain" ? `<div class="gfoe-spend-chat-description"><i class="fa-solid fa-bolt"></i> ${escapeHtml(Lang.t("resultSpender.automation.strainApplied", { actor: automationResult.actorName, before: automationResult.previousValue, after: automationResult.newValue }))}</div>` : ""}
      <div class="gfoe-spend-chat-remaining"><b>${escapeHtml(Lang.t("resultSpender.remaining"))}:</b> ${renderResultBadges(remaining, { compact: true })}</div>
    </div>`;

  const data = {
    content,
    speaker: { alias: requester.name },
    flags: {
      [MODULE_ID]: {
        resultSpendAnnouncement: {
          sourceMessageId: sourceMessage.id,
          optionId: option.id,
          symbol: option.symbol,
          cost: option.cost,
          byUserId: requester.id
        }
      }
    }
  };

  const whisper = Array.isArray(sourceMessage.whisper)
    ? sourceMessage.whisper.map(user => typeof user === "string" ? user : user?.id).filter(Boolean)
    : [];
  if (whisper.length) data.whisper = whisper;
  if (sourceMessage.blind) data.blind = true;

  await ChatMessage.create(data);
}

function getPrimaryGM() {
  return game.users
    ?.filter(user => user.active && user.isGM)
    ?.sort((a, b) => String(a.id).localeCompare(String(b.id)))?.[0] ?? null;
}

function isPrimaryGM() {
  return Boolean(game.user?.isGM && getPrimaryGM()?.id === game.user.id);
}

function symbolLabel(symbol) {
  return Lang.t(`resultSpender.symbols.${symbol}`);
}

function symbolShort(symbol) {
  return Lang.t(`resultSpender.symbolShort.${symbol}`);
}

function cloneData(value) {
  if (value == null) return value;
  try {
    return foundry.utils.deepClone(value);
  } catch (_) {
    return JSON.parse(JSON.stringify(value));
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
