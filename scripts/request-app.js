const MODULE_ID = "genesys-ffg-options-enhancer";
import { Lang } from "./i18n.js";

function dbg(...args) {
  console.log(`${MODULE_ID} |`, ...args);
}

export class RollRequestApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "grr-request-app",
      title: Lang.t("request.title"),
      template: `modules/${MODULE_ID}/templates/request-ui.hbs`,
      width: 480,
      height: "auto",
      closeOnSubmit: false
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

    const rollModes = [
      { id: "publicroll", label: "Public" },
      { id: "gmroll", label: "Private (GM)" },
      { id: "blindroll", label: "Blind (GM only)" },
      { id: "selfroll", label: "Self (only player)" }
    ];

    return { onlineUsers, rollModes };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".grr-user").on("click", (ev) => {
      const row = ev.currentTarget;
      if (row.classList.contains("grr-disabled")) return;
      row.classList.toggle("grr-selected");
      this._refreshSkillList(html);
    });

    html.find("button[name='refreshSkills']").on("click", (ev) => {
      ev.preventDefault();
      this._refreshSkillList(html, true);
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
    });

    html.find("button[name='send']").on("click", async (ev) => {
      ev.preventDefault();
      await this._sendRequests(html);
    });
  }

  async _refreshSkillList(html, force = false) {
    const list = html.find("[data-skill-list]")[0];
    const hiddenSkillKey = html.find("input[name='skillKey']");
    const hiddenSkillLabel = html.find("input[name='skillLabel']");
    if (!list || !hiddenSkillKey.length || !hiddenSkillLabel.length) return;

    const selected = this._getSelectedUsers(html);
    const current = hiddenSkillKey.val()?.toString?.() ?? "";

    if (selected.length === 0) {
      list.innerHTML = `<div class="grr-muted">${escapeHtml(Lang.t("request.selectPlayersFirst"))}</div>`;
      hiddenSkillKey.val("");
      hiddenSkillLabel.val("");
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

    const difficulty = Number(html.find("input[name='difficulty']").val() ?? 0);
    const challenge = Number(html.find("input[name='challenge']").val() ?? 0);
    const setback = Number(html.find("input[name='setback']").val() ?? 0);
    const boost = Number(html.find("input[name='boost']").val() ?? 0);

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

function titleCase(str) {
  return String(str).replace(/[_\\-]+/g, " ").replace(/\\b\\w/g, c => c.toUpperCase());
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
