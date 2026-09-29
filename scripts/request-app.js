const MODULE_ID = "genesys-ffg-options-enhancer";
import { Lang } from "./i18n.js";
import { getNextCheckStackCount } from "./next-check-effects.js";

function dbg(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}

const REQUEST_LIMITS = Object.freeze({
  difficulty: 5,
  upgrades: 20,
  boost: 20,
  setback: 20
});

export class RollRequestApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "grr-request-app",
      title: Lang.t("request.title"),
      template: `modules/${MODULE_ID}/templates/request-ui.hbs`,
      width: 560,
      height: "auto",
      closeOnSubmit: false,
      resizable: true
    });
  }

  getData() {
    const onlineUsers = game.users
      .filter(u => u.active && !u.isGM)
      .map(u => {
        const actor = u.character ?? null;
        return {
          id: u.id,
          name: u.name,
          active: u.active,
          hasActor: !!actor,
          actorId: actor?.id ?? "",
          actorName: actor?.name ?? "(no character)",
          actorImg: actor?.img ?? "icons/svg/mystery-man.svg"
        };
      });

    const initialSkills = getUnionSkills(onlineUsers
      .map(u => game.actors.get(u.actorId))
      .filter(Boolean));

    const rollModes = [
      { id: "publicroll", label: "Public" },
      { id: "gmroll", label: "Private (GM)" },
      { id: "blindroll", label: "Blind (GM only)" },
      { id: "selfroll", label: "Self (only player)" }
    ];

    return { onlineUsers, rollModes, initialSkills };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".grr-user").on("click", (ev) => {
      const row = ev.currentTarget;
      if (row.classList.contains("grr-disabled")) return;
      row.classList.toggle("grr-selected");
      this._refreshSkillList(html);
      this._updatePoolPreview(html);
    });

    html.find("button[name='refreshSkills']").on("click", (ev) => {
      ev.preventDefault();
      this._refreshSkillList(html, true);
      this._updatePoolPreview(html);
    });

    html.on("click", ".grr-skill-option", (ev) => {
      ev.preventDefault();
      const btn = ev.currentTarget;
      const skillKey = btn.dataset.skillKey ?? "";
      const skillLabel = btn.dataset.skillLabel ?? btn.textContent?.trim?.() ?? "";
      html.find("input[name='skillKey']").val(skillKey);
      html.find("input[name='skillLabel']").val(skillLabel);
      html.find(".grr-skill-option").removeClass("active");
      btn.classList.add("active");
      this._updatePoolPreview(html);
    });

    html.on("click", ".grr-difficulty-die", (ev) => {
      ev.preventDefault();
      const value = clampInt(ev.currentTarget.dataset.value, 1, REQUEST_LIMITS.difficulty);
      const input = html.find("input[name='difficulty']");
      const current = clampInt(input.val(), 0, REQUEST_LIMITS.difficulty);
      input.val(current === value ? 0 : value);
      this._renderDifficultyControls(html);
      this._updatePoolPreview(html);
    });

    html.on("click", ".grr-stepper-btn", (ev) => {
      ev.preventDefault();
      const btn = ev.currentTarget;
      const name = btn.dataset.input;
      const delta = Number(btn.dataset.delta ?? 0);
      const limits = {
        challenge: REQUEST_LIMITS.upgrades,
        boost: REQUEST_LIMITS.boost,
        setback: REQUEST_LIMITS.setback
      };
      if (!name || !(name in limits) || !Number.isFinite(delta)) return;
      const input = html.find(`input[name='${name}']`);
      if (!input.length) return;
      const next = clampInt(Number(input.val() ?? 0) + delta, 0, limits[name]);
      input.val(next);
      this._renderSteppers(html);
      this._renderDifficultyControls(html);
      this._updatePoolPreview(html);
    });

    html.find("button[name='send']").on("click", async (ev) => {
      ev.preventDefault();
      await this._sendRequests(html);
    });

    const availableRows = Array.from(html.find(".grr-user:not(.grr-disabled)"));
    if (availableRows.length === 1) {
      availableRows[0].classList.add("grr-selected");
      this._refreshSkillList(html);
    }

    this._renderSteppers(html);
    this._renderDifficultyControls(html);
    this._updatePoolPreview(html);
  }

  async _refreshSkillList(html, force = false) {
    const list = html.find("[data-skill-list]")[0];
    const hiddenSkillKey = html.find("input[name='skillKey']");
    const hiddenSkillLabel = html.find("input[name='skillLabel']");
    if (!list || !hiddenSkillKey.length || !hiddenSkillLabel.length) return;

    const selected = this._getSelectedUsers(html);
    const current = hiddenSkillKey.val()?.toString?.() ?? "";

    if (selected.length === 0) {
      hiddenSkillKey.val("");
      hiddenSkillLabel.val("");
      list.querySelectorAll(".grr-skill-option").forEach(el => el.classList.remove("active"));
      return;
    }

    const first = selected[0];
    const actor = game.actors.get(first.actorId);
    if (!actor) {
      list.innerHTML = `<div class="grr-muted">${escapeHtml(Lang.t("request.selectedPlayerHasNoCharacter") || "Wybrany gracz nie ma postaci.")}</div>`;
      hiddenSkillKey.val("");
      hiddenSkillLabel.val("");
      return;
    }

    const skills = extractSkills(actor);
    if (!skills.length) {
      list.innerHTML = `<div class="grr-muted">${escapeHtml(Lang.t("request.noSkillsFound") || "Nie znaleziono umiejętności na postaci.")}</div>`;
      hiddenSkillKey.val("");
      hiddenSkillLabel.val("");
      return;
    }

    let selectedSkill = (!force && current) ? skills.find(s => s.key === current) : null;
    if (!selectedSkill) selectedSkill = skills[0];

    list.innerHTML = skills.map(s => {
      const active = s.key === selectedSkill?.key ? " active" : "";
      return `<button type="button" class="grr-skill-option${active}" data-skill-key="${escapeHtml(s.key)}" data-skill-label="${escapeHtml(s.label)}">${escapeHtml(s.label)}</button>`;
    }).join("");

    hiddenSkillKey.val(selectedSkill?.key ?? "");
    hiddenSkillLabel.val(selectedSkill?.label ?? "");
  }

  _getSelectedUsers(html) {
    const selectedEls = Array.from(html.find(".grr-user.grr-selected"));
    return selectedEls.map(el => ({
      userId: el.dataset.userId,
      actorId: el.dataset.actorId
    })).filter(x => x.userId);
  }

  _renderSteppers(html) {
    for (const name of ["challenge", "boost", "setback"]) {
      const input = html.find(`input[name='${name}']`);
      const value = clampInt(input.val(), 0, name === "challenge" ? REQUEST_LIMITS.upgrades : 20);
      input.val(value);
      html.find(`[data-stepper-value='${name}']`).text(value);
      html.find(`.grr-stepper-btn[data-input='${name}'][data-delta='-1']`).prop("disabled", value <= 0);
      const max = name === "challenge" ? REQUEST_LIMITS.upgrades : 20;
      html.find(`.grr-stepper-btn[data-input='${name}'][data-delta='1']`).prop("disabled", value >= max);
    }
  }

  _renderDifficultyControls(html) {
    const base = clampInt(html.find("input[name='difficulty']").val(), 0, REQUEST_LIMITS.difficulty);
    const upgrades = clampInt(html.find("input[name='challenge']").val(), 0, REQUEST_LIMITS.upgrades);
    html.find(".grr-difficulty-die").each((_i, el) => {
      const value = clampInt(el.dataset.value, 1, REQUEST_LIMITS.difficulty);
      el.classList.toggle("active", value <= base);
      el.setAttribute("aria-pressed", value <= base ? "true" : "false");
    });

    const { purple, red } = applyDifficultyAndUpgrades(base, upgrades);
    const result = html.find("[data-final-difficulty]")[0];
    if (result) {
      result.innerHTML = renderDiceIcons({ difficulty: purple, challenge: red }, { compact: true, emptyText: Lang.t("request.noDifficulty") || "No difficulty dice" });
    }
  }

  _updatePoolPreview(html) {
    const container = html.find("[data-roll-preview]")[0];
    if (!container) return;

    const selected = this._getSelectedUsers(html);
    const skillKey = (html.find("input[name='skillKey']").val() ?? "").toString();
    const difficulty = clampInt(html.find("input[name='difficulty']").val(), 0, REQUEST_LIMITS.difficulty);
    const challenge = clampInt(html.find("input[name='challenge']").val(), 0, REQUEST_LIMITS.upgrades);
    const setback = clampInt(html.find("input[name='setback']").val(), 0, REQUEST_LIMITS.setback);
    const boost = clampInt(html.find("input[name='boost']").val(), 0, REQUEST_LIMITS.boost);
    if (!selected.length) {
      container.innerHTML = `<div class="grr-preview-empty">${escapeHtml(Lang.t("request.previewSelectPlayer") || "Select a player to preview the complete dice pool.")}</div>`;
      return;
    }

    container.innerHTML = selected.map(entry => {
      const actor = game.actors.get(entry.actorId);
      if (!actor) return "";
      const counts = getActorPoolPreview(actor, skillKey, { boost, setback, difficulty, challenge });
      if (!counts) {
        return `<div class="grr-preview-character"><div class="grr-preview-name">${escapeHtml(actor.name)}</div><div class="grr-preview-empty">${escapeHtml(Lang.t("request.previewSelectSkill") || "Select a skill to preview the roll.")}</div></div>`;
      }
      return `<div class="grr-preview-character"><div class="grr-preview-name">${escapeHtml(actor.name)}</div><div class="grr-preview-dice">${renderDiceIcons(counts, { compact: false })}</div></div>`;
    }).join("");
  }

  async _sendRequests(html) {
    const selected = this._getSelectedUsers(html);
    if (selected.length === 0) {
      ui.notifications.warn("Select at least one online player.");
      return;
    }

    const missingActors = selected.filter(s => !s.actorId);
    if (missingActors.length) {
      ui.notifications.warn("One or more selected players have no assigned character.");
      return;
    }

    const skillKey = (html.find("input[name='skillKey']").val() ?? "").toString();
    if (!skillKey) {
      ui.notifications.warn("Select a skill.");
      return;
    }
    const skillLabel = (html.find("input[name='skillLabel']").val() ?? skillKey).toString();

    const difficulty = clampInt(html.find("input[name='difficulty']").val(), 0, REQUEST_LIMITS.difficulty);
    const challenge = clampInt(html.find("input[name='challenge']").val(), 0, REQUEST_LIMITS.upgrades);
    const setback = clampInt(html.find("input[name='setback']").val(), 0, REQUEST_LIMITS.setback);
    const boost = clampInt(html.find("input[name='boost']").val(), 0, REQUEST_LIMITS.boost);

    const rollMode = html.find("select[name='rollMode']").val() ?? "publicroll";
    const label = html.find("input[name='label']").val() ?? `Requested roll: ${skillLabel}`;

    dbg("sending requests", { selected, skillKey, difficulty, challenge, setback, boost, rollMode, label });

    for (const s of selected) {
      const payload = {
        type: "ROLL_REQUEST",
        fromGM: game.user.id,
        toUser: s.userId,
        actorId: s.actorId,
        skillKey,
        skillLabel,
        poolMods: { difficulty, challenge, setback, boost },
        rollMode,
        label
      };

      game.socket.emit(`module.${MODULE_ID}`, payload);

      try {
        ChatMessage.create({
          content: `[Roll Request] ${label} (Skill: ${skillLabel})`,
          whisper: [s.userId]
        });
      } catch (e) {}
    }

    ui.notifications.info(`Sent roll request to ${selected.length} player(s).`);
  }
}

