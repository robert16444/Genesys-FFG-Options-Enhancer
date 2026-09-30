import { Lang } from "./i18n.js";
import { isElementLike, ownerDocumentOf, registerPopOutDocumentInitializer } from "./popout-compat.js";

const MODULE_ID = "genesys-ffg-options-enhancer";
const FEATURE_SETTING = "enableWeaponAutomation";
const DAMAGE_FLAG = "weaponDamageCard";
const SOURCE_FLAG = "weaponAutomation";
const QUALITY_EFFECT_FLAG = "weaponQualityEffect";

const MSG = Object.freeze({
  APPLY_DAMAGE: "WEAPON_AUTOMATION_APPLY_DAMAGE",
  FEEDBACK: "WEAPON_AUTOMATION_FEEDBACK"
});

const QUALITY_ALIASES = Object.freeze([
  ["stundamage", ["stun damage"]],
  ["slowfiring", ["slow-firing", "slow firing"]],
  ["limitedammo", ["limited ammo"]],
  ["autofire", ["auto-fire", "auto fire", "autofire"]],
  ["accurate", ["accurate"]],
  ["breach", ["breach"]],
  ["burn", ["burn"]],
  ["blast", ["blast"]],
  ["concussive", ["concussive"]],
  ["cortosis", ["cortosis"]],
  ["cumbersome", ["cumbersome"]],
  ["defensive", ["defensive"]],
  ["deflection", ["deflection"]],
  ["disorient", ["disorient"]],
  ["ensnare", ["ensnare"]],
  ["guided", ["guided"]],
  ["inaccurate", ["inaccurate"]],
  ["inferior", ["inferior"]],
  ["ion", ["ion"]],
  ["linked", ["linked"]],
  ["knockdown", ["knockdown"]],
  ["pierce", ["pierce"]],
  ["prepare", ["prepare"]],
  ["stun", ["stun"]],
  ["sunder", ["sunder"]],
  ["superior", ["superior"]],
  ["tractor", ["tractor"]],
  ["vicious", ["vicious"]]
]);

const ACTIVE_QUALITIES = Object.freeze({
  autofire: { advantage: 2, triumph: 1, maxActivations: null, targetMode: null },
  burn: { advantage: 2, triumph: 1, maxActivations: 1, targetMode: "targeted" },
  blast: { advantage: 2, triumph: 1, maxActivations: 1, targetMode: "targeted" },
  concussive: { advantage: 2, triumph: 1, maxActivations: 1, targetMode: "targeted" },
  disorient: { advantage: 2, triumph: 1, maxActivations: 1, targetMode: "targeted" },
  ensnare: { advantage: 2, triumph: 1, maxActivations: 1, targetMode: "targeted" },
  guided: { advantage: 3, triumph: 1, maxActivations: 1, targetMode: "targeted" },
  linked: { advantage: 2, triumph: 1, maxActivations: "rank", targetMode: null },
  knockdown: { advantage: 2, triumph: 1, maxActivations: 1, targetMode: "targeted", silhouetteCost: true },
  stun: { advantage: 2, triumph: 1, maxActivations: 1, targetMode: "targeted" },
  sunder: { advantage: 1, triumph: 1, maxActivations: null, targetMode: "targeted" }
});

let hooksRegistered = false;
let rollBuilderHookRegistered = false;
const boundDocuments = new WeakSet();
const preparedRollBuilders = new WeakSet();

function isEnabled() {
  try { return game.settings.get(MODULE_ID, FEATURE_SETTING); }
  catch (_) { return true; }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cloneData(value) {
  if (value == null) return value;
  try { return foundry.utils.deepClone(value); }
  catch (_) { return JSON.parse(JSON.stringify(value)); }
}

function safeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : Math.trunc(Number(fallback) || 0);
}

function safeNonNegativeInt(value, fallback = 0) {
  return Math.max(0, safeInt(value, fallback));
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return stripHtml(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalQualityKey(name) {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  for (const [key, aliases] of QUALITY_ALIASES) {
    if (aliases.some(alias => normalized === alias || normalized.startsWith(`${alias} `))) return key;
  }
  return null;
}

function qualityRank(entry) {
  const candidates = [
    entry?.system?.rank,
    entry?.rank,
    entry?.totalRanks,
    entry?.system?.totalRanks,
    entry?.value
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n)) return Math.max(1, Math.trunc(n));
  }
  return 1;
}

function rawWeaponSystem(weapon) {
  return weapon?.system ?? weapon?.data?.data ?? weapon?._source?.system ?? null;
}

function isWeaponLike(weapon) {
  if (!weapon) return false;
  const type = String(weapon.type ?? weapon?._source?.type ?? "").toLowerCase();
  const system = rawWeaponSystem(weapon);
  return ["weapon", "shipweapon"].includes(type) || Boolean(system?.damage && (system?.itemmodifier || system?.doNotSubmit?.qualities));
}

export function extractWeaponQualities(weapon) {
  if (!weapon) return {};
  const system = rawWeaponSystem(weapon) ?? {};
  if (!Array.isArray(system.itemmodifier) && !system?.doNotSubmit?.qualities) return {};
  const result = {};
  const source = Array.isArray(system.itemmodifier) ? system.itemmodifier : [];

  if (source.length) {
    for (const entry of source) {
      const key = canonicalQualityKey(entry?.name ?? entry?.label ?? entry?.system?.name);
      if (!key) continue;
      const rank = qualityRank(entry);
      result[key] = {
        key,
        rank: (result[key]?.rank ?? 0) + rank,
        name: stripHtml(entry?.name ?? entry?.label ?? qualityLabel(key)),
        source: cloneData(entry)
      };
    }
    return result;
  }

  const derived = system?.doNotSubmit?.qualities;
  const list = Array.isArray(derived) ? derived : (derived && typeof derived === "object" ? Object.values(derived) : []);
  for (const entry of list) {
    const key = canonicalQualityKey(entry?.name ?? entry?.label);
    if (!key) continue;
    const rank = qualityRank(entry);
    result[key] = {
      key,
      rank: Math.max(result[key]?.rank ?? 0, rank),
      name: stripHtml(entry?.name ?? entry?.label ?? qualityLabel(key)),
      source: cloneData(entry)
    };
  }
  return result;
}

function qualityLabel(key) {
  const localized = Lang.t(`weaponAutomation.qualities.${key}.name`);
  return localized && localized !== `weaponAutomation.qualities.${key}.name`
    ? localized
    : key;
}

