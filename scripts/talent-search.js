const MODULE_ID = "genesys-ffg-options-enhancer";
import { Lang } from "./i18n.js";
const TALENT_ITEM_TYPE = "talent";

function getActivationCostRegex() {
  const primary = (game.settings.get(MODULE_ID, "activationCostLabel") || "").trim();
  const defaults = ["Koszt aktywacji", "Activation Cost"];
  const labels = Array.from(new Set([primary, ...defaults].filter(Boolean)));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const pattern = labels.map(esc).join("|");
  return new RegExp(`(${pattern})\\s*:\\s*(\\d+)`, "i");
}

export async function openTalentSearch() {
  const ownedActors = game.actors?.contents?.filter(a => a.isOwner) ?? [];

  if (!ownedActors.length) {
    ui.notifications.warn(Lang.t("talent.noOwnerActors"));
    return;
  }

  let actor;
  if (ownedActors.length === 1) {
    actor = ownedActors[0];
  } else {
    actor = await new Promise((resolve) => {
      const options = ownedActors
        .map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)
        .join("");

      const content = `
        <div style="margin-bottom: 0.5rem;">
          <label for="actor-select"><strong>${Lang.t("talent.selectActor.label")}:</strong></label>
          <select id="actor-select" style="width: 100%; margin-top: 0.25rem;">
            ${options}
          </select>
        </div>
      `;

      new Dialog({
        title: Lang.t("talent.selectActor.title"),
        content,
        buttons: {
          ok: {
            label: Lang.t("talent.selectActor.next"),
            callback: (html) => {
              const id = html.find("#actor-select").val();
              resolve(game.actors.get(id));
            }
          },
          cancel: {
            label: Lang.t("talent.selectActor.cancel"),
            callback: () => resolve(null)
          }
        },
        default: "ok"
      }).render(true);
    });
    if (!actor) return;
  }

  const talentData = [];

  const itemTalents = actor.items.filter(i => i.type === TALENT_ITEM_TYPE);
  for (const t of itemTalents) {
    const desc = getTalentDescription(t) || "";
    const activationOptions = extractActivationOptionsFromDescription(desc);
    talentData.push({
      id: t.id,
      source: "item",
      origin: "",
      name: t.name ?? "",
      description: desc,
      activationOptions,
      searchText: `${(t.name ?? "").toLowerCase()} ${stripHtml(desc).toLowerCase()}`
    });
  }

  for (const carrier of actor.items) {
    const talentsObj = carrier.system?.talents;
    if (!talentsObj || typeof talentsObj !== "object") continue;

    for (const [key, t] of Object.entries(talentsObj)) {
      if (!t || !t.islearned) continue;

      const name = t.name ?? "";
      const desc = t.description ?? "";
      const activationOptions = extractActivationOptionsFromDescription(desc);
      talentData.push({
        id: `${carrier.id}:${key}`,
        source: "embedded",
        origin: carrier.name ?? "",
        name,
        description: desc,
        activationOptions,
        searchText: `${name.toLowerCase()} ${stripHtml(desc).toLowerCase()}`
      });
    }
  }

  if (!talentData.length) {
    ui.notifications.info(Lang.t("talent.noTalentsForActor", {actor: actor?.name ?? ""}));
    return;
  }

  function renderTalentList(filtered, forceExpand, query) {
    if (!filtered.length) {
      return  `<p><em>${Lang.t("talent.ui.noResults")}</em></p>` ;
    }

    return `
      <div style="max-height: 400px; overflow-y: auto; margin-top: 0.5rem;">
        ${filtered.map(t => {
          const descVisible = forceExpand;
          const displayStyle = descVisible ? "block" : "none";
          const toggleSymbol = descVisible ? "▲" : "▼";

          const hasOptions = t.activationOptions && t.activationOptions.length > 0;

          let costLabel = "";
          if (hasOptions) {
            const parts = t.activationOptions.map((opt, idx) => {
              if (opt.level != null) return `${opt.level} lvl: ${opt.cost}`;
              return `${Lang.t("talent.variant")} ${idx + 1}: ${opt.cost}`;
            });
            costLabel = `${Lang.t("talent.activationCost")}: ${parts.join(", ")} ${Lang.t("talent.mana")}`;
          }

          const highlightedName = highlightTerm(escapeHtml(t.name), query);
          const highlightedCostLabel = highlightTerm(escapeHtml(costLabel), query);
          const highlightedDescription = highlightTerm(t.description, query);

          const castButton = hasOptions
            ? `<button type="button" class="talent-cast-button" data-talent-id="${t.id}">${Lang.t("talent.castSpell")}</button>`
            : "";

          return `
            <div class="talent-entry" data-talent-id="${t.id}" style="
              border: 1px solid #666;
              border-radius: 4px;
              padding: 6px;
              margin-bottom: 4px;
            ">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
                <div>
                  <h3 style="margin:0; font-size:1rem;">
                    ${highlightedName}
                    ${t.origin ? `<span style="font-size:0.8rem; opacity:0.8;"> [${escapeHtml(t.origin)}]</span>` : ""}
                  </h3>
                  ${hasOptions
                    ? `<div style="font-size:0.8rem; opacity:0.8;">${highlightedCostLabel}</div>`
                    : ""}
                </div>
                <div style="display:flex; gap:4px; align-items:center;">
                  <button type="button" class="talent-toggle-desc" data-talent-id="${t.id}" style="width:1.8rem; padding:0;">
                    ${toggleSymbol}
                  </button>
                  ${castButton}
                  <button type="button" class="talent-chat-button" data-talent-id="${t.id}" data-source="${t.source}">
                    ${Lang.t("talent.ui.toChat")}
                  </button>
                </div>
              </div>
              <div class="talent-description" style="margin-top:4px; max-height:160px; overflow-y:auto; display:${displayStyle};">
                ${highlightedDescription || "<em>${Lang.t(\"talent.ui.noDescription\")}</em>"}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  const dialogId = `talent-search-dialog-${foundry.utils.randomID()}`;

  const content = `
    <div id="${dialogId}">
      <div style="margin-bottom:0.5rem;">
        <strong>${Lang.t("talent.ui.actorLabel")}:</strong> ${escapeHtml(actor.name)}
      </div>

      <div style="margin-bottom:0.5rem;">
        <label for="talent-search-input"><strong>${Lang.t("talent.ui.searchLabel")}:</strong></label>
        <input id="talent-search-input" type="text" style="width:100%; margin-top:0.25rem;"
               placeholder="${Lang.t("talent.ui.searchPlaceholder")}" />
      </div>

      <div style="margin-bottom:0.5rem; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
        <button type="button" id="talent-show-all">${Lang.t("talent.ui.showAll")}</button>
        <button type="button" id="talent-expand-all">${Lang.t("talent.ui.expandAll")}</button>
        <button type="button" id="talent-collapse-all">${Lang.t("talent.ui.collapseAll")}</button>

        <label style="display:flex; align-items:center; gap:4px; margin-left:0.5rem;">
          <input type="checkbox" id="hide-empty-desc" />
          <span style="font-size:0.9rem;">${Lang.t("talent.ui.hideNoDesc")}</span>
        </label>

        <span style="margin-left:auto; font-size:0.9rem;">
          ${Lang.t("talent.ui.countLabel")}: <span id="talent-count">${talentData.length}</span>
        </span>
      </div>

      <div id="talent-list-container">
        ${renderTalentList(talentData, false, "")}
      </div>
    </div>
  `;

  const d = new Dialog({
    title: Lang.t("talent.searchTitleFor", {actor: actor?.name ?? ""}),
    content,
    buttons: { close: { label: Lang.t("common.close") } },
    default: "close",
    render: (html) => {
      const root = html.find(`#${dialogId}`);
      const searchInput = root.find("#talent-search-input");
      const listContainer = root.find("#talent-list-container");
      const countSpan = root.find("#talent-count");
      const showAllBtn = root.find("#talent-show-all");
      const expandAllBtn = root.find("#talent-expand-all");
      const collapseAllBtn = root.find("#talent-collapse-all");
      const hideEmptyCheckbox = root.find("#hide-empty-desc");

      let hideEmpty = false;

      function updateList() {
        const rawQuery = (searchInput.val() ?? "").toString();
        const query = rawQuery.toLowerCase().trim();
        const forceExpand = !!query;

        let filtered = !query
          ? Array.from(talentData)
          : talentData.filter(t => t.searchText.includes(query));

        if (hideEmpty) {
          filtered = filtered.filter(t => stripHtml(t.description).length > 0);
        }

        countSpan.text(filtered.length);
        listContainer.html(renderTalentList(filtered, forceExpand, query));
      }

      searchInput.on("input", () => updateList());

      showAllBtn.on("click", () => {
        searchInput.val("");
        updateList();
      });

      expandAllBtn.on("click", () => {
        listContainer.find(".talent-description").show();
        listContainer.find(".talent-toggle-desc").text("▲");
      });

      collapseAllBtn.on("click", () => {
        listContainer.find(".talent-description").hide();
        listContainer.find(".talent-toggle-desc").text("▼");
      });

      hideEmptyCheckbox.on("change", ev => {
        hideEmpty = ev.currentTarget.checked;
        updateList();
      });

      async function performCast(option, talent) {
        const pool = foundry.utils.getProperty(actor, "system.stats.forcePool") ?? {};
        const current = Number(pool.value ?? 0);
        const max = Number(pool.max ?? current);
        const cost = Number(option.cost ?? 0);

        if (cost <= 0) {
          ui.notifications.warn(Lang.t("talent.error.invalidActivationCost"));
          return;
        }
        if (current < cost) {
          ui.notifications.warn(Lang.t("talent.error.notEnoughMana", {needed: `<strong>${cost}</strong>`, current: `<strong>${current}</strong>`}));
          return;
        }


        let newValue = current - cost;
        if (newValue < 0) newValue = 0;

        try {
          await actor.update({ "system.stats.forcePool.value": newValue });

          const levelInfo = (option.level != null) ? `Poziom ${option.level}` : "Wybrany wariant";

          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `
              <h2>${escapeHtml(talent.name)}</h2>
              ${talent.description || "<p><em>Brak opisu.</em></p>"}
              <hr/>
              <p><strong>${levelInfo}</strong></p>
              <p>${Lang.t("talent.castDialog.spentMana", {cost: `<strong>${cost}</strong>`})}</p>
              <p>Force Pool: ${current} ➜ <strong>${newValue}</strong> / ${max}</p>
            `
          });
        } catch (e) {
          console.error(e);
          ui.notifications.error(Lang.t("talent.error.forcePoolUpdateFailed"));
        }
      }

      root.on("click", ".talent-toggle-desc", (ev) => {
        const btn = $(ev.currentTarget);
        const entry = btn.closest(".talent-entry");
        const box = entry.find(".talent-description");
        const hidden = box.is(":hidden");
        box.toggle(hidden);
        btn.text(hidden ? "▲" : "▼");
      });

      root.on("click", ".talent-chat-button", async (ev) => {
        const btn = ev.currentTarget;
        const id = btn.dataset.talentId;
        const source = btn.dataset.source;
        const t = talentData.find(tt => tt.id === id);
        if (!t) return;

        try {
          if (source === "item") {
            const item = actor.items.get(id);
            if (item?.toChat) {
              item.toChat();
            } else if (item) {
              const desc = getTalentDescription(item) || "";
              await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `<h2>${escapeHtml(item.name)}</h2>${desc || "<p><em>Brak opisu.</em></p>"}`
              });
            }
          } else {
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: `
                <h2>${escapeHtml(t.name)}</h2>
                ${t.description || "<p><em>Brak opisu.</em></p>"}
                ${t.origin ? `<p><em>${Lang.t("talent.ui.source")}: ${escapeHtml(t.origin)}</em></p>` : ""}
              `
            });
          }
        } catch (e) {
          console.error(e);
          ui.notifications.error(Lang.t("talent.error.sendToChatFailed"));
        }
      });

      root.on("click", ".talent-cast-button", (ev) => {
        const btn = ev.currentTarget;
        const id = btn.dataset.talentId;
        const t = talentData.find(tt => tt.id === id);
        if (!t || !t.activationOptions || !t.activationOptions.length) return;

        if (t.activationOptions.length === 1) {
          performCast(t.activationOptions[0], t);
          return;
        }

        const optionsHtml = t.activationOptions.map((opt, idx) => {
          const label = (opt.level != null)
            ? `${Lang.t("talent.level")} ${opt.level} – ${Lang.t("talent.cost")}: ${opt.cost} ${Lang.t("talent.mana")}` : `${Lang.t("talent.variant")} ${idx + 1} – ${Lang.t("talent.cost")}: ${opt.cost} ${Lang.t("talent.mana")}`;

          return `
            <div style="margin-bottom:0.5rem;">
              <label>
                <input type="radio" name="spell-level" value="${idx}" ${idx === 0 ? "checked" : ""}>
                ${escapeHtml(label)}
              </label>
              <pre style="white-space:pre-wrap; border:1px solid #666; padding:4px; margin-top:2px; max-height:150px; overflow-y:auto;">${escapeHtml(opt.blockText)}</pre>
            </div>
          `;
        }).join("");

        new Dialog({
          title: `${Lang.t("talent.castSpell")} - ${t.name}`,
          content: `
            <div style="margin-bottom:0.5rem;"><strong>${Lang.t("talent.cast.chooseLevel")}</strong></div>
            <form>${optionsHtml}</form>
          `,
          buttons: {
            cast: {
              label: Lang.t("talent.cast"),
              callback: (html) => {
                const val = html.find("input[name='spell-level']:checked").val();
                const index = Number(val ?? 0);
                const opt = t.activationOptions[index];
                if (opt) performCast(opt, t);
              }
            },
            cancel: { label: Lang.t("talent.selectActor.cancel") }
          },
          default: "cast"
        }).render(true);
      });

      updateList();
    }
  }, { width: 650 });

  d.render(true);
}