function extractSkills(actor) {
  const sys = actor.system ?? actor.data?.data;
  const root = sys?.skills;
  if (!root || typeof root !== "object") return [];

  const out = [];
  for (const [k, v] of Object.entries(root)) {
    if (!v) continue;
    if (typeof v === "object" && ("label" in v || "name" in v)) {
      out.push({ key: k, label: v.label ?? v.name ?? k });
    } else if (typeof v === "object") {
      for (const [k2, v2] of Object.entries(v)) {
        if (!v2 || typeof v2 !== "object") continue;
        if ("label" in v2 || "name" in v2) {
          const cat = titleCase(k);
          out.push({ key: k2, label: `${cat}: ${v2.label ?? v2.name ?? k2}` });
        }
      }
    }
  }

  const seen = new Set();
  const unique = [];
  for (const s of out) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    unique.push(s);
  }
  unique.sort((a, b) => a.label.localeCompare(b.label));
  return unique;
}

function getUnionSkills(actors) {
  const byKey = new Map();
  for (const actor of actors) {
    for (const skill of extractSkills(actor)) {
      if (!byKey.has(skill.key)) byKey.set(skill.key, skill);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function findSkill(actor, skillKey) {
  if (!actor || !skillKey) return null;
  const sys = actor.system ?? actor.data?.data;
  const root = sys?.skills;
  if (!root || typeof root !== "object") return null;
  if (root[skillKey] && typeof root[skillKey] === "object") return root[skillKey];
  for (const group of Object.values(root)) {
    if (group && typeof group === "object" && group[skillKey] && typeof group[skillKey] === "object") return group[skillKey];
  }
  return null;
}

function getActorPoolPreview(actor, skillKey, modifiers) {
  const skill = findSkill(actor, skillKey);
  if (!skill) return null;
  const sys = actor.system ?? actor.data?.data;
  const chars = sys?.characteristics ?? {};
  const characteristic = chars?.[skill.characteristic];
  const charVal = Math.max(0, Number(characteristic?.value ?? 0));
  const rank = Math.max(0, Number(skill?.rank ?? 0));
  const baseAbility = Math.max(charVal, rank);
  const abilityUpgrades = Math.min(charVal, rank) + Math.max(0, Number(skill?.upgrades ?? 0));
  const positive = applyAbilityAndUpgrades(baseAbility, abilityUpgrades);

  return {
    ability: positive.green,
    proficiency: positive.yellow,
    boost: Math.max(0, Number(skill?.boost ?? 0)) + Math.max(0, Number(modifiers?.boost ?? 0)),
    setback: Math.max(0, Number(skill?.setback ?? 0)) + Math.max(0, Number(modifiers?.setback ?? 0)),
    ...(() => {
      const pendingDifficultyUpgrades = getNextCheckStackCount(actor, "upgradeDifficulty");
      const finalDifficulty = applyDifficultyAndUpgrades(
        Math.max(0, Number(modifiers?.difficulty ?? 0)),
        Math.max(0, Number(modifiers?.challenge ?? 0)) + pendingDifficultyUpgrades
      );
      return { difficulty: finalDifficulty.purple, challenge: finalDifficulty.red };
    })(),
    force: Math.max(0, Number(skill?.force ?? 0))
  };
}

function applyAbilityAndUpgrades(ability, upgrades) {
  let green = Math.max(0, Number(ability ?? 0));
  let yellow = 0;
  const up = Math.max(0, Number(upgrades ?? 0));
  for (let i = 0; i < up; i++) {
    if (green > 0) { green -= 1; yellow += 1; }
    else { green += 1; }
  }
  return { green, yellow };
}

function applyDifficultyAndUpgrades(difficulty, upgrades) {
  let purple = Math.max(0, Number(difficulty ?? 0));
  let red = 0;
  const up = Math.max(0, Number(upgrades ?? 0));
  for (let i = 0; i < up; i++) {
    if (purple > 0) { purple -= 1; red += 1; }
    else { purple += 1; }
  }
  return { purple, red };
}

function renderDiceIcons(counts, { compact = false, emptyText = "" } = {}) {
  const defs = [
    ["ability", "ability", "Ability"],
    ["proficiency", "proficiency", "Proficiency"],
    ["boost", "boost", "Boost"],
    ["difficulty", "difficulty", "Difficulty"],
    ["challenge", "challenge", "Challenge"],
    ["setback", "setback", "Setback"],
    ["force", "force", "Force"]
  ];
  const dice = [];
  for (const [key, css, label] of defs) {
    const amount = Math.max(0, Number(counts?.[key] ?? 0));
    for (let i = 0; i < amount; i++) {
      dice.push(`<span class="grr-die grr-die-${css}${compact ? " grr-die-compact" : ""}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></span>`);
    }
  }
  if (!dice.length) return `<span class="grr-preview-empty">${escapeHtml(emptyText)}</span>`;
  return dice.join("");
}

function clampInt(value, min, max) {
  const n = Number.parseInt(value ?? 0, 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function titleCase(str) {
  return String(str).replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
