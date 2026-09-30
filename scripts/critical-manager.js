import { Lang } from "./i18n.js";
import { ownerDocumentOf } from "./popout-compat.js";

const MODULE_ID = "genesys-ffg-options-enhancer";
const CRITICAL_ITEM_TYPE = "criticalinjury";

let criticalManagerApp = null;
let hooksRegistered = false;

function t(key, data) {
  return Lang.t(`criticalManager.${key}`, data);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function folderIdOf(item) {
  return item?.folder?.id ?? item?.folder ?? null;
}

function directCriticalItems(folderId) {
  if (!folderId) return [];
  return Array.from(game.items ?? [])
    .filter(item => item?.type === CRITICAL_ITEM_TYPE && folderIdOf(item) === folderId)
    .sort((a, b) => {
      const amin = asInt(a.system?.min, Number.MAX_SAFE_INTEGER);
      const bmin = asInt(b.system?.min, Number.MAX_SAFE_INTEGER);
      return amin - bmin || String(a.name ?? "").localeCompare(String(b.name ?? ""));
    });
}

function criticalFolders() {
  const all = Array.from(game.folders ?? []).filter(folder => folder?.type === "Item");
  const candidates = all.filter(folder => {
    const name = String(folder.name ?? "").toLocaleLowerCase();
    return name.startsWith("critical injuries") || directCriticalItems(folder.id).length > 0;
  });

  candidates.sort((a, b) => {
    const an = String(a.name ?? "");
    const bn = String(b.name ?? "");
    const abase = an.toLocaleLowerCase() === "critical injuries" ? 0 : 1;
    const bbase = bn.toLocaleLowerCase() === "critical injuries" ? 0 : 1;
    return abase - bbase || an.localeCompare(bn);
  });
  return candidates;
}

function itemRange(item) {
  const min = asInt(item?.system?.min, NaN);
  const max = asInt(item?.system?.max, NaN);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

function criticalEntries(folderId) {
  return directCriticalItems(folderId)
    .map(item => ({ item, range: itemRange(item) }))
    .filter(entry => entry.range)
    .sort((a, b) => a.range.min - b.range.min || a.range.max - b.range.max);
}

function findCritical(entries, total) {
  const exact = entries.find(({ range }) => total >= range.min && total <= range.max);
  if (exact) return exact;
  if (!entries.length) return null;

  const last = entries[entries.length - 1];
  if (total > last.range.max) return last;

  return null;
}

function existingCriticals(actor) {
  return Array.from(actor?.items ?? []).filter(item => item?.type === CRITICAL_ITEM_TYPE);
}

function assignedPlayerActors() {
  const seen = new Set();
  const result = [];

  for (const user of Array.from(game.users ?? [])) {
    if (user?.isGM || !user?.character) continue;
    const actor = user.character;
    if (!actor?.id || seen.has(actor.id)) continue;
    seen.add(actor.id);
    result.push({
      actor,
      actorUuid: actor.uuid,
      actorId: actor.id,
      tokenId: null,
      label: actor.name,
      img: actor.img ?? "icons/svg/mystery-man.svg"
    });
  }

  const playerIds = new Set(Array.from(game.users ?? []).filter(u => !u?.isGM).map(u => u.id));
  for (const actor of Array.from(game.actors ?? [])) {
    if (!actor?.id || seen.has(actor.id)) continue;
    const ownership = actor.ownership ?? {};
    const playerOwned = Object.entries(ownership).some(([id, level]) => playerIds.has(id) && Number(level) >= 3);
    if (!playerOwned) continue;
    seen.add(actor.id);
    result.push({
      actor,
      actorUuid: actor.uuid,
      actorId: actor.id,
      tokenId: null,
      label: actor.name,
      img: actor.img ?? "icons/svg/mystery-man.svg"
    });
  }

  return result.sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

function controlledTokenActors() {
  const seen = new Set();
  const result = [];
  for (const token of Array.from(canvas?.tokens?.controlled ?? [])) {
    const actor = token?.actor;
    if (!actor) continue;
    const key = actor.uuid ?? `${token.id}:${actor.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      actor,
      actorUuid: actor.uuid,
      actorId: actor.id,
      tokenId: token.id,
      label: token.name || actor.name,
      img: token.document?.texture?.src ?? actor.img ?? "icons/svg/mystery-man.svg"
    });
  }
  return result;
}

function targetCandidates() {
  const controlled = controlledTokenActors();
  if (controlled.length) return { mode: "tokens", entries: controlled };
  return { mode: "players", entries: assignedPlayerActors() };
}

function actorFromRef(uuid, actorId) {
  if (uuid) {
    try {
      const doc = globalThis.fromUuidSync?.(uuid);
      if (doc?.documentName === "Actor") return doc;
    } catch (_) {}
  }
  return actorId ? game.actors?.get(actorId) ?? null : null;
}

function descriptionOf(item) {
  const description = item?.system?.description;
  if (typeof description === "string") return description;
  if (typeof description?.value === "string") return description.value;
  return "";
}

function severityOf(item) {
  const raw = item?.system?.severity?.value ?? item?.system?.severity ?? "";
  if (raw == null || raw === "") return "";
  return String(raw);
}

function stripHtml(html) {
  const text = String(html ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  return text.replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

function sourceCoverage(entries) {
  if (!entries.length) return "—";
  const min = entries[0].range.min;
  const max = entries[entries.length - 1].range.max;
  return `${min}–${max}${max <= 151 ? "+" : ""}`;
}

async function cloneCriticalToActor(item, actor, metadata) {
  const source = foundry.utils.deepClone(item.toObject());
  delete source._id;
  delete source.folder;
  delete source.sort;
  delete source.ownership;
  delete source._stats;

  source.flags ??= {};
  source.flags[MODULE_ID] ??= {};
  source.flags[MODULE_ID].criticalManager = {
    sourceUuid: item.uuid,
    sourceFolderId: metadata.folderId,
    rawRoll: metadata.rawRoll,
    total: metadata.total,
    manualModifier: metadata.manualModifier,
    existingModifier: metadata.existingModifier,
    appliedAt: Date.now()
  };

  const created = await actor.createEmbeddedDocuments("Item", [source]);
  return created?.[0] ?? null;
}

async function createCriticalChatMessage({ actor, sourceItem, folder, roll, rawRoll, total, manualModifier, existingCount, existingModifier, range }) {
  const description = descriptionOf(sourceItem);
  const severity = severityOf(sourceItem);
  const content = `
    <div class="gfoe-critical-chat-card">
      <header><i class="fa-solid fa-heart-crack"></i> <strong>${esc(t("chatTitle"))}</strong></header>
      <div class="gfoe-critical-chat-target">${esc(actor.name)} — ${esc(folder?.name ?? t("unknownTable"))}</div>
      <div class="gfoe-critical-chat-roll">
        <span>${esc(t("rollBreakdown", {
          roll: rawRoll,
          manual: manualModifier >= 0 ? `+${manualModifier}` : manualModifier,
          existing: `+${existingModifier}`,
          total
        }))}</span>
      </div>
      <div class="gfoe-critical-chat-result">
        <img src="${esc(sourceItem.img ?? "icons/svg/blood.svg")}" alt="">
        <div>
          <strong>${esc(sourceItem.name)}</strong>
          <div class="gfoe-critical-chat-meta">${esc(range.min)}–${esc(range.max)}${severity ? ` • ${esc(t("severity"))}: ${esc(severity)}` : ""}</div>
        </div>
      </div>
      ${description ? `<div class="gfoe-critical-chat-description">${description}</div>` : ""}
      <div class="gfoe-critical-chat-note">${esc(t("existingCountChat", { count: existingCount }))}</div>
    </div>`;

  const speaker = ChatMessage.getSpeaker?.({ actor }) ?? { alias: actor.name };
  await ChatMessage.create({
    user: game.user.id,
    speaker,
    content,
    rolls: roll ? [roll] : []
  });
}

export class CriticalManagerApp extends foundry.applications.api.ApplicationV2 {
  constructor(options = {}) {
    super({ ...options, window: { ...(options.window ?? {}), title: t("title") } });
    this.targetUuid = options.actorUuid ?? null;
    this.targetActorId = options.actorId ?? null;
    this.folderId = options.folderId ?? null;
    this.manualModifier = 0;
    this.lastResult = null;
  }

  static DEFAULT_OPTIONS = {
    id: "gfoe-critical-manager",
    classes: ["gfoe-critical-manager"],
    tag: "section",
    window: {
      title: "Critical Injury Manager",
      icon: "fa-solid fa-heart-crack",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 560
    }
  };

  _resolveState() {
    const targets = targetCandidates();
    if (!targets.entries.length) {
      this.targetUuid = null;
      this.targetActorId = null;
    } else {
      const found = targets.entries.find(entry => entry.actorUuid === this.targetUuid || (entry.actorId === this.targetActorId && !this.targetUuid));
      const selected = found ?? targets.entries[0];
      this.targetUuid = selected.actorUuid;
      this.targetActorId = selected.actorId;
    }

    const folders = criticalFolders();
    if (!folders.some(folder => folder.id === this.folderId)) {
      this.folderId = folders.find(folder => String(folder.name).toLocaleLowerCase() === "critical injuries")?.id ?? folders[0]?.id ?? null;
    }

    const actor = actorFromRef(this.targetUuid, this.targetActorId);
    const folder = folders.find(entry => entry.id === this.folderId) ?? null;
    const entries = folder ? criticalEntries(folder.id) : [];
    const invalidItems = folder ? directCriticalItems(folder.id).length - entries.length : 0;
    const crits = existingCriticals(actor);
    const existingModifier = crits.length * 10;

    return { targets, actor, folders, folder, entries, invalidItems, crits, existingModifier };
  }

  async _renderHTML() {
    const { targets, actor, folders, folder, entries, invalidItems, crits, existingModifier } = this._resolveState();
    const template = ownerDocumentOf(this).createElement("template");

    const targetOptions = targets.entries.map(entry =>
      `<option value="${esc(entry.actorUuid ?? entry.actorId)}" data-actor-id="${esc(entry.actorId)}" ${entry.actorUuid === this.targetUuid || (!entry.actorUuid && entry.actorId === this.targetActorId) ? "selected" : ""}>${esc(entry.label)}</option>`
    ).join("");

    const folderOptions = folders.map(entry => {
      const count = directCriticalItems(entry.id).filter(item => itemRange(item)).length;
      return `<option value="${esc(entry.id)}" ${entry.id === this.folderId ? "selected" : ""}>${esc(entry.name)} (${count})</option>`;
    }).join("");

    const criticalList = crits.length
      ? crits.map(item => `<span class="gfoe-critical-existing-chip"><img src="${esc(item.img ?? "icons/svg/blood.svg")}" alt="">${esc(item.name)}</span>`).join("")
      : `<span class="gfoe-critical-muted">${esc(t("noExistingCriticals"))}</span>`;

    let resultHtml = "";
    if (this.lastResult) {
      resultHtml = `
        <section class="gfoe-critical-section gfoe-critical-last-result">
          <h3><i class="fa-solid fa-dice-d20"></i> ${esc(t("lastResult"))}</h3>
          <div class="gfoe-critical-result-roll">${esc(this.lastResult.total)}</div>
          <div class="gfoe-critical-result-item">
            <img src="${esc(this.lastResult.img)}" alt="">
            <div>
              <strong>${esc(this.lastResult.name)}</strong>
              <div>${esc(this.lastResult.range)}${this.lastResult.severity ? ` • ${esc(t("severity"))}: ${esc(this.lastResult.severity)}` : ""}</div>
            </div>
          </div>
          ${this.lastResult.description ? `<p>${esc(this.lastResult.description)}</p>` : ""}
          <div class="gfoe-critical-applied"><i class="fa-solid fa-check"></i> ${esc(t("addedToActor", { actor: this.lastResult.actorName }))}</div>
        </section>`;
    }

    const canRoll = Boolean(actor && folder && entries.length);
    const targetModeHint = targets.mode === "tokens" ? t("selectedTokenHint") : t("playerListHint");

    template.innerHTML = `
      <div class="gfoe-critical-root">
        <section class="gfoe-critical-section">
          <h3><i class="fa-solid fa-user-injured"></i> ${esc(t("target"))}</h3>
          ${targets.entries.length ? `
            <div class="gfoe-critical-target-row">
              ${actor ? `<img src="${esc(actor.img ?? "icons/svg/mystery-man.svg")}" alt="">` : ""}
              <select data-role="target-select">${targetOptions}</select>
            </div>
            <p class="gfoe-critical-muted">${esc(targetModeHint)}</p>
          ` : `<div class="gfoe-critical-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(t("noTargets"))}</div>`}
        </section>

        <section class="gfoe-critical-section">
          <h3><i class="fa-solid fa-folder-open"></i> ${esc(t("criticalType"))}</h3>
          ${folders.length ? `
            <select data-role="folder-select">${folderOptions}</select>
            <div class="gfoe-critical-source-summary">
              <span><strong>${entries.length}</strong> ${esc(t("entriesLoaded"))}</span>
              <span>${esc(t("coverage"))}: <strong>${esc(sourceCoverage(entries))}</strong></span>
            </div>
            ${invalidItems > 0 ? `<div class="gfoe-critical-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(t("invalidEntries", { count: invalidItems }))}</div>` : ""}
          ` : `<div class="gfoe-critical-warning"><i class="fa-solid fa-folder-minus"></i> ${esc(t("noFolders"))}</div>`}
        </section>

        <section class="gfoe-critical-section">
          <h3><i class="fa-solid fa-calculator"></i> ${esc(t("modifier"))}</h3>
          <div class="gfoe-critical-mod-grid">
            <label>
              <span>${esc(t("manualModifier"))}</span>
              <input type="number" step="1" value="${esc(this.manualModifier)}" data-role="manual-modifier">
            </label>
            <div class="gfoe-critical-auto-mod">
              <span>${esc(t("existingCriticals"))}</span>
              <strong>${crits.length} × 10 = +${existingModifier}</strong>
            </div>
            <div class="gfoe-critical-total-mod">
              <span>${esc(t("totalModifier"))}</span>
              <strong data-role="total-modifier">${this.manualModifier + existingModifier >= 0 ? "+" : ""}${this.manualModifier + existingModifier}</strong>
            </div>
          </div>
          <div class="gfoe-critical-existing-list">${criticalList}</div>
        </section>

        <button type="button" class="gfoe-critical-roll-button" data-action="roll-critical" ${canRoll ? "" : "disabled"}>
          <i class="fa-solid fa-dice-d20"></i> ${esc(t("rollCritical"))}
        </button>

        ${resultHtml}
      </div>`;
    return template.content;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element?.querySelector?.(".gfoe-critical-root");
    if (!root) return;

    root.querySelector("[data-role='target-select']")?.addEventListener("change", event => {
      const option = event.currentTarget.selectedOptions?.[0];
      this.targetUuid = event.currentTarget.value || null;
      this.targetActorId = option?.dataset?.actorId ?? null;
      this.lastResult = null;
      this.render({ force: true });
    });

    root.querySelector("[data-role='folder-select']")?.addEventListener("change", event => {
      this.folderId = event.currentTarget.value || null;
      this.lastResult = null;
      this.render({ force: true });
    });

    const manual = root.querySelector("[data-role='manual-modifier']");
    const total = root.querySelector("[data-role='total-modifier']");
    manual?.addEventListener("input", event => {
      this.manualModifier = asInt(event.currentTarget.value, 0);
      const actor = actorFromRef(this.targetUuid, this.targetActorId);
      const existingModifier = existingCriticals(actor).length * 10;
      const value = this.manualModifier + existingModifier;
      if (total) total.textContent = `${value >= 0 ? "+" : ""}${value}`;
    });

    root.querySelector("[data-action='roll-critical']")?.addEventListener("click", async event => {
      event.preventDefault();
      if (event.currentTarget.disabled) return;
      event.currentTarget.disabled = true;
      try {
        this.manualModifier = asInt(manual?.value, 0);
        await this._rollCritical();
      } catch (err) {
        console.error(`${MODULE_ID} | critical manager roll failed`, err);
        ui.notifications?.error(err?.message ?? t("errors.generic"));
      } finally {
        if (this.rendered) await this.render({ force: true });
      }
    });
  }

  async _rollCritical() {
    if (!game.user?.isGM) throw new Error(t("errors.gmOnly"));

    const { actor, folder, entries, crits, existingModifier } = this._resolveState();
    if (!actor) throw new Error(t("errors.noTarget"));
    if (!folder) throw new Error(t("errors.noFolder"));
    if (!entries.length) throw new Error(t("errors.noValidEntries"));

    const roll = await new Roll("1d100").evaluate();
    const rawRoll = asInt(roll.total, 1);
    const total = Math.max(1, rawRoll + this.manualModifier + existingModifier);
    const selected = findCritical(entries, total);
    if (!selected) throw new Error(t("errors.noMatchingRange", { total }));

    const created = await cloneCriticalToActor(selected.item, actor, {
      folderId: folder.id,
      rawRoll,
      total,
      manualModifier: this.manualModifier,
      existingModifier
    });
    if (!created) throw new Error(t("errors.applyFailed"));

    const description = stripHtml(descriptionOf(selected.item));
    this.lastResult = {
      name: selected.item.name,
      img: selected.item.img ?? "icons/svg/blood.svg",
      range: `${selected.range.min}–${selected.range.max}${total > selected.range.max ? "+" : ""}`,
      severity: severityOf(selected.item),
      description,
      total,
      actorName: actor.name
    };

    await createCriticalChatMessage({
      actor,
      sourceItem: selected.item,
      folder,
      roll,
      rawRoll,
      total,
      manualModifier: this.manualModifier,
      existingCount: crits.length,
      existingModifier,
      range: selected.range
    });

    ui.notifications?.info(t("notifications.applied", { injury: selected.item.name, actor: actor.name }));
  }
}

export function openCriticalManager(options = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(t("errors.gmOnly"));
    return null;
  }

  const controlled = controlledTokenActors();
  const initial = controlled.length === 1 ? controlled[0] : null;
  const actorUuid = options.actorUuid ?? initial?.actorUuid ?? null;
  const actorId = options.actorId ?? initial?.actorId ?? null;

  if (!criticalManagerApp) criticalManagerApp = new CriticalManagerApp({ actorUuid, actorId });
  else {
    if (actorUuid || actorId) {
      criticalManagerApp.targetUuid = actorUuid;
      criticalManagerApp.targetActorId = actorId;
    }
  }

  criticalManagerApp.render({ force: true });
  return criticalManagerApp;
}

export function initializeCriticalManager() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  Hooks.on("controlToken", () => {
    try {
      if (!criticalManagerApp?.rendered) return;
      const controlled = controlledTokenActors();
      if (controlled.length === 1) {
        criticalManagerApp.targetUuid = controlled[0].actorUuid;
        criticalManagerApp.targetActorId = controlled[0].actorId;
      }
      criticalManagerApp.lastResult = null;
      criticalManagerApp.render({ force: true });
    } catch (_) {}
  });

  for (const hook of ["createItem", "updateItem", "deleteItem", "createFolder", "updateFolder", "deleteFolder"]) {
    Hooks.on(hook, () => {
      try {
        if (criticalManagerApp?.rendered) criticalManagerApp.render({ force: true });
      } catch (_) {}
    });
  }
}
