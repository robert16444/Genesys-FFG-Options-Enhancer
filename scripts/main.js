import { GFOECurrency, GFOECurrencyApp, registerCurrencyUIHook, registerCurrencySocket, registerCurrencyAutoRefresh } from './currency.js';
import { RollRequestApp } from "./request-app.js";
import { Lang } from "./i18n.js";
import { registerItemTransferFeature, handleItemTransferSocket } from "./item-transfer.js";
import { openTalentSearch } from "./talent-search.js";
import { registerResultSpenderSettings, registerResultSpenderFeature, handleResultSpenderSocket } from "./result-spender.js";
import { registerVisionStatusEffects, registerGuardedStanceAutomation } from "./status-effects.js";
import {
  registerNextCheckRollAutomation,
  registerPendingNextAllySlotAutomation,
  registerNextCheckStatusCounterIntegration,
  applyNextCheckDifficultyUpgradeToPool
} from "./next-check-effects.js";
import { openCharacterPilot, initializeCharacterPilot, handleCharacterPilotSocket } from "./character-pilot.js";
import { initializePopOutCompatibility } from "./popout-compat.js";

const MODULE_ID = "genesys-ffg-options-enhancer";
const DEBUG = false;
function dbg(...args) {
  if (DEBUG) console.debug(`${MODULE_ID} |`, ...args);
}

function isFeatureEnabled(key, fallback = true) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch (_) {
    return fallback;
  }
}

Hooks.once("init", () => {
  try { initializePopOutCompatibility(); } catch (e) { console.warn(`${MODULE_ID} | PopOut compatibility initialization failed`, e); }
  try { registerResultSpenderSettings(); } catch (e) { console.error(`${MODULE_ID} | result spender settings registration failed`, e); }
  // Register Spend Results chat rendering during init so roll messages get the
  // remaining-results panel and its direct Spend Results button.
  try { registerResultSpenderFeature(); } catch (e) { console.error(`${MODULE_ID} | result spender registration failed`, e); }

  try {
    game.settings.register(MODULE_ID, "activationCostLabel", {
      name: game.i18n?.localize?.("settings.activationCostLabelName") ?? "Activation cost label",
      hint: game.i18n?.localize?.("settings.activationCostLabelHint") ?? "Text in a spell description that enables the Cast button (default). Case-insensitive.",
      scope: "world",
      config: true,
      type: String,
      default: "Koszt aktywacji"
    });
    game.settings.register(MODULE_ID, "enableCurrency", {
      name: game.i18n?.localize?.("settings.enableCurrencyName") ?? "Enable currency manager",
      hint: game.i18n?.localize?.("settings.enableCurrencyHint") ?? "If unchecked, currency UI and hooks are disabled.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: (v) => { try { if (game.user?.isGM && game.socket) game.socket.emit(`module.${MODULE_ID}`, { type: "reloadAll" }); } catch (_) {} setTimeout(() => { try { window.location.reload(); } catch(e) {} }, 100); }
    });
    game.settings.register(MODULE_ID, "enableItemSend", {
      name: game.i18n?.localize?.("settings.enableItemSendName") ?? "Enable item transfer",
      hint: game.i18n?.localize?.("settings.enableItemSendHint") ?? "If unchecked, sending items between actors is disabled.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: (v) => { try { if (game.user?.isGM && game.socket) game.socket.emit(`module.${MODULE_ID}`, { type: "reloadAll" }); } catch (_) {} setTimeout(() => { try { window.location.reload(); } catch(e) {} }, 100); }
    });
    game.settings.register(MODULE_ID, "enableTalentSearch", {
      name: game.i18n?.localize?.("settings.enableTalentSearchName") ?? "Enable talent/spell search",
      hint: game.i18n?.localize?.("settings.enableTalentSearchHint") ?? "If unchecked, the Talent Search tool is hidden and disabled.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: (v) => { try { if (game.user?.isGM && game.socket) game.socket.emit(`module.${MODULE_ID}`, { type: "reloadAll" }); } catch (_) {} setTimeout(() => { try { window.location.reload(); } catch(e) {} }, 100); }
    });
    game.settings.register(MODULE_ID, "enableRequestRolls", {
      name: game.i18n?.localize?.("settings.enableRequestRollsName") ?? "Enable roll requests",
      hint: game.i18n?.localize?.("settings.enableRequestRollsHint") ?? "If unchecked, the Request a Roll tool is hidden and disabled.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: (v) => { try { if (game.user?.isGM && game.socket) game.socket.emit(`module.${MODULE_ID}`, { type: "reloadAll" }); } catch (_) {} setTimeout(() => { try { window.location.reload(); } catch(e) {} }, 100); }
    });
    game.settings.register(MODULE_ID, "enableCharacterPilot", {
      name: game.i18n?.localize?.("settings.enableCharacterPilotName") ?? "Enable Character Pilot",
      hint: game.i18n?.localize?.("settings.enableCharacterPilotHint") ?? "Show the Character Pilot automation tool in Scene Controls.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => { try { if (game.user?.isGM && game.socket) game.socket.emit(`module.${MODULE_ID}`, { type: "reloadAll" }); } catch (_) {} setTimeout(() => { try { window.location.reload(); } catch(e) {} }, 100); }
    });
  } catch (e) { console.error(MODULE_ID, e); }

  dbg("init");

  Hooks.on("getSceneControlButtons", (controls) => {
    const tokenControls = resolveTokenControls(controls);
    if (!tokenControls) return;

    const tools = ensureSceneControlToolsContainer(tokenControls);
    if (!tools) return;

    const addTool = (tool) => {
      const exists = Array.isArray(tools)
        ? tools.some(t => t?.name === tool.name)
        : Object.values(tools).some(t => t?.name === tool.name);
      if (exists) return;

      if (Array.isArray(tools)) tools.push(tool);
      else {
        tool.order ??= Object.keys(tools).length;
        tools[tool.name] = tool;
      }
    };

    if (game.user?.isGM && isFeatureEnabled("enableRequestRolls", true)) {
      addTool({
        name: "grr-request-roll",
        title: Lang.t("request.title"),
        icon: "fas fa-dice",
        button: true,
        visible: true,
        onClick: () => new RollRequestApp().render(true)
      });
    }

    if (isFeatureEnabled("enableTalentSearch", true)) addTool({
      name: "grr-talent-search",
      title: Lang.t("controls.talentSearch"),
      icon: "fas fa-magnifying-glass",
      button: true,
      visible: true,
      onClick: () => openTalentSearch()
    });

    if (isFeatureEnabled("enableCharacterPilot", true)) addTool({
      name: "gfoe-character-pilot",
      title: Lang.t("pilot.title"),
      icon: "fas fa-gamepad",
      button: true,
      visible: true,
      onClick: () => openCharacterPilot()
    });
  });
});


