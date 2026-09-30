import { Lang } from "./i18n.js";

const MODULE_ID = "genesys-ffg-options-enhancer";
const MELEE_SETTING = "additionalMeleeDefenseSkills";
const RANGED_SETTING = "additionalRangedDefenseSkills";

const NATIVE_RANGED_SKILLS = new Set([
  "Ranged: Light",
  "Ranged: Heavy",
  "Ranged-Light",
  "Ranged-Heavy",
  "Ranged",
  "Gunnery"
]);

const NATIVE_MELEE_SKILLS = new Set([
  "Melee",
  "Melee-Light",
  "Melee-Heavy",
  "Brawl",
  "Lightsaber"
]);

let featureRegistered = false;
const preparedRollBuilders = new WeakSet();

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

function parseSetting(key) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch (_) {
    return new Set();
  }
}

function localizeSkillLabel(value) {
  if (!value) return "";
  try {
    const localized = game.i18n?.localize?.(value);
    return localized && localized !== value ? localized : String(value);
  } catch (_) {
    return String(value);
  }
}

function skillAliases(id, skill = {}, configSkill = null) {
  const values = new Set();
  const add = value => {
    if (value == null || value === "") return;
    values.add(String(value));
    values.add(localizeSkillLabel(value));
  };

  add(id);
  add(skill?.value);
  add(skill?.label);
  add(configSkill?.value);
  add(configSkill?.label);
  return values;
}

function isNativeCombatSkill(id, skill = {}, configSkill = null) {
  const aliases = skillAliases(id, skill, configSkill);
  for (const alias of aliases) {
    if (NATIVE_MELEE_SKILLS.has(alias)) return "melee";
    if (NATIVE_RANGED_SKILLS.has(alias)) return "ranged";
  }
  return null;
}

function collectAvailableSkills() {
  const byId = new Map();

  const add = (id, skill = {}, source = "system") => {
    if (!id) return;
    const configSkill = CONFIG?.FFG?.skills?.[id] ?? null;
    const label = localizeSkillLabel(skill?.label ?? configSkill?.label ?? skill?.value ?? configSkill?.value ?? id);
    const value = skill?.value ?? configSkill?.value ?? null;
    const existing = byId.get(String(id));
    const nativeKind = isNativeCombatSkill(id, skill, configSkill);

    if (!existing) {
      byId.set(String(id), {
        id: String(id),
        label,
        value: value == null ? "" : String(value),
        nativeKind,
        source
      });
      return;
    }

    if ((!existing.label || existing.label === existing.id) && label) existing.label = label;
    if (!existing.value && value != null) existing.value = String(value);
    if (!existing.nativeKind && nativeKind) existing.nativeKind = nativeKind;
    if (existing.source !== "system" && source === "system") existing.source = source;
  };

  for (const [id, skill] of Object.entries(CONFIG?.FFG?.skills ?? {})) add(id, skill, "system");

  for (const actor of game.actors?.contents ?? []) {
    for (const [id, skill] of Object.entries(actor?.system?.skills ?? {})) add(id, skill, "actor");
  }

  return Array.from(byId.values()).sort((a, b) =>
    String(a.label || a.id).localeCompare(String(b.label || b.id), game.i18n?.lang ?? undefined, { sensitivity: "base" })
  );
}

function resolveActor(app) {
  const direct = app?.roll?.data?.document;
  if (direct?.documentName === "Actor") return direct;

  const actorId = app?.roll?.data?.actor?._id ?? app?.roll?.data?.actor?.id;
  if (actorId) return game.actors?.get?.(actorId) ?? null;
  return null;
}

function resolveRollSkill(app) {
  const rawSkillName = app?.roll?.skillName;
  if (!rawSkillName) return null;

  const actor = resolveActor(app);
  const skills = actor?.system?.skills ?? app?.roll?.data?.data?.skills ?? {};
  const wanted = normalize(localizeSkillLabel(rawSkillName));

  for (const [id, skill] of Object.entries(skills)) {
    const configSkill = CONFIG?.FFG?.skills?.[id] ?? null;
    const aliases = skillAliases(id, skill, configSkill);
    if ([...aliases].some(alias => normalize(alias) === wanted)) {
      return {
        id: String(id),
        label: localizeSkillLabel(skill?.label ?? configSkill?.label ?? rawSkillName),
        skill,
        configSkill,
        actor
      };
    }
  }

  const directConfig = CONFIG?.FFG?.skills?.[rawSkillName] ?? null;
  if (directConfig) {
    return {
      id: String(rawSkillName),
      label: localizeSkillLabel(directConfig?.label ?? directConfig?.value ?? rawSkillName),
      skill: skills?.[rawSkillName] ?? directConfig,
      configSkill: directConfig,
      actor
    };
  }

  for (const [id, configSkill] of Object.entries(CONFIG?.FFG?.skills ?? {})) {
    const aliases = skillAliases(id, {}, configSkill);
    if ([...aliases].some(alias => normalize(alias) === wanted)) {
      return {
        id: String(id),
        label: localizeSkillLabel(configSkill?.label ?? configSkill?.value ?? rawSkillName),
        skill: skills?.[id] ?? configSkill,
        configSkill,
        actor
      };
    }
  }

  return {
    id: String(rawSkillName),
    label: localizeSkillLabel(rawSkillName),
    skill: null,
    configSkill: null,
    actor
  };
}