function qualityDescription(key) {
  const localized = Lang.t(`weaponAutomation.qualities.${key}.description`);
  return localized && localized !== `weaponAutomation.qualities.${key}.description`
    ? localized
    : "";
}

function qualityHasConfiguredAttributes(quality) {
  const attributes = quality?.source?.system?.attributes ?? quality?.source?.attributes ?? null;
  return Boolean(attributes && typeof attributes === "object" && Object.keys(attributes).length);
}

function findFfgRoll(message) {
  const rolls = Array.isArray(message?.rolls) ? message.rolls : Array.from(message?.rolls ?? []);
  return rolls.find(roll => roll?.ffg && typeof roll.ffg === "object") ?? null;
}

function weaponDataFromRoll(message) {
  const roll = findFfgRoll(message);
  const data = roll?.data;
  if (!data || !isWeaponLike(data)) return null;
  return data;
}

function resolveSourceActor(message) {
  const speaker = message?.speaker ?? {};
  const sceneId = typeof speaker.scene === "string" ? speaker.scene : speaker.scene?.id;
  const tokenId = typeof speaker.token === "string" ? speaker.token : speaker.token?.id;
  if (sceneId && tokenId) {
    const token = game.scenes?.get?.(sceneId)?.tokens?.get?.(tokenId);
    if (token?.actor) return token.actor;
  }
  const actorId = typeof speaker.actor === "string" ? speaker.actor : speaker.actor?.id;
  if (actorId) return game.actors?.get?.(actorId) ?? null;
  return null;
}

function resolveLiveWeapon(message, rollWeapon = null) {
  const data = rollWeapon ?? weaponDataFromRoll(message);
  if (!data) return null;
  if (data.documentName === "Item") return data;
  const actor = resolveSourceActor(message);
  const id = data?._id ?? data?.id;
  if (actor && id) return actor.items?.get?.(id) ?? null;
  return null;
}

function weaponDamageBase(weapon) {
  const system = rawWeaponSystem(weapon) ?? {};
  const adjusted = Number(system?.damage?.adjusted);
  if (Number.isFinite(adjusted) && adjusted !== 0) return adjusted;
  const value = Number(system?.damage?.value);
  return Number.isFinite(value) ? value : 0;
}

function weaponCrit(weapon) {
  const system = rawWeaponSystem(weapon) ?? {};
  const adjusted = Number(system?.crit?.adjusted);
  if (Number.isFinite(adjusted) && adjusted !== 0) return adjusted;
  const value = Number(system?.crit?.value);
  return Number.isFinite(value) ? value : 0;
}

export function getWeaponRollContext(message) {
  const roll = findFfgRoll(message);
  const weapon = weaponDataFromRoll(message);
  if (!roll || !weapon) return null;

  const qualities = extractWeaponQualities(weapon);
  const successes = safeNonNegativeInt(roll?.ffg?.success, 0);
  let baseDamage = weaponDamageBase(weapon);

  if (qualities.superior && !qualityHasConfiguredAttributes(qualities.superior)) baseDamage += 1;
  if (qualities.inferior && !qualityHasConfiguredAttributes(qualities.inferior)) baseDamage -= 1;
  baseDamage = Math.max(0, safeInt(baseDamage, 0));
  const name = String(weapon?.name ?? weapon?._source?.name ?? Lang.t("weaponAutomation.weapon"));
  const weaponId = weapon?._id ?? weapon?.id ?? null;
  const liveWeapon = resolveLiveWeapon(message, weapon);

  return {
    roll,
    weapon,
    liveWeapon,
    weaponId,
    weaponUuid: liveWeapon?.uuid ?? weapon?.uuid ?? weapon?.flags?.starwarsffg?.uuid ?? null,
    weaponName: name,
    actor: resolveSourceActor(message),
    actorId: resolveSourceActor(message)?.id ?? message?.speaker?.actor ?? null,
    baseDamage,
    crit: weaponCrit(weapon),
    successes,
    hit: successes > 0,
    rawDamage: Math.max(0, safeInt(baseDamage, 0) + successes),
    qualities
  };
}

function qualityRankFromContext(context, key) {
  return Math.max(0, safeInt(context?.qualities?.[key]?.rank, 0));
}

function hasQuality(context, key) {
  return qualityRankFromContext(context, key) > 0;
}

function snapshotContext(context) {
  if (!context) return null;
  const qualityRanks = {};
  for (const [key, data] of Object.entries(context.qualities ?? {})) qualityRanks[key] = safeNonNegativeInt(data?.rank, 0);
  return {
    weaponId: context.weaponId ?? null,
    weaponUuid: context.weaponUuid ?? null,
    weaponName: context.weaponName,
    actorId: context.actorId ?? null,
    baseDamage: safeInt(context.baseDamage, 0),
    crit: safeInt(context.crit, 0),
    successes: safeNonNegativeInt(context.successes, 0),
    hit: Boolean(context.hit),
    rawDamage: safeNonNegativeInt(context.rawDamage, 0),
    qualities: qualityRanks
  };
}

function contextFromSnapshot(snapshot) {
  if (!snapshot) return null;
  const qualities = {};
  for (const [key, rank] of Object.entries(snapshot.qualities ?? {})) {
    qualities[key] = { key, rank: safeNonNegativeInt(rank, 0), name: qualityLabel(key) };
  }
  return {
    weaponId: snapshot.weaponId,
    weaponUuid: snapshot.weaponUuid,
    weaponName: snapshot.weaponName,
    actorId: snapshot.actorId,
    baseDamage: safeInt(snapshot.baseDamage, 0),
    crit: safeInt(snapshot.crit, 0),
    successes: safeNonNegativeInt(snapshot.successes, 0),
    hit: Boolean(snapshot.hit),
    rawDamage: safeNonNegativeInt(snapshot.rawDamage, 0),
    qualities
  };
}

function getMessageAuthorUser(message) {
  const raw = message?.author ?? message?.user ?? null;
  if (raw?.id) return raw;
  const id = typeof raw === "string" ? raw : message?.user?.id ?? null;
  return id ? game.users?.get?.(id) ?? null : null;
}

function getRollOwnerTargetActors(message) {
  const user = getMessageAuthorUser(message);
  if (!user) return [];
  const out = [];
  const seen = new Set();
  const add = tokenLike => {
    const doc = tokenLike?.document ?? tokenLike;
    if (!doc?.actor) return;
    const ref = doc.uuid ?? doc.id;
    if (seen.has(ref)) return;
    seen.add(ref);
    out.push({ actor: doc.actor, tokenDocument: doc, ref, label: doc.name || doc.actor.name || "Actor" });
  };
  try { for (const target of Array.from(user.targets ?? [])) add(target); } catch (_) {}
  return out;
}