function getTalentDescription(item) {
  const sys = item.system ?? {};
  return sys.longDesc || sys.description || "";
}

function stripHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function highlightTerm(html, term) {
  if (!term) return html;
  const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${safeTerm})`, "gi");
  return String(html ?? "").replace(
    regex,
    `<span style="background-color: rgba(255,0,0,0.25); border-radius: 3px;">$1</span>`
  );
}

function extractActivationOptionsFromDescription(desc) {
  if (!desc) return [];

  let text = desc;
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p\s*>/gi, "\n");
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/&nbsp;/gi, " ");

  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const lvlIndices = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/statystyki\s+na\s+(\d+)\s*lvl/i);
    if (m) lvlIndices.push({ index: i, level: parseInt(m[1]) });
  }

  const blocks = [];
  const costRx = getActivationCostRegex();

  if (lvlIndices.length) {
    for (let idx = 0; idx < lvlIndices.length; idx++) {
      const start = lvlIndices[idx].index;
      const level = lvlIndices[idx].level;
      const end = (idx + 1 < lvlIndices.length) ? lvlIndices[idx + 1].index : lines.length;
      const blockLines = lines.slice(start, end);
      const blockText = blockLines.join("\n");
      const costMatch = blockText.match(costRx);
      if (costMatch) {
        blocks.push({ level, cost: parseInt(costMatch[2]), blockText });
      }
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(costRx);
      if (m) blocks.push({ level: null, cost: parseInt(m[2]), blockText: lines[i] });
    }
  }

  return blocks;
}