function configuredDefenseKind(resolved) {
  if (!resolved) return null;

  if (isNativeCombatSkill(resolved.id, resolved.skill, resolved.configSkill)) return null;

  const melee = parseSetting(MELEE_SETTING);
  const ranged = parseSetting(RANGED_SETTING);
  if (melee.has(resolved.id)) return "melee";
  if (ranged.has(resolved.id)) return "ranged";

  const aliases = [...skillAliases(resolved.id, resolved.skill, resolved.configSkill)].map(normalize);
  for (const saved of melee) if (aliases.includes(normalize(saved))) return "melee";
  for (const saved of ranged) if (aliases.includes(normalize(saved))) return "ranged";
  return null;
}

function numericDefense(value) {
  const raw = value && typeof value === "object" ? (value.value ?? value.total ?? value.current) : value;
  const number = Number(raw ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function defenseValue(actor, kind) {
  const stats = actor?.system?.stats;
  if (!stats) return 0;

  const cap = kind === "melee" ? "Melee" : "Ranged";
  const base = kind === "melee" ? "melee" : "ranged";
  const candidates = [
    stats?.defence?.[base],
    stats?.defense?.[base],
    stats?.[`${base}Defence`],
    stats?.[`${base}Defense`],
    stats?.[`defence${cap}`],
    stats?.[`defense${cap}`]
  ];

  for (const candidate of candidates) {
    const value = numericDefense(candidate);
    if (value > 0) return value;
  }
  return 0;
}

function targetDefense(kind) {
  try {
    if (!game.settings.get("starwarsffg", "useDefense")) return 0;
  } catch (_) {
    return 0;
  }

  let result = 0;
  for (const target of Array.from(game.user?.targets ?? [])) {
    result = Math.max(result, defenseValue(target?.actor, kind));
  }
  return result;
}

function adjustPool(pool, field, delta) {
  if (!pool || !field || !delta) return;
  const current = Number(pool[field] ?? 0);
  pool[field] = (Number.isFinite(current) ? current : 0) + delta;
}

function rollBuilderRoot(html) {
  if (html?.nodeType === 1) return html;
  if (html?.[0]?.nodeType === 1) return html[0];
  return null;
}

function refreshRollBuilderPreview(app, root) {
  try {
    const input = root?.querySelector?.('input[name="setback"]');
    if (input) input.value = String(app.dicePool?.setback ?? 0);

    const jq = globalThis.jQuery ? globalThis.jQuery(root) : null;
    if (jq && typeof app?._updatePreview === "function") app._updatePreview(jq);
  } catch (err) {
    console.warn(`${MODULE_ID} | additional defense skills | failed to refresh RollBuilder preview`, err);
  }
}

function addAppliedNotice(app, root, kind, amount, resolved) {
  if (!root || !amount) return;
  const diceDialog = root.querySelector?.(".dice-pool-dialog") ?? root;
  if (!diceDialog || diceDialog.querySelector?.("[data-gfoe-additional-defense]")) return;

  const panel = root.ownerDocument.createElement("section");
  panel.className = "gfoe-additional-defense-notice";
  panel.dataset.gfoeAdditionalDefense = "true";

  const defenseLabel = kind === "melee"
    ? Lang.t("defenseSkills.meleeDefense")
    : Lang.t("defenseSkills.rangedDefense");

  panel.innerHTML = `<i class="fa-solid fa-shield-halved"></i> <span>${Lang.t("defenseSkills.rollApplied", {
    skill: resolved?.label ?? resolved?.id ?? "?",
    defense: defenseLabel,
    count: amount
  })}</span>`;
  diceDialog.prepend(panel);
}

function onRenderRollBuilder(app, html) {
  if (preparedRollBuilders.has(app)) return;

  const resolved = resolveRollSkill(app);
  const kind = configuredDefenseKind(resolved);
  if (!kind) return;

  const amount = targetDefense(kind);
  if (!amount) return;

  preparedRollBuilders.add(app);
  adjustPool(app.dicePool, "setback", amount);
  const root = rollBuilderRoot(html);
  addAppliedNotice(app, root, kind, amount, resolved);
  refreshRollBuilderPreview(app, root);
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DefenseSkillsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-defense-skills-config`,
    tag: "form",
    classes: ["gfoe-defense-skills-config"],
    position: { width: 760, height: 720 },
    window: { icon: "fa-solid fa-shield-halved", resizable: true },
    form: {
      closeOnSubmit: false,
      handler: this.#onSubmit
    }
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/defense-skills-config.hbs`
    }
  };

  get title() {
    return Lang.t("defenseSkills.title");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const melee = parseSetting(MELEE_SETTING);
    const ranged = parseSetting(RANGED_SETTING);

    const skills = collectAvailableSkills().map(entry => ({
      ...entry,
      selectedNone: !entry.nativeKind && !melee.has(entry.id) && !ranged.has(entry.id),
      selectedMelee: !entry.nativeKind && melee.has(entry.id),
      selectedRanged: !entry.nativeKind && ranged.has(entry.id),
      nativeLabel: entry.nativeKind === "melee"
        ? Lang.t("defenseSkills.nativeMelee")
        : entry.nativeKind === "ranged" ? Lang.t("defenseSkills.nativeRanged") : ""
    }));

    return {
      ...context,
      intro: Lang.t("defenseSkills.intro"),
      systemNote: Lang.t("defenseSkills.systemNote"),
      skillHeader: Lang.t("defenseSkills.skillHeader"),
      noneHeader: Lang.t("defenseSkills.noneHeader"),
      meleeHeader: Lang.t("defenseSkills.meleeHeader"),
      rangedHeader: Lang.t("defenseSkills.rangedHeader"),
      nativeHeader: Lang.t("defenseSkills.nativeHeader"),
      searchPlaceholder: Lang.t("defenseSkills.searchPlaceholder"),
      noSkills: Lang.t("defenseSkills.noSkills"),
      save: Lang.t("defenseSkills.save"),
      skills
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    const search = root?.querySelector?.("[data-gfoe-defense-search]");
    const rows = Array.from(root?.querySelectorAll?.("[data-gfoe-defense-skill-row]") ?? []);
    if (!search || !rows.length) return;

    const applyFilter = () => {
      const query = normalize(search.value);
      for (const row of rows) {
        const haystack = normalize(`${row.dataset.skillId ?? ""} ${row.dataset.skillLabel ?? ""}`);
        row.hidden = Boolean(query) && !haystack.includes(query);
      }
    };

    search.addEventListener("input", applyFilter);
    applyFilter();
  }

  static async #onSubmit(_event, form) {
    const melee = [];
    const ranged = [];

    for (const input of Array.from(form.querySelectorAll('input[type="radio"][data-skill-id]:checked'))) {
      const id = String(input.dataset.skillId ?? "").trim();
      if (!id) continue;
      if (input.value === "melee") melee.push(id);
      if (input.value === "ranged") ranged.push(id);
    }

    await game.settings.set(MODULE_ID, MELEE_SETTING, JSON.stringify(melee));
    await game.settings.set(MODULE_ID, RANGED_SETTING, JSON.stringify(ranged));
    ui.notifications?.info(Lang.t("defenseSkills.saved"));
    await this.close();
  }
}