Hooks.once("setup", () => {
  try {
    registerVisionStatusEffects();
  } catch (e) {
    console.error(`${MODULE_ID} | vision status effects registration failed`, e);
  }
  try {
    registerGuardedStanceAutomation();
  } catch (e) {
    console.error(`${MODULE_ID} | guarded stance automation registration failed`, e);
  }
});

Hooks.once("ready", async () => {
  dbg("ready", { user: game.user?.name, id: game.user?.id, isGM: game.user?.isGM });

  try { registerVisionStatusEffects(); } catch (e) { console.error(`${MODULE_ID} | vision status effects refresh failed`, e); }
  try { registerGuardedStanceAutomation(); } catch (e) { console.error(`${MODULE_ID} | guarded stance automation refresh failed`, e); }
  if (isFeatureEnabled("enableCharacterPilot", true)) {
    try { initializeCharacterPilot(); } catch (e) { console.error(`${MODULE_ID} | character pilot registration failed`, e); }
  }
  try { registerNextCheckStatusCounterIntegration(); } catch (e) { console.error(`${MODULE_ID} | Status Counter integration registration failed`, e); }
  try { registerNextCheckRollAutomation(); } catch (e) { console.error(`${MODULE_ID} | next-check roll automation registration failed`, e); }
  if (isFeatureEnabled("enableResultSpender", true)) {
    try { registerPendingNextAllySlotAutomation(); } catch (e) { console.error(`${MODULE_ID} | pending next-ally slot automation registration failed`, e); }
  }

  if (isFeatureEnabled("enableItemSend", true)) {
    try { registerItemTransferFeature(); } catch (e) { console.error(`${MODULE_ID} | item transfer registration failed`, e); }
  }
  if (isFeatureEnabled("enableCurrency", true)) {
    try { registerCurrencySocket(); } catch (e) { console.error(`${MODULE_ID} | currency socket registration failed`, e); }
    try { registerCurrencyAutoRefresh(); } catch (e) { console.error(`${MODULE_ID} | currency auto-refresh registration failed`, e); }
  }

  game.socket.on(`module.${MODULE_ID}`, async (payload) => {
    try {
      dbg("socket received", payload);
      if (!payload?.type) return;

      if (payload.type === "reloadAll") {
        setTimeout(() => { try { window.location.reload(); } catch (_) {} }, 50);
        return;
      }

      if (payload.type === "ROLL_REQUEST") {
        if (!isFeatureEnabled("enableRequestRolls", true)) return;
        if (payload.toUser && payload.toUser !== game.user.id) return;
        await showPlayerPopup(payload);
        return;
      }

      if (isFeatureEnabled("enableResultSpender", true)) {
        const handled = await handleResultSpenderSocket(payload);
        if (handled) return;
      }

      if (isFeatureEnabled("enableCharacterPilot", true)) {
        const handledByPilot = await handleCharacterPilotSocket(payload);
        if (handledByPilot) return;
      }

      if (isFeatureEnabled("enableItemSend", true)) {
        await handleItemTransferSocket(payload);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | socket handler error`, err);
      ui.notifications?.error(`${MODULE_ID}: socket handler error (see console)`);
    }
  });

  dbg("socket listener registered", `module.${MODULE_ID}`);

  if (ui?.controls) {
    try {
      if (typeof ui.controls.render === "function") ui.controls.render({ force: true });
      else if (typeof ui.controls.draw === "function") ui.controls.draw();
      else if (typeof ui.controls.initialize === "function") ui.controls.initialize();
      dbg("controls refreshed");
    } catch (e) {
      console.warn(`${MODULE_ID} | controls refresh failed`, e);
    }
  }
});

function resolveTokenControls(controls) {
  if (!controls) return null;

  if (Array.isArray(controls)) {
    return controls.find(c => ["token", "tokens"].includes(c?.name)) ?? controls[0] ?? null;
  }

  if (typeof controls === "object") {
    return controls.tokens ?? controls.token ?? Object.values(controls)[0] ?? null;
  }

  return null;
}

function ensureSceneControlToolsContainer(control) {
  if (!control) return null;

  if (Array.isArray(control.tools)) return control.tools;

  if (control.tools && typeof control.tools === "object") return control.tools;

  control.tools = [];
  return control.tools;
}

async function showPlayerPopup(payload) {
  const gmUser = payload.fromGM ? game.users.get(payload.fromGM) : null;
  const actor = game.actors.get(payload.actorId) ?? game.user.character;

  const gmName = gmUser?.name ?? "GM";
  const actorName = actor?.name ?? "Your Character";
  const actorImg = actor?.img ?? "icons/svg/mystery-man.svg";

  const baseDiff = Number(payload.poolMods?.difficulty ?? 0);
  const upgrades = Number(payload.poolMods?.challenge ?? 0);
  const setback = Number(payload.poolMods?.setback ?? 0);
  const boost = Number(payload.poolMods?.boost ?? 0);
  const rollMode = payload.rollMode ?? "publicroll";

  const content = `
    <div class="grr-player-popup">
      <div class="grr-row">
        <img class="grr-avatar" src="${actorImg}" />
        <div class="grr-col">
          <div><b>${gmName}</b> requests a roll from <b>${actorName}</b></div>
          <div class="grr-sub">${payload.label ?? Lang.t("popup.requestedRoll")}</div>
          <div class="grr-sub">${Lang.t("popup.skill")}: <b>${payload.skillLabel ?? payload.skillKey ?? "?"}</b></div>
          <div class="grr-sub">${Lang.t("popup.difficulty")}: <b>${baseDiff}</b> | ${Lang.t("popup.challengeUpgrades")}: <b>${upgrades}</b> | ${Lang.t("popup.setback")}: <b>${setback}</b> | ${Lang.t("popup.boost")}: <b>${boost}</b></div>
          <div class="grr-sub">${Lang.t("popup.mode")}: <b>${rollMode}</b></div>
        </div>
      </div>
      <hr/>
      <p>${Lang.t("popup.openDialogHint")}</p>
    </div>
  `;

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) throw new Error("Foundry DialogV2 API is unavailable.");
  await DialogV2.wait({
    window: { title: Lang.t("request.title"), icon: "fa-solid fa-dice" },
    position: { width: 500, height: "auto" },
    content,
    modal: false,
    rejectClose: false,
    buttons: [
      {
        action: "open",
        icon: "fa-solid fa-dice",
        label: Lang.t("popup.openDialog"),
        default: true,
        callback: async () => {
          await openStarWarsFFGRollDialog({
            actor,
            skillKey: payload.skillKey,
            poolMods: payload.poolMods,
            rollMode: payload.rollMode,
            label: payload.label
          });
        }
      },
      { action: "close", icon: "fa-solid fa-times", label: Lang.t("common.close") }
    ]
  });
}

function applyDifficultyAndUpgrades(difficulty, upgrades) {
  let purple = Math.max(0, Number(difficulty ?? 0));
  let red = 0;
  let up = Math.max(0, Number(upgrades ?? 0));
  for (let i = 0; i < up; i++) {
    if (purple > 0) { purple -= 1; red += 1; }
    else { purple += 1; }
  }
  return { purple, red };
}

async function openStarWarsFFGRollDialog({ actor, skillKey, poolMods, rollMode, label }) {
  if (!actor) return ui.notifications?.warn("No actor available for this roll request.");
  if (!skillKey) return ui.notifications?.warn("No skill selected in this roll request.");
  if (!globalThis.DicePoolFFG) {
    ui.notifications?.error("StarWarsFFG DicePoolFFG not found on window. Is the starwarsffg system loaded?");
    return;
  }

  let RollBuilderFFG;
  try {
    ({ default: RollBuilderFFG } = await import("/systems/starwarsffg/modules/dice/roll-builder.js"));
  } catch (err) {
    console.error(`${MODULE_ID} | failed to import RollBuilderFFG`, err);
    ui.notifications?.error("Failed to load StarWarsFFG roll builder module. Check console.");
    return;
  }

  const sys = actor.system ?? actor.data?.data;
  const skillsRoot = sys?.skills;
  const charsRoot = sys?.characteristics;

  const skill = skillsRoot?.[skillKey];
  if (!skill) return ui.notifications?.warn(`Skill '${skillKey}' not found on this actor.`);

  const charKey = skill.characteristic;
  const characteristic = charsRoot?.[charKey];
  const charVal = Number(characteristic?.value ?? 0);
  const rank = Number(skill?.rank ?? 0);

  const baseAbility = Math.max(charVal, rank);
  const baseUpgrades = Math.min(charVal, rank);

  const baseDiff = Number(poolMods?.difficulty ?? 0);
  const upgrades = Number(poolMods?.challenge ?? 0);
  const modSetback = Number(poolMods?.setback ?? 0);
  const modBoost = Number(poolMods?.boost ?? 0);

  const { purple: finalPurple, red: finalRed } = applyDifficultyAndUpgrades(baseDiff, upgrades);

  const dicePool = new globalThis.DicePoolFFG({
    ability: baseAbility,
    boost: Number(skill?.boost ?? 0) + modBoost,
    setback: Number(skill?.setback ?? 0) + modSetback,
    force: Number(skill?.force ?? 0),
    advantage: Number(skill?.advantage ?? 0),
    dark: Number(skill?.dark ?? 0),
    light: Number(skill?.light ?? 0),
    failure: Number(skill?.failure ?? 0),
    threat: Number(skill?.threat ?? 0),
    success: Number(skill?.success ?? 0),
    triumph: Number(skill?.triumph ?? 0),
    upgrades: Number(skill?.upgrades ?? 0),
    difficulty: finalPurple,
    challenge: finalRed
  });

  try { dicePool.upgrade(baseUpgrades + (dicePool.upgrades ?? 0)); } catch (e) {}
  try { applyNextCheckDifficultyUpgradeToPool(actor, dicePool); } catch (e) { console.warn(`${MODULE_ID} | failed to apply requested next-check difficulty upgrade`, e); }

  const skillLabel = skill?.label ?? skillKey;
  const description = `${label ?? `Rolling ${skillLabel}`}`;

  let rollData;
  try {
    const sheet = actor.sheet;
    if (sheet && typeof sheet.getData === "function") rollData = await sheet.getData();
  } catch (e) {}
  if (!rollData) rollData = { actor, data: { skills: skillsRoot, characteristics: charsRoot } };
  rollData.document ??= actor;
  rollData.actor ??= { _id: actor.id };

  const requestedMode = rollMode ?? "publicroll";
  let previousMode;
  try {
    previousMode = game.settings.get("core", "rollMode");
    if (requestedMode && requestedMode !== previousMode) {
      await game.settings.set("core", "rollMode", requestedMode);
    }
  } catch (e) {}

  const app = new RollBuilderFFG(rollData, dicePool, description, skillKey, {}, "", null);

  const originalClose = app.close.bind(app);
  app.close = async (...args) => {
    try {
      if (previousMode !== undefined && previousMode !== game.settings.get("core", "rollMode")) {
        await game.settings.set("core", "rollMode", previousMode);
      }
    } catch (e) {}
    return originalClose(...args);
  };

  app.render(true);
}


Hooks.once('init', () => {
  const MODID = "genesys-ffg-options-enhancer";
  // Currency conversion settings
  game.settings.register(MODID, "silverPerGold", {
    name: game.i18n.localize("GFOE.SettingSilverPerGoldName"),
    hint: game.i18n.localize("GFOE.SettingSilverPerGoldHint"),
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });
  game.settings.register(MODID, "bronzePerSilver", {
    name: game.i18n.localize("GFOE.SettingBronzePerSilverName"),
    hint: game.i18n.localize("GFOE.SettingBronzePerSilverHint"),
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });
});

Hooks.once('ready', () => { try { if (isFeatureEnabled("enableCurrency", true)) registerCurrencyUIHook(); } catch(e){ console.error(e);} });