function actorSilhouette(actor) {
  if (!actor) return 1;
  const candidates = [
    actor.system?.stats?.silhouette?.value,
    actor.system?.stats?.silhouette,
    actor.system?.silhouette?.value,
    actor.system?.silhouette
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return 1;
}

function knockdownAdvantageCost(message) {
  const target = getRollOwnerTargetActors(message)[0]?.actor ?? null;
  return 2 + Math.max(0, actorSilhouette(target) - 1);
}

export function getWeaponQualitySpendOptions(message) {
  if (!isEnabled()) return [];
  const context = getWeaponRollContext(message);
  if (!context) return [];

  const options = [];
  for (const [key, definition] of Object.entries(ACTIVE_QUALITIES)) {
    const rank = qualityRankFromContext(context, key);
    if (rank <= 0) continue;

    // Most active qualities require a successful hit. Blast may also be triggered
    // on a miss for 3 Advantage, and Guided is specifically a follow-up after a miss.
    if (key === "guided" && context.hit) continue;
    if (key !== "guided" && key !== "blast" && !context.hit) continue;

    let advCost = definition.silhouetteCost ? knockdownAdvantageCost(message) : definition.advantage;
    if (key === "blast" && !context.hit) advCost = 3;
    const maxActivations = definition.maxActivations === "rank" ? rank : definition.maxActivations;
    const baseAutomation = {
      type: "weaponQuality",
      quality: key,
      rank,
      targetMode: definition.targetMode,
      activationKey: `weapon-quality:${message.id}:${key}`,
      maxActivations: maxActivations == null ? null : Math.max(1, safeInt(maxActivations, 1)),
      weaponSnapshot: snapshotContext(context)
    };

    const suffix = rank > 1 ? ` ${rank}` : "";
    const title = Lang.t("weaponAutomation.activateQuality", { quality: `${qualityLabel(key)}${suffix}` });
    const description = qualityDescription(key);

    if (Number.isFinite(Number(advCost)) && Number(advCost) > 0) {
      options.push({
        id: `weapon-quality-${key}-advantage`,
        symbol: "advantage",
        cost: Math.max(1, safeInt(advCost, 1)),
        title,
        description,
        builtin: true,
        context: "weapon",
        automation: cloneData(baseAutomation)
      });
    }

    options.push({
      id: `weapon-quality-${key}-triumph`,
      symbol: "triumph",
      cost: 1,
      title,
      description,
      builtin: true,
      context: "weapon",
      automation: cloneData(baseAutomation)
    });
  }
  return options;
}

function getPrimaryGM() {
  return Array.from(game.users ?? [])
    .filter(user => user?.active && user?.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

function isPrimaryGM() {
  return Boolean(game.user?.isGM && getPrimaryGM()?.id === game.user.id);
}

async function sendFeedback(userId, message, level = "warn") {
  if (!userId || userId === game.user?.id) {
    ui.notifications?.[level]?.(message);
    return;
  }
  game.socket?.emit?.(`module.${MODULE_ID}`, { type: MSG.FEEDBACK, toUserId: userId, message, level });
}

function damageCardFlag(message) {
  try { return message?.getFlag?.(MODULE_ID, DAMAGE_FLAG) ?? null; }
  catch (_) { return null; }
}

function sourceAutomationFlag(message) {
  try { return message?.getFlag?.(MODULE_ID, SOURCE_FLAG) ?? null; }
  catch (_) { return null; }
}

function renderQualityBadges(snapshot) {
  const interesting = ["pierce", "breach", "stundamage", "ion", "vicious", "blast", "burn", "linked", "autofire"];
  return interesting
    .filter(key => safeNonNegativeInt(snapshot?.qualities?.[key], 0) > 0)
    .map(key => {
      const rank = safeNonNegativeInt(snapshot.qualities[key], 0);
      const ranked = ["pierce", "breach", "vicious", "blast", "burn", "linked"].includes(key);
      return `<span class="gfoe-weapon-quality-badge">${escapeHtml(qualityLabel(key))}${ranked && rank > 0 ? ` ${rank}` : ""}</span>`;
    }).join("");
}

async function createDamageCard(sourceMessage, snapshot, {
  rawDamage = snapshot?.rawDamage ?? 0,
  kind = "hit",
  title = null,
  note = "",
  allowMultipleTargets = false,
  targetName = null
} = {}) {
  const id = foundry.utils.randomID();
  const safeDamage = Math.max(0, safeInt(rawDamage, 0));
  const cardTitle = title || Lang.t("weaponAutomation.damageCard.title");
  const breakdown = kind === "hit" || kind === "extraHit"
    ? Lang.t("weaponAutomation.damageCard.breakdown", { base: snapshot.baseDamage, successes: snapshot.successes, total: safeDamage })
    : Lang.t("weaponAutomation.damageCard.flatDamage", { total: safeDamage });

  const content = `<div class="gfoe-weapon-damage-card" data-gfoe-damage-card-id="${escapeHtml(id)}">
    <div class="gfoe-weapon-card-title"><i class="fa-solid fa-burst"></i> ${escapeHtml(cardTitle)}</div>
    <div class="gfoe-weapon-card-weapon"><b>${escapeHtml(snapshot.weaponName || Lang.t("weaponAutomation.weapon"))}</b>${targetName ? ` → <b>${escapeHtml(targetName)}</b>` : ""}</div>
    <div class="gfoe-weapon-card-damage">${escapeHtml(breakdown)}</div>
    <div class="gfoe-weapon-quality-badges">${renderQualityBadges(snapshot)}</div>
    ${note ? `<div class="gfoe-weapon-card-note">${escapeHtml(note)}</div>` : ""}
    <button type="button" class="gfoe-apply-weapon-damage"><i class="fa-solid fa-heart-crack"></i> ${escapeHtml(Lang.t("weaponAutomation.damageCard.apply"))}</button>
  </div>`;

  const flag = {
    id,
    sourceMessageId: sourceMessage?.id ?? null,
    kind,
    rawDamage: safeDamage,
    allowMultipleTargets: Boolean(allowMultipleTargets),
    targetName: targetName ?? null,
    weapon: cloneData(snapshot),
    applications: []
  };

  const data = {
    content,
    speaker: sourceMessage?.speaker ?? { alias: snapshot.weaponName || Lang.t("weaponAutomation.weapon") },
    flags: { [MODULE_ID]: { [DAMAGE_FLAG]: flag } }
  };
  const whisper = Array.isArray(sourceMessage?.whisper)
    ? sourceMessage.whisper.map(user => typeof user === "string" ? user : user?.id).filter(Boolean)
    : [];
  if (whisper.length) data.whisper = whisper;
  if (sourceMessage?.blind) data.blind = true;
  return ChatMessage.create(data);
}

async function publishBaseDamage(message) {
  const context = getWeaponRollContext(message);
  if (!context || !context.hit) throw new Error(Lang.t("weaponAutomation.errors.notSuccessfulWeaponRoll"));
  const previous = sourceAutomationFlag(message) ?? {};
  if (previous.damagePublishedMessageId) {
    const existing = game.messages?.get?.(previous.damagePublishedMessageId);
    if (existing) return existing;
  }
  const snapshot = snapshotContext(context);
  const card = await createDamageCard(message, snapshot, { rawDamage: snapshot.rawDamage, kind: "hit" });
  await message.setFlag(MODULE_ID, SOURCE_FLAG, {
    ...previous,
    damagePublishedMessageId: card.id,
    damagePublishedAt: Date.now()
  });
  return card;
}

function renderWeaponRollControls(message, html) {
  if (!isEnabled() || !game.user?.isGM) return;
  const context = getWeaponRollContext(message);
  if (!context || !context.hit) return;
  const root = isElementLike(html) ? html : (isElementLike(html?.[0]) ? html[0] : null);
  if (!root || root.querySelector(".gfoe-publish-weapon-damage")) return;
  const target = root.querySelector(".message-content") ?? root;
  const wrapper = ownerDocumentOf(target).createElement("div");
  wrapper.className = "gfoe-weapon-roll-actions";
  const published = Boolean(sourceAutomationFlag(message)?.damagePublishedMessageId);
  wrapper.innerHTML = `<button type="button" class="gfoe-publish-weapon-damage" data-message-id="${escapeHtml(message.id)}" ${published ? "disabled" : ""}>
    <i class="fa-solid fa-burst"></i> ${escapeHtml(published ? Lang.t("weaponAutomation.damagePublished") : Lang.t("weaponAutomation.publishDamage"))}
  </button>`;
  target.appendChild(wrapper);
}

function bindDocument(doc) {
  if (!doc?.addEventListener || boundDocuments.has(doc)) return;
  boundDocuments.add(doc);
  doc.addEventListener("click", onDocumentClick, true);
}

async function onDocumentClick(event) {
  const publish = event.target?.closest?.(".gfoe-publish-weapon-damage");
  if (publish) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user?.isGM) return;
    const message = game.messages?.get?.(publish.dataset.messageId);
    if (!message) return ui.notifications?.warn(Lang.t("weaponAutomation.errors.sourceMessageMissing"));
    publish.disabled = true;
    try {
      await publishBaseDamage(message);
      publish.innerHTML = `<i class="fa-solid fa-check"></i> ${escapeHtml(Lang.t("weaponAutomation.damagePublished"))}`;
    } catch (err) {
      publish.disabled = false;
      console.error(`${MODULE_ID} | weapon automation | publish damage failed`, err);
      ui.notifications?.error(err?.message || Lang.t("weaponAutomation.errors.generic"));
    }
    return;
  }

  const apply = event.target?.closest?.(".gfoe-apply-weapon-damage");
  if (apply) {
    event.preventDefault();
    event.stopPropagation();
    const cardRoot = apply.closest?.("[data-message-id]") ?? apply.closest?.("[data-document-id]") ?? apply.closest?.("[data-entry-id]");
    const messageId = cardRoot?.dataset?.messageId ?? cardRoot?.dataset?.documentId ?? cardRoot?.dataset?.entryId;
    const message = messageId ? game.messages?.get?.(messageId) : null;
    if (!message || !damageCardFlag(message)) return ui.notifications?.warn(Lang.t("weaponAutomation.errors.damageCardMissing"));

    const targetRef = resolveSelectedDamageTargetRef(game.user);
    if (!targetRef) return;
    apply.disabled = true;
    try {
      await requestApplyDamage(message.id, targetRef);
    } finally {
      setTimeout(() => { try { apply.disabled = false; } catch (_) {} }, 500);
    }
  }
}

function ownedSceneTokensForActor(actor, user) {
  const scene = globalThis.canvas?.scene;
  if (!scene || !actor) return [];
  return Array.from(scene.tokens ?? []).filter(tokenDoc => {
    if (tokenDoc.actor?.id !== actor.id) return false;
    try { return user?.isGM || tokenDoc.actor?.testUserPermission?.(user, "OWNER"); }
    catch (_) { return false; }
  });
}

function resolveSelectedDamageTargetRef(user) {
  const controlled = Array.from(globalThis.canvas?.tokens?.controlled ?? []).filter(token => {
    try { return user?.isGM || token.actor?.testUserPermission?.(user, "OWNER"); }
    catch (_) { return false; }
  });
  if (controlled.length > 1) {
    ui.notifications?.warn(Lang.t("weaponAutomation.errors.selectOneToken"));
    return null;
  }
  if (controlled.length === 1) return controlled[0].document?.uuid ?? controlled[0].actor?.uuid ?? null;

  const character = user?.character ?? null;
  const tokens = ownedSceneTokensForActor(character, user);
  if (tokens.length > 1) {
    ui.notifications?.warn(Lang.t("weaponAutomation.errors.selectOneToken"));
    return null;
  }
  if (tokens.length === 1) return tokens[0].uuid;
  if (character) return character.uuid;

  ui.notifications?.warn(Lang.t("weaponAutomation.errors.noDamageTarget"));
  return null;
}

async function requestApplyDamage(cardMessageId, targetRef) {
  const gm = getPrimaryGM();
  if (!gm) return ui.notifications?.error(Lang.t("weaponAutomation.errors.noGM"));
  const payload = {
    type: MSG.APPLY_DAMAGE,
    cardMessageId,
    targetRef,
    requestingUserId: game.user.id
  };
  if (isPrimaryGM()) await processApplyDamage(payload);
  else game.socket?.emit?.(`module.${MODULE_ID}`, payload);
}

async function resolveActorRef(ref) {
  if (!ref) return { actor: null, tokenDocument: null };
  try {
    const doc = await fromUuid(ref);
    if (doc?.documentName === "Token") return { actor: doc.actor ?? null, tokenDocument: doc };
    if (doc?.documentName === "Actor") return { actor: doc, tokenDocument: null };
  } catch (_) {}
  return { actor: null, tokenDocument: null };
}

function isEquippedItem(item) {
  if (!item) return false;
  const candidates = [
    item.system?.equipped,
    item.system?.equipped?.value,
    item.system?.equippable?.equipped,
    item.system?.equippable?.equipped?.value,
    item.system?.isEquipped
  ];
  for (const value of candidates) {
    if (typeof value === "boolean") return value;
    if (value === 0 || value === 1) return Boolean(value);
  }
  return true;
}

function actorHasCortosis(actor) {
  for (const item of Array.from(actor?.items ?? [])) {
    const type = String(item?.type ?? "").toLowerCase();
    if (!new Set(["armour", "armor", "gear"]).has(type)) continue;
    if (!isEquippedItem(item)) continue;
    if (safeNonNegativeInt(extractWeaponQualities(item)?.cortosis?.rank, 0) > 0) return true;
  }
  return false;
}

function targetStats(actor) {
  const stats = actor?.system?.stats ?? {};
  if (stats.soak !== undefined) {
    return {
      scale: "personal",
      soak: safeNonNegativeInt(stats?.soak?.value ?? stats?.soak, 0),
      woundPath: "system.stats.wounds.value",
      woundValue: safeNonNegativeInt(stats?.wounds?.value ?? stats?.wounds, 0),
      strainPath: stats?.strain !== undefined ? "system.stats.strain.value" : null,
      strainValue: safeNonNegativeInt(stats?.strain?.value ?? stats?.strain, 0)
    };
  }
  if (stats.armour !== undefined || stats.armor !== undefined) {
    const armour = stats.armour ?? stats.armor;
    return {
      scale: "vehicle",
      soak: safeNonNegativeInt(armour?.value ?? armour, 0),
      woundPath: "system.stats.hullTrauma.value",
      woundValue: safeNonNegativeInt(stats?.hullTrauma?.value ?? stats?.hullTrauma, 0),
      strainPath: stats?.systemStrain !== undefined ? "system.stats.systemStrain.value" : null,
      strainValue: safeNonNegativeInt(stats?.systemStrain?.value ?? stats?.systemStrain, 0)
    };
  }
  return null;
}

function damageCalculation(actor, cardFlag) {
  const stats = targetStats(actor);
  if (!stats) throw new Error(Lang.t("weaponAutomation.errors.noDamageTrack"));
  const snapshot = cardFlag.weapon ?? {};
  const rawDamage = Math.max(0, safeInt(cardFlag.rawDamage, 0));
  const cortosis = actorHasCortosis(actor);
  const pierce = safeNonNegativeInt(snapshot?.qualities?.pierce, 0);
  const breach = safeNonNegativeInt(snapshot?.qualities?.breach, 0);
  let ignoredSoak = 0;
  if (!cortosis) {
    if (stats.scale === "personal") ignoredSoak = pierce + (breach * 10);
    else ignoredSoak = breach;
  }
  const effectiveSoak = Math.max(0, stats.soak - ignoredSoak);
  const netDamage = Math.max(0, rawDamage - effectiveSoak);
  const stunDamage = safeNonNegativeInt(snapshot?.qualities?.stundamage, 0) > 0;
  const ion = safeNonNegativeInt(snapshot?.qualities?.ion, 0) > 0;
  const toStrain = Boolean((stunDamage || ion) && stats.strainPath);
  const path = toStrain ? stats.strainPath : stats.woundPath;
  const before = toStrain ? stats.strainValue : stats.woundValue;
  return {
    stats,
    rawDamage,
    cortosis,
    pierce,
    breach,
    ignoredSoak,
    effectiveSoak,
    netDamage,
    path,
    before,
    after: before + netDamage,
    damageType: toStrain ? (stats.scale === "vehicle" ? "systemStrain" : "strain") : (stats.scale === "vehicle" ? "hullTrauma" : "wounds")
  };
}

async function processApplyDamage(payload) {
  const requester = game.users?.get?.(payload.requestingUserId);
  const cardMessage = game.messages?.get?.(payload.cardMessageId);
  if (!requester || !cardMessage) return;
  if (!isEnabled()) return sendFeedback(requester.id, Lang.t("weaponAutomation.errors.disabled"));
  const flag = cloneData(damageCardFlag(cardMessage));
  if (!flag) return sendFeedback(requester.id, Lang.t("weaponAutomation.errors.damageCardMissing"));

  const { actor, tokenDocument } = await resolveActorRef(payload.targetRef);
  if (!actor) return sendFeedback(requester.id, Lang.t("weaponAutomation.errors.noDamageTarget"));
  let allowed = Boolean(requester.isGM);
  if (!allowed) {
    try { allowed = Boolean(actor.testUserPermission?.(requester, "OWNER")); }
    catch (_) { allowed = false; }
  }
  if (!allowed) return sendFeedback(requester.id, Lang.t("weaponAutomation.errors.notOwner"));

  const targetKey = tokenDocument?.uuid ?? actor.uuid ?? actor.id;
  const applications = Array.isArray(flag.applications) ? flag.applications : [];
  if (applications.some(entry => entry?.targetRef === targetKey)) {
    return sendFeedback(requester.id, Lang.t("weaponAutomation.errors.alreadyApplied"));
  }

  let calc;
  try { calc = damageCalculation(actor, flag); }
  catch (err) { return sendFeedback(requester.id, err?.message || Lang.t("weaponAutomation.errors.generic"), "error"); }

  await actor.update({ [calc.path]: calc.after });
  applications.push({
    targetRef: targetKey,
    actorId: actor.id,
    actorName: actor.name,
    byUserId: requester.id,
    at: Date.now(),
    netDamage: calc.netDamage
  });
  flag.applications = applications;
  await cardMessage.setFlag(MODULE_ID, DAMAGE_FLAG, flag);

  await postDamageAppliedMessage(cardMessage, requester, actor, calc);
  await maybeApplyPassiveOnHitQualityEffects(cardMessage, actor, flag.weapon);
  await sendFeedback(requester.id, Lang.t("weaponAutomation.damageCard.appliedNotice", { damage: calc.netDamage, actor: actor.name }), "info");
}

async function postDamageAppliedMessage(cardMessage, requester, actor, calc) {
  const typeLabel = Lang.t(`weaponAutomation.damageTypes.${calc.damageType}`);
  const reduction = calc.cortosis
    ? Lang.t("weaponAutomation.damageCard.cortosisBlocked")
    : Lang.t("weaponAutomation.damageCard.reduction", { soak: calc.stats.soak, ignored: calc.ignoredSoak, effective: calc.effectiveSoak });
  const content = `<div class="gfoe-weapon-damage-result">
    <div class="gfoe-weapon-card-title"><i class="fa-solid fa-heart-crack"></i> ${escapeHtml(Lang.t("weaponAutomation.damageCard.appliedTitle"))}</div>
    <div><b>${escapeHtml(actor.name)}</b>: ${escapeHtml(Lang.t("weaponAutomation.damageCard.appliedLine", { damage: calc.netDamage, type: typeLabel }))}</div>
    <div class="gfoe-weapon-card-note">${escapeHtml(Lang.t("weaponAutomation.damageCard.calculation", { raw: calc.rawDamage, reduction }))}</div>
    <div class="gfoe-weapon-card-note">${escapeHtml(Lang.t("weaponAutomation.damageCard.trackChange", { before: calc.before, after: calc.after }))}</div>
  </div>`;
  const data = { content, speaker: { alias: requester?.name ?? actor.name } };
  const whisper = Array.isArray(cardMessage?.whisper)
    ? cardMessage.whisper.map(user => typeof user === "string" ? user : user?.id).filter(Boolean)
    : [];
  if (whisper.length) data.whisper = whisper;
  if (cardMessage?.blind) data.blind = true;
  await ChatMessage.create(data);
}

function findStatusDefinition(candidates = []) {
  const statuses = CONFIG?.statusEffects;
  const list = Array.isArray(statuses) ? statuses : Object.values(statuses ?? {});
  const wanted = candidates.map(normalizeName);
  return list.find(status => {
    const id = normalizeName(status?.id);
    const name = normalizeName(status?.name ?? status?.label);
    return wanted.some(candidate => candidate && (id === candidate || id.includes(candidate) || name === candidate || name.includes(candidate)));
  }) ?? null;
}

function cloneSetbackChanges() {
  const status = findStatusDefinition(["starwarsffg-setback-once", "setback"]);
  return cloneData(status?.changes ?? []);
}

async function createQualityEffect(actor, {
  key,
  name,
  img,
  rounds = null,
  changes = [],
  statusCandidates = [],
  extraFlags = {}
}) {
  if (!actor) throw new Error(Lang.t("weaponAutomation.errors.targetMissing"));
  const existing = Array.from(actor.effects?.contents ?? actor.effects ?? []).find(effect => {
    try { return effect.getFlag?.(MODULE_ID, QUALITY_EFFECT_FLAG)?.key === key && !effect.disabled; }
    catch (_) { return false; }
  });

  const status = findStatusDefinition(statusCandidates);
  const data = {
    name,
    img: status?.img ?? status?.icon ?? img ?? "icons/svg/aura.svg",
    disabled: false,
    changes: changes.length ? cloneData(changes) : cloneData(status?.changes ?? []),
    statuses: status?.id ? [status.id] : [],
    duration: rounds ? {
      rounds,
      startRound: game.combat?.round ?? 0,
      startTurn: game.combat?.turn ?? 0
    } : {},
    flags: {
      [MODULE_ID]: {
        [QUALITY_EFFECT_FLAG]: {
          key,
          rounds: rounds ?? null,
          createdAt: Date.now(),
          ...cloneData(extraFlags)
        }
      }
    }
  };

  if (existing) {
    const previous = existing.toObject?.() ?? cloneData(existing);
    await existing.update(data);
    return { effect: existing, created: false, previous };
  }
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return { effect: created, created: true, previous: null };
}

async function applyDirectStrain(actor, amount) {
  const strain = actor?.system?.stats?.strain;
  if (!strain || strain.value == null) throw new Error(Lang.t("weaponAutomation.errors.noStrainTrack"));
  const before = safeNonNegativeInt(strain.value, 0);
  const after = before + Math.max(0, safeInt(amount, 0));
  await actor.update({ "system.stats.strain.value": after });
  return { actor, before, after };
}

async function maybeApplyPassiveOnHitQualityEffects(cardMessage, actor, snapshot) {
  const tractor = safeNonNegativeInt(snapshot?.qualities?.tractor, 0);
  if (tractor <= 0) return;
  const stats = targetStats(actor);
  if (stats?.scale !== "vehicle") return;
  try {
    await createQualityEffect(actor, {
      key: "tractor",
      name: `${qualityLabel("tractor")} ${tractor}`,
      img: "icons/svg/anchor.svg",
      extraFlags: { rank: tractor, sourceMessageId: cardMessage.id }
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | weapon automation | failed to apply Tractor effect`, err);
  }
}

export async function applyWeaponQualityAutomation(message, option, targetChoice = null) {
  const automation = option?.automation;
  if (automation?.type !== "weaponQuality") return null;
  const context = contextFromSnapshot(automation.weaponSnapshot) ?? getWeaponRollContext(message);
  if (!context) throw new Error(Lang.t("weaponAutomation.errors.notWeaponRoll"));
  const key = automation.quality;
  const rank = Math.max(1, safeInt(automation.rank ?? qualityRankFromContext(context, key), 1));
  const actor = targetChoice?.actor ?? null;
  const targetName = targetChoice?.label ?? actor?.name ?? null;

  if (key === "autofire" || key === "linked") {
    const card = await createDamageCard(message, snapshotContext(context), {
      rawDamage: context.rawDamage,
      kind: "extraHit",
      title: Lang.t("weaponAutomation.damageCard.extraHitTitle", { quality: qualityLabel(key) }),
      note: Lang.t(`weaponAutomation.automation.${key}`),
      allowMultipleTargets: false
    });
    return { type: "weaponQuality", quality: key, summary: Lang.t("weaponAutomation.automation.extraHitReady", { quality: qualityLabel(key), damage: context.rawDamage }), createdMessageId: card.id };
  }

  if (key === "blast") {
    const blastDamage = rank + (context.hit ? context.successes : 0);
    const card = await createDamageCard(message, snapshotContext(context), {
      rawDamage: blastDamage,
      kind: "blast",
      title: Lang.t("weaponAutomation.damageCard.blastTitle", { rank }),
      note: Lang.t("weaponAutomation.automation.blast", { target: targetName || Lang.t("weaponAutomation.target") }),
      allowMultipleTargets: true,
      targetName
    });
    return { type: "weaponQuality", quality: key, summary: Lang.t("weaponAutomation.automation.blastReady", { damage: blastDamage }), createdMessageId: card.id };
  }

  if (!actor && ["burn", "concussive", "disorient", "ensnare", "knockdown", "stun", "guided", "sunder"].includes(key)) {
    throw new Error(Lang.t("weaponAutomation.errors.targetMissing"));
  }

  if (key === "burn") {
    const result = await createQualityEffect(actor, {
      key: "burn",
      name: `${qualityLabel("burn")} ${rank}`,
      img: "icons/svg/fire.svg",
      rounds: rank,
      extraFlags: { rank, baseDamage: context.baseDamage, sourceMessageId: message.id, weaponName: context.weaponName }
    });
    return { type: "weaponQuality", quality: key, actor, actorName: actor.name, effectResult: result, summary: Lang.t("weaponAutomation.automation.burn", { actor: actor.name, damage: context.baseDamage, rounds: rank }) };
  }

  if (key === "concussive") {
    const result = await createQualityEffect(actor, {
      key: "concussive",
      name: `${qualityLabel("concussive")} ${rank}`,
      img: "icons/svg/daze.svg",
      rounds: rank,
      statusCandidates: ["staggered", "starwarsffg-staggered"],
      extraFlags: { rank, sourceMessageId: message.id }
    });
    return { type: "weaponQuality", quality: key, actor, actorName: actor.name, effectResult: result, summary: Lang.t("weaponAutomation.automation.concussive", { actor: actor.name, rounds: rank }) };
  }

  if (key === "disorient") {
    const result = await createQualityEffect(actor, {
      key: "disorient",
      name: `${qualityLabel("disorient")} ${rank}`,
      img: "icons/svg/daze.svg",
      rounds: rank,
      changes: cloneSetbackChanges(),
      statusCandidates: ["disoriented", "starwarsffg-disoriented"],
      extraFlags: { rank, sourceMessageId: message.id }
    });
    return { type: "weaponQuality", quality: key, actor, actorName: actor.name, effectResult: result, summary: Lang.t("weaponAutomation.automation.disorient", { actor: actor.name, rounds: rank }) };
  }

  if (key === "ensnare") {
    const result = await createQualityEffect(actor, {
      key: "ensnare",
      name: `${qualityLabel("ensnare")} ${rank}`,
      img: "icons/svg/net.svg",
      rounds: rank,
      statusCandidates: ["immobilized", "gfoe-immobilized", "starwarsffg-immobilized"],
      extraFlags: { rank, sourceMessageId: message.id }
    });
    return { type: "weaponQuality", quality: key, actor, actorName: actor.name, effectResult: result, summary: Lang.t("weaponAutomation.automation.ensnare", { actor: actor.name, rounds: rank }) };
  }

  if (key === "knockdown") {
    const result = await createQualityEffect(actor, {
      key: "knockdown",
      name: qualityLabel("knockdown"),
      img: "icons/svg/falling.svg",
      statusCandidates: ["prone", "gfoe-prone", "starwarsffg-prone"],
      extraFlags: { sourceMessageId: message.id }
    });
    return { type: "weaponQuality", quality: key, actor, actorName: actor.name, effectResult: result, summary: Lang.t("weaponAutomation.automation.knockdown", { actor: actor.name }) };
  }

  if (key === "stun") {
    const strainResult = await applyDirectStrain(actor, rank);
    return { type: "weaponQuality", quality: key, actor, actorName: actor.name, strainResult, summary: Lang.t("weaponAutomation.automation.stun", { actor: actor.name, strain: rank }) };
  }

  if (key === "guided") {
    return { type: "weaponQuality", quality: key, actor, actorName: actor.name, summary: Lang.t("weaponAutomation.automation.guided", { actor: actor.name, rank }) };
  }

  if (key === "sunder") {
    return { type: "weaponQuality", quality: key, actor, actorName: actor.name, summary: Lang.t("weaponAutomation.automation.sunder", { actor: actor.name }) };
  }

  return { type: "weaponQuality", quality: key, summary: Lang.t("weaponAutomation.automation.announced", { quality: qualityLabel(key) }) };
}

export async function rollbackWeaponQualityAutomation(result) {
  if (!result || result.type !== "weaponQuality") return;
  if (result.createdMessageId) {
    const message = game.messages?.get?.(result.createdMessageId);
    if (message) await message.delete();
  }
  if (result.strainResult?.actor) {
    await result.strainResult.actor.update({ "system.stats.strain.value": result.strainResult.before });
  }
  if (result.effectResult?.effect) {
    const { effect, created, previous } = result.effectResult;
    if (created) {
      const current = effect.parent?.effects?.get?.(effect.id) ?? effect;
      if (current) await current.delete();
    } else if (previous) {
      const current = effect.parent?.effects?.get?.(effect.id) ?? effect;
      if (current) await current.update(previous);
    }
  }
}

function weaponFromRollBuilder(app) {
  const item = app?.roll?.item ?? null;
  if (!isWeaponLike(item)) return null;
  return item;
}

function characteristicValue(actor, key) {
  const chars = actor?.system?.characteristics ?? {};
  const direct = chars?.[key];
  if (direct != null) return safeNonNegativeInt(direct?.value ?? direct, 0);
  const match = Object.entries(chars).find(([k]) => normalizeName(k) === normalizeName(key));
  return safeNonNegativeInt(match?.[1]?.value ?? match?.[1], 0);
}

function adjustPool(pool, field, delta) {
  if (!pool || !field || !delta) return;
  const current = Number(pool[field] ?? 0);
  pool[field] = (Number.isFinite(current) ? current : 0) + delta;
}

function passiveRollModifications(app, weapon) {
  const qualities = extractWeaponQualities(weapon);
  const actor = app?.roll?.data?.document?.documentName === "Actor"
    ? app.roll.data.document
    : weapon?.parent?.documentName === "Actor" ? weapon.parent : null;
  const applied = [];

  const accurate = safeNonNegativeInt(qualities.accurate?.rank, 0);
  if (accurate && !qualityHasConfiguredAttributes(qualities.accurate)) {
    adjustPool(app.dicePool, "boost", accurate);
    applied.push(Lang.t("weaponAutomation.rollMods.accurate", { count: accurate }));
  }

  const inaccurate = safeNonNegativeInt(qualities.inaccurate?.rank, 0);
  if (inaccurate && !qualityHasConfiguredAttributes(qualities.inaccurate)) {
    adjustPool(app.dicePool, "setback", inaccurate);
    applied.push(Lang.t("weaponAutomation.rollMods.inaccurate", { count: inaccurate }));
  }

  const cumbersome = safeNonNegativeInt(qualities.cumbersome?.rank, 0);
  if (cumbersome && actor) {
    const brawn = characteristicValue(actor, "Brawn");
    const deficit = Math.max(0, cumbersome - brawn);
    if (deficit) {
      adjustPool(app.dicePool, "difficulty", deficit);
      applied.push(Lang.t("weaponAutomation.rollMods.cumbersome", { count: deficit }));
    }
  }

  if (qualities.superior && !qualityHasConfiguredAttributes(qualities.superior)) {
    adjustPool(app.dicePool, "advantage", 1);
    applied.push(Lang.t("weaponAutomation.rollMods.superior"));
  }
  if (qualities.inferior && !qualityHasConfiguredAttributes(qualities.inferior)) {
    adjustPool(app.dicePool, "threat", 1);
    applied.push(Lang.t("weaponAutomation.rollMods.inferior"));
  }

  return { qualities, applied };
}

function rollBuilderRoot(html) {
  if (isElementLike(html)) return html;
  if (isElementLike(html?.[0])) return html[0];
  return null;
}

function refreshRollBuilderPreview(app, root) {
  try {
    const diffInput = root?.querySelector?.('input[name="difficulty"]');
    if (diffInput) diffInput.value = String(app.dicePool?.difficulty ?? 0);
    const jq = globalThis.jQuery ? globalThis.jQuery(root) : null;
    if (jq && typeof app?._updatePreview === "function") app._updatePreview(jq);
  } catch (err) {
    console.warn(`${MODULE_ID} | weapon automation | failed to refresh RollBuilder preview`, err);
  }
}

function onRenderRollBuilder(app, html) {
  if (!isEnabled() || preparedRollBuilders.has(app)) return;
  const weapon = weaponFromRollBuilder(app);
  if (!weapon) return;
  preparedRollBuilders.add(app);

  const root = rollBuilderRoot(html);
  if (!root) return;
  const { qualities, applied } = passiveRollModifications(app, weapon);
  const hasQualities = Object.keys(qualities).length > 0;
  if (!hasQualities) return;

  const panel = ownerDocumentOf(root).createElement("section");
  panel.className = "gfoe-weapon-roll-quality-panel";
  const qualityList = Object.values(qualities)
    .map(entry => `<span class="gfoe-weapon-quality-badge">${escapeHtml(qualityLabel(entry.key))}${entry.rank > 1 ? ` ${entry.rank}` : ""}</span>`)
    .join("");
  const warnings = [];
  if (qualities.prepare) warnings.push(Lang.t("weaponAutomation.rollWarnings.prepare", { rank: qualities.prepare.rank }));
  if (qualities.slowfiring) warnings.push(Lang.t("weaponAutomation.rollWarnings.slowFiring", { rank: qualities.slowfiring.rank }));
  if (qualities.limitedammo) warnings.push(Lang.t("weaponAutomation.rollWarnings.limitedAmmo", { rank: qualities.limitedammo.rank }));

  panel.innerHTML = `<div class="gfoe-weapon-roll-quality-title"><i class="fa-solid fa-wand-magic-sparkles"></i> ${escapeHtml(Lang.t("weaponAutomation.rollPanelTitle"))}</div>
    <div class="gfoe-weapon-quality-badges">${qualityList}</div>
    ${applied.length ? `<div class="gfoe-weapon-roll-mods">${applied.map(value => `<div><i class="fa-solid fa-check"></i> ${escapeHtml(value)}</div>`).join("")}</div>` : ""}
    ${qualities.autofire ? `<label class="gfoe-autofire-toggle"><input type="checkbox" data-gfoe-autofire> <span>${escapeHtml(Lang.t("weaponAutomation.useAutoFire"))}</span></label>` : ""}
    ${warnings.length ? `<div class="gfoe-weapon-roll-warnings">${warnings.map(value => `<div><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(value)}</div>`).join("")}</div>` : ""}`;

  const diceDialog = root.querySelector?.(".dice-pool-dialog") ?? root;
  diceDialog.prepend(panel);

  if (qualities.autofire) {
    const checkbox = panel.querySelector("[data-gfoe-autofire]");
    checkbox?.addEventListener("change", () => {
      const appliedNow = Boolean(app._gfoeAutoFireDifficultyApplied);
      const wants = Boolean(checkbox.checked);
      if (wants === appliedNow) return;
      adjustPool(app.dicePool, "difficulty", wants ? 1 : -1);
      app._gfoeAutoFireDifficultyApplied = wants;
      refreshRollBuilderPreview(app, root);
    });
  }

  refreshRollBuilderPreview(app, root);
}

export function registerWeaponAutomationSettings() {
  try {
    game.settings.register(MODULE_ID, FEATURE_SETTING, {
      name: game.i18n?.localize?.("settings.enableWeaponAutomationName") ?? "Enable weapon automation",
      hint: game.i18n?.localize?.("settings.enableWeaponAutomationHint") ?? "Adds damage application and weapon-quality automation to weapon rolls.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => {
        try { if (game.user?.isGM && game.socket) game.socket.emit(`module.${MODULE_ID}`, { type: "reloadAll" }); } catch (_) {}
        setTimeout(() => { try { window.location.reload(); } catch (_) {} }, 100);
      }
    });
  } catch (err) {
    console.error(`${MODULE_ID} | weapon automation | settings registration failed`, err);
  }
}

export function registerWeaponAutomationFeature() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  registerPopOutDocumentInitializer(doc => bindDocument(doc));
  bindDocument(globalThis.document);

  Hooks.on("renderChatMessageHTML", (message, html) => {
    try { renderWeaponRollControls(message, html); }
    catch (err) { console.warn(`${MODULE_ID} | weapon automation | render chat controls failed`, err); }
  });

  if (!rollBuilderHookRegistered) {
    rollBuilderHookRegistered = true;
    Hooks.on("renderRollBuilderFFG", (app, html) => {
      try { onRenderRollBuilder(app, html); }
      catch (err) { console.warn(`${MODULE_ID} | weapon automation | RollBuilder integration failed`, err); }
    });
  }
}

export async function handleWeaponAutomationSocket(payload) {
  if (!payload?.type) return false;
  if (payload.type === MSG.FEEDBACK) {
    if (payload.toUserId === game.user?.id && payload.message) {
      const method = payload.level === "error" ? "error" : payload.level === "info" ? "info" : "warn";
      ui.notifications?.[method]?.(payload.message);
    }
    return true;
  }
  if (payload.type === MSG.APPLY_DAMAGE) {
    if (isPrimaryGM()) await processApplyDamage(payload);
    return true;
  }
  return false;
}