export function registerAdditionalDefenseSettings() {
  game.settings.register(MODULE_ID, MELEE_SETTING, {
    name: "Additional melee defense skills",
    scope: "world",
    config: false,
    type: String,
    default: "[]"
  });

  game.settings.register(MODULE_ID, RANGED_SETTING, {
    name: "Additional ranged defense skills",
    scope: "world",
    config: false,
    type: String,
    default: "[]"
  });

  game.settings.registerMenu(MODULE_ID, "additionalDefenseSkills", {
    name: game.i18n?.localize?.("settings.additionalDefenseSkillsName") ?? "Additional Defense skills",
    label: game.i18n?.localize?.("settings.additionalDefenseSkillsLabel") ?? "Configure Defense skills",
    hint: game.i18n?.localize?.("settings.additionalDefenseSkillsHint") ?? "Choose additional skills that should automatically read Melee or Ranged Defense from targeted tokens.",
    icon: "fa-solid fa-shield-halved",
    type: DefenseSkillsConfig,
    restricted: true
  });
}

export function registerAdditionalDefenseFeature() {
  if (featureRegistered) return;
  featureRegistered = true;

  Hooks.on("renderRollBuilderFFG", (app, html) => {
    try { onRenderRollBuilder(app, html); }
    catch (err) { console.warn(`${MODULE_ID} | additional defense skills | RollBuilder integration failed`, err); }
  });
}
