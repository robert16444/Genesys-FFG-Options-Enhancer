
const MODULE_ID = "genesys-ffg-options-enhancer";
import { Lang } from "./i18n.js";
import { isElementLike, ownerWindowOf, registerPopOutDocumentInitializer } from "./popout-compat.js";
function __t(key, data){ try { return Lang?.t?.(key, data) ?? key; } catch(e){ return key; } }

/**
 * Item Transfer — robust integration with Genesys/StarWarsFFG context menu
 * - Adds an entry directly under "Send to Chat" inside the SAME context menu.
 * - Uses a MutationObserver to catch when the system draws its <nav class="context-menu">.
 * - Falls back to its own ContextMenu only if system menu isn't present.
 */

function dbg(...args) { console.log(`${MODULE_ID} | item-transfer |`, ...args); }

function isItemTransferEnabled() {
  try {
    return game.settings.get(MODULE_ID, "enableItemSend");
  } catch (_) {
    return true;
  }
}

const ALLOWED_TYPES = new Set(["armour", "armor", "gear", "weapon"]);

function isAllowedItem(item) {
  const t = String(item?.type ?? "").toLowerCase();
  return ALLOWED_TYPES.has(t);
}

const MSG = {
  OFFER_TO_RECIPIENT: "ITEM_TRANSFER_OFFER_TO_RECIPIENT",
  RESPONSE_TO_SENDER: "ITEM_TRANSFER_RESPONSE_TO_SENDER",
  COMMIT_TO_RECIPIENT: "ITEM_TRANSFER_COMMIT_TO_RECIPIENT",
  RESULT_TO_SENDER: "ITEM_TRANSFER_RESULT_TO_SENDER",
  INFO_TO_USERS: "ITEM_TRANSFER_INFO_TO_USERS"
};

const lastRCItemInfoByDocument = new WeakMap(); // Document -> {actorId, itemId}
const contextMenuDocuments = new WeakSet();
const contextMenuObservers = new WeakMap();
const pendingTransfers = new Map();
const transfersInProgress = new Set();
const recipientCommitResults = new Map();
const OFFER_LIFETIME_MS = 10 * 60 * 1000;
const COMMIT_TIMEOUT_MS = 15000;

function getItemQuantity(item) {
  const raw = item?.system?.quantity?.value;
  if (raw == null) return 1; // Older items without the field represent one item.
  const quantity = Number(raw);
  return Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : NaN;
}

function parseTransferQuantity(raw) {
  const quantity = Number(raw);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

function itemStackSignature(item) {
  const raw = item?.toObject?.() ?? item ?? {};

  const normalize = (value, path = []) => {
    if (Array.isArray(value)) return value.map((entry, index) => normalize(entry, [...path, String(index)]));
    if (value instanceof Set) return Array.from(value, entry => normalize(entry, path));
    if (value instanceof Map) {
      return Object.fromEntries(
        Array.from(value.entries())
          .sort(([a], [b]) => String(a).localeCompare(String(b)))
          .map(([key, entry]) => [String(key), normalize(entry, [...path, String(key)])])
      );
    }
    if (!value || typeof value !== "object") return value;

    const out = {};
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    for (const [key, entry] of entries) {
      const nextPath = [...path, key];
      const joined = nextPath.join(".");

      if (key === "_id" || key === "_key" || key === "_stats") continue;
      if (path.length === 0 && (key === "sort" || key === "folder" || key === "ownership")) continue;

      if (joined === "system.quantity.value") continue;

      if (path[0] === "effects" && key === "origin") continue;
      if (joined === "flags.core.sourceId") continue;

      out[key] = normalize(entry, nextPath);
    }
    return out;
  };

  return JSON.stringify(normalize(raw));
}

function canStackItems(sourceItem, targetItem) {
  if (!sourceItem || !targetItem) return false;
  if (sourceItem.name !== targetItem.name) return false; // case-sensitive by design
  return itemStackSignature(sourceItem) === itemStackSignature(targetItem);
}

async function notifyTransferUsers(userIds, message) {
  const ids = Array.isArray(userIds) ? [...new Set(userIds.filter(Boolean))] : [];
  if (ids.includes(game.user.id) && message) ui.notifications?.info?.(message);
  const remoteIds = ids.filter(id => id !== game.user.id);
  if (remoteIds.length) await emitToModuleSocket({ type: MSG.INFO_TO_USERS, toUserIds: remoteIds, message });
}

export function registerItemTransferFeature() {
  if (!isItemTransferEnabled()) return;
  const ContextMenuCls =
    foundry?.applications?.ux?.ContextMenu?.implementation ??
    foundry?.applications?.ux?.ContextMenu ??
    foundry?.applications?.api?.ContextMenu;

  registerPopOutDocumentInitializer(installContextMenuObserver);

  const bindForSheet = (app, html) => {
    const actor = app?.actor ?? app?.document;
    if (!actor || !actor.isOwner) return;

    const root = isElementLike(html) ? html : (isElementLike(html?.[0]) ? html[0] : null);
    if (!root) return;
    const doc = root.ownerDocument;
    installContextMenuObserver(doc);

    const itemSelector = "li.item[data-item-id], div.item[data-item-id], .item[data-item-id]";
    if (!root.querySelector(itemSelector)) return;

    // Track right-click so we know which item the menu is for. The state is
    // document-scoped so two popped-out sheets cannot overwrite each other.
    root.addEventListener("contextmenu", (ev) => {
      const el = ev.target?.closest?.(itemSelector);
      if (!el) return;
      const itemId = el.dataset.itemId;
      if (!itemId) return;
      const item = actor.items?.get?.(itemId);
      if (!isAllowedItem(item)) return;

      lastRCItemInfoByDocument.set(doc, { actorId: actor.id, itemId });
    }, true);

    // Fallback menu if the system provides none.
    if (ContextMenuCls && !root.dataset.grrFallbackBound) {
      new ContextMenuCls(root, itemSelector, [
        {
          name: __t("itemTransfer.contextLabel"),
          icon: '<i class="fas fa-paper-plane"></i>',
          condition: (li) => {
            const el = li?.closest?.(itemSelector) ?? li;
            const id = el?.dataset?.itemId;
            const a = game.actors.get(actor.id);
            const it = a?.items?.get?.(id);
            return isAllowedItem(it);
          },
          callback: (li) => {
            const el = li?.closest?.(itemSelector) ?? li;
            const id = el?.dataset?.itemId;
            return onSendItemClicked(actor, id, el);
          }
        }
      ], { jQuery: false });
      root.dataset.grrFallbackBound = "1";
    }
  };

  Hooks.on("renderActorSheet", bindForSheet);
  Hooks.on("renderActorSheetV2", bindForSheet);
  Hooks.on("renderActorSheetFG", bindForSheet);
  Hooks.on("renderActorSheetFGv2", bindForSheet);
}

/** Observe for creation of the native context menu and inject our entry under the first item. */
function installContextMenuObserver(doc = globalThis.document) {
  if (!doc?.body || contextMenuDocuments.has(doc)) return;
  contextMenuDocuments.add(doc);

  // Clear stale item context before every new right-click. The sheet-level
  // handler then immediately sets the valid item for that specific document.
  doc.addEventListener("contextmenu", () => {
    lastRCItemInfoByDocument.delete(doc);
  }, true);
  doc.addEventListener("click", () => {
    lastRCItemInfoByDocument.delete(doc);
  }, true);
  doc.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") lastRCItemInfoByDocument.delete(doc);
  }, true);

  const MutationObserverCtor = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (!MutationObserverCtor) return;

  const obs = new MutationObserverCtor((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!isElementLike(node)) continue;
        const menu = node.matches?.("nav.context-menu, .context-menu, #context-menu")
          ? node
          : node.querySelector?.("nav.context-menu, .context-menu, #context-menu");
        if (!menu) continue;

        if (menu.dataset.grrAugmented === "1") continue;
        const list = menu.querySelector("ol, ul, .context-items, .menu") || menu;
        if (!list) continue;

        const info = lastRCItemInfoByDocument.get(doc);
        if (!info) continue;
        const actor = game.actors.get(info.actorId);
        const item = actor?.items?.get?.(info.itemId);
        if (!isAllowedItem(item)) continue;

        const first = list.querySelector(".context-item");
        let li;

        if (first) {
          li = first.cloneNode(true);
          li.classList.add("grr-context-send-item");
          li.removeAttribute("id");
          for (const el of li.querySelectorAll("[id]")) el.removeAttribute("id");

          const icon = li.querySelector("i");
          if (icon) icon.className = "fas fa-paper-plane";

          const labelTarget = li.querySelector(".label") ?? li.querySelector("span") ?? li.querySelector("a") ?? li;
          if (labelTarget) labelTarget.textContent = __t("itemTransfer.contextLabel");
          first.insertAdjacentElement("afterend", li);
        } else {
          li = doc.createElement("li");
          li.className = "context-item grr-context-send-item";
          li.innerHTML = `<a><i class="fas fa-paper-plane"></i><span class="label">${__t("itemTransfer.contextLabel")}</span></a>`;
          list.appendChild(li);
        }

        menu.dataset.grrAugmented = "1";

        restyleExpandedMenu(menu, list, li, first);

        const ownerWindow = ownerWindowOf(menu) ?? doc.defaultView ?? globalThis.window;
        const rerunRestyle = () => restyleExpandedMenu(menu, list, li, first);
        try { ownerWindow?.requestAnimationFrame?.(rerunRestyle); } catch (_) {}
        try { ownerWindow?.setTimeout?.(rerunRestyle, 0); } catch (_) {}
        try { ownerWindow?.setTimeout?.(rerunRestyle, 50); } catch (_) {}

        li.addEventListener("click", (e) => {
          e.preventDefault();
          lastRCItemInfoByDocument.delete(doc);
          if (!actor || !item) return;
          try { menu.style.display = "none"; } catch (_) {}
          onSendItemClicked(actor, item.id, li);
        });
      }
    }
  });

  obs.observe(doc.body, { childList: true, subtree: true });
  contextMenuObservers.set(doc, obs);
}

function restyleExpandedMenu(menu, list, li, first) {
  try {
    const items = Array.from(list.children).filter(isElementLike);
    if (!items.length || !li) return;

    const layoutContainers = new Set([
      menu,
      list,
      ...menu.querySelectorAll("ol, ul, .context-items, .menu, .context-menu-items")
    ]);
    for (const container of layoutContainers) {
      if (!container?.style) continue;
      container.style.setProperty("height", "auto", "important");
      container.style.setProperty("max-height", "none", "important");
      container.style.setProperty("overflow", "visible", "important");
      container.style.setProperty("overflow-x", "visible", "important");
      container.style.setProperty("overflow-y", "visible", "important");
      container.style.setProperty("scrollbar-width", "none", "important");
    }

    const totalHeight = Math.ceil(items.reduce(
      (sum, el) => sum + Math.max(el.offsetHeight, el.getBoundingClientRect().height),
      0
    ));
    if (totalHeight > 0) {
      menu.style.setProperty("min-height", `${totalHeight}px`, "important");
      if (list !== menu) list.style.setProperty("min-height", `${totalHeight}px`, "important");
    }

    const source = first && first !== li ? first : items[0];
    if (!source || source === li) return;

    // A cloned native row can carry transient disabled/hover state. Strip it
    // recursively so neither the row, anchor, icon nor label keeps the system's
    // disabled foreground colour.
    for (const el of [li, ...li.querySelectorAll("*")]) {
      if (!el) continue;
      el.classList?.remove?.("disabled", "is-disabled", "inactive", "locked");
      el.removeAttribute?.("disabled");
      el.removeAttribute?.("aria-disabled");
      el.removeAttribute?.("data-disabled");
    }

    const sourceInner = source.querySelector(":scope > a, :scope > button, :scope > .menu-item") ?? source;
    const liInner = li.querySelector(":scope > a, :scope > button, :scope > .menu-item") ?? li;

    copyComputedBox(source, li, { includeBackground: false });
    copyComputedBox(sourceInner, liInner, { includeBackground: false });

    li.style.setProperty("opacity", "1", "important");
    li.style.setProperty("visibility", "visible", "important");
    li.style.removeProperty("background");
    li.style.removeProperty("background-color");

    liInner.style.setProperty("opacity", "1", "important");
    liInner.style.setProperty("visibility", "visible", "important");
    liInner.style.setProperty("width", "100%", "important");
    liInner.style.removeProperty("background");
    liInner.style.removeProperty("background-color");

    copyTextStyle(sourceInner, liInner, { importantColor: true });

    const srcIcon = source.querySelector("i");
    const dstIcon = li.querySelector("i");
    if (srcIcon && dstIcon) copyTextStyle(srcIcon, dstIcon, { importantColor: true });

    const srcLabel = source.querySelector(".label") ?? source.querySelector("span") ?? sourceInner;
    const dstLabel = li.querySelector(".label") ?? li.querySelector("span") ?? liInner;
    if (srcLabel && dstLabel) {
      copyTextStyle(srcLabel, dstLabel, { importantColor: true });
      dstLabel.textContent = __t("itemTransfer.contextLabel");
    }

    const nativeColor = computedStyleFor(srcLabel ?? sourceInner ?? source)?.color;
    if (nativeColor) {
      li.style.setProperty("color", nativeColor, "important");
      for (const child of li.querySelectorAll("*")) {
        child.style?.setProperty?.("color", nativeColor, "important");
      }
    }
    li.style.setProperty("pointer-events", "auto", "important");
  } catch (err) {
    console.warn(`${MODULE_ID} | item-transfer | context menu restyle failed`, err);
  }
}

function computedStyleFor(source) {
  return source?.ownerDocument?.defaultView?.getComputedStyle?.(source) ?? globalThis.getComputedStyle?.(source);
}

function copyComputedBox(source, target, { includeBackground = true } = {}) {
  if (!source || !target) return;
  const s = computedStyleFor(source);
  if (!s) return;
  const t = target.style;
  const props = [
    "display", "position", "boxSizing", "width", "height", "minHeight", "maxHeight",
    "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "margin", "border", "borderTop", "borderRight", "borderBottom", "borderLeft",
    "borderRadius", "boxShadow", "alignItems",
    "justifyContent", "gap", "lineHeight", "verticalAlign", "overflow", "cursor"
  ];
  if (includeBackground) props.push("background", "backgroundColor");
  for (const prop of props) t[prop] = s[prop];
}

function copyTextStyle(source, target, { importantColor = false } = {}) {
  if (!source || !target) return;
  const sourceStyle = computedStyleFor(source);
  if (!sourceStyle) return;
  const targetStyle = target.style;
  const props = [
    "color", "font", "fontFamily", "fontSize", "fontStyle", "fontWeight",
    "fontVariant", "fontStretch", "letterSpacing", "lineHeight", "textAlign",
    "textDecoration", "textTransform", "textShadow", "whiteSpace"
  ];
  for (const prop of props) {
    const value = sourceStyle[prop];
    if (value == null || value === "") continue;
    if (prop === "color" && importantColor) targetStyle.setProperty("color", value, "important");
    else targetStyle[prop] = value;
  }
}

async function onSendItemClicked(fromActor, itemId, sourceElement = null) {
  if (!isItemTransferEnabled()) return ui.notifications?.warn?.(__t("itemTransfer.disabled") || "Item transfer is disabled.");
  try {
    const item = fromActor.items.get(itemId);
    if (!item) return ui.notifications.warn(__t("itemTransfer.itemNotFound"));
    if (!isAllowedItem(item)) return ui.notifications.warn(__t("itemTransfer.onlyAllowed"));
    const available = getItemQuantity(item);
    if (!Number.isSafeInteger(available) || available < 1) {
      return ui.notifications.warn(__t("itemTransfer.invalidStock"));
    }

    const sourceActorId = fromActor?.id ?? null;
    const candidates = game.users
      .filter(u => u.active && !u.isGM && u.character)
      .filter(u => u.id !== game.user.id)
      .filter(u => u.character?.id !== sourceActorId);

    if (candidates.length === 0) return ui.notifications.warn(__t("itemTransfer.noEligible"));

    const options = candidates.map(u => `<option value="${u.id}">${escapeHtml(u.name)} — ${escapeHtml(u.character.name)}</option>`).join("");

    const typeLabel = String(item.type ?? "").toUpperCase();
    const content = `
      <div class="grr-send-item">
        <p><b>${__t("itemTransfer.sendItem")}:</b> ${escapeHtml(item.name)} <span style="opacity:.8">(${escapeHtml(typeLabel)})</span></p>
        <div class="form-group">
          <label>${__t("itemTransfer.selectRecipient")}</label>
          <select name="grrRecipient">${options}</select>
        </div>
        <div class="form-group">
          <label>${__t("itemTransfer.quantity")}</label>
          ${available > 1
            ? `<div class="grr-item-quantity-stepper" style="display:flex; align-items:center; gap:8px; width:max-content; margin:.35rem 0;">
                <button type="button" data-grr-qty-delta="-1" aria-label="${__t("itemTransfer.decreaseQuantity")}" title="−" style="width:34px; min-width:34px; height:32px; padding:0; font-size:20px; line-height:1;">−</button>
                <output data-grr-qty-display for="grrItemQuantity" style="min-width:42px; text-align:center; font-weight:700; font-size:1.05em;">1</output>
                <input id="grrItemQuantity" type="hidden" name="grrQuantity" value="1" />
                <button type="button" data-grr-qty-delta="1" aria-label="${__t("itemTransfer.increaseQuantity")}" title="+" style="width:34px; min-width:34px; height:32px; padding:0; font-size:20px; line-height:1;">+</button>
              </div>`
            : `<strong>1</strong>`}
          <p class="notes">${__t("itemTransfer.available", { quantity: available })}</p>
        </div>
      </div>
    `;

    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2) throw new Error("Foundry DialogV2 API is unavailable.");

    await DialogV2.wait({
      window: { title: __t("controls.itemTransfer"), icon: "fa-solid fa-paper-plane" },
      position: { width: 460, height: "auto" },
      content,
      modal: false,
      rejectClose: false,
      buttons: [
        {
          action: "send",
          icon: "fa-solid fa-paper-plane",
          label: __t("request.send"),
          default: true,
          callback: async (_event, button) => {
            const form = button?.form;
            const toUserId = form?.elements?.grrRecipient?.value;
            if (!toUserId) return ui.notifications.warn(__t("request.selectUser"));
            const quantity = available > 1
              ? parseTransferQuantity(form?.elements?.grrQuantity?.value)
              : 1;
            const currentItem = fromActor.items.get(itemId);
            const currentStock = getItemQuantity(currentItem);
            if (!quantity || !currentItem || quantity > currentStock) {
              return ui.notifications.warn(__t("itemTransfer.invalidQuantity", { quantity: Number.isSafeInteger(currentStock) ? currentStock : 0 }));
            }
            const toUser = game.users.get(toUserId);
            const toActor = toUser?.character ? game.actors.get(toUser.character.id) : null;
            if (!toUser?.active || !toActor) return ui.notifications.warn(__t("itemTransfer.noEligible"));
            if (!toActor.testUserPermission(toUser, "OWNER")) return ui.notifications.warn(__t("itemTransfer.recipientNoPermission"));

            const requestId = foundry.utils.randomID();
            const offer = {
              requestId,
              createdAt: Date.now(),
              phase: "offered",
              fromUserId: game.user.id,
              fromActorId: fromActor.id,
              itemId,
              quantity,
              toUserId,
              toActorId: toActor.id
            };
            pendingTransfers.set(requestId, offer);

            await emitToModuleSocket({
              type: MSG.OFFER_TO_RECIPIENT,
              ...offer,
              fromUserName: game.user.name,
              itemName: currentItem.name,
              itemImg: currentItem.img ?? "icons/svg/item-bag.svg",
              itemType: currentItem.type
            });

            ui.notifications.info(__t("itemTransfer.sent"));
          }
        },
        { action: "cancel", label: __t("common.cancel"), icon: "fa-solid fa-xmark" }
      ],
      render: (_event, app) => {
        if (available <= 1) return;
        const root = app.element;
        const input = root?.querySelector?.("input[name='grrQuantity']");
        const display = root?.querySelector?.("[data-grr-qty-display]");
        const minus = root?.querySelector?.("[data-grr-qty-delta='-1']");
        const plus = root?.querySelector?.("[data-grr-qty-delta='1']");
        if (!input || !display || !minus || !plus) return;

        const setQuantity = (rawValue) => {
          const requested = Number(rawValue);
          const next = Math.max(1, Math.min(available, Number.isFinite(requested) ? Math.trunc(requested) : 1));
          input.value = String(next);
          display.textContent = String(next);
          minus.disabled = next <= 1;
          plus.disabled = next >= available;
        };

        root.querySelectorAll("[data-grr-qty-delta]").forEach(control => {
          control.addEventListener("click", event => {
            event.preventDefault();
            const delta = Number(event.currentTarget?.dataset?.grrQtyDelta ?? 0);
            const current = parseTransferQuantity(input.value) ?? 1;
            setQuantity(current + delta);
          });
        });
        setQuantity(1);
      }
    });

  } catch (err) {
    console.error(`${MODULE_ID} | item-transfer | onSendItemClicked error`, err);
    ui.notifications.error(__t("itemTransfer.failed"));
  }
}

export async function handleItemTransferSocket(payload) {
  if (!isItemTransferEnabled() || !payload?.type) return;

  switch (payload.type) {
    case MSG.OFFER_TO_RECIPIENT:
      return handleOfferToRecipient(payload);
    case MSG.RESPONSE_TO_SENDER:
      return handleResponseToSender(payload);
    case MSG.COMMIT_TO_RECIPIENT:
      return handleCommitToRecipient(payload);
    case MSG.RESULT_TO_SENDER:
      return handleResultToSender(payload);
    case MSG.INFO_TO_USERS:
      return handleInfoToUsers(payload);
  }
}

async function handleOfferToRecipient(payload) {
  if (payload.toUserId !== game.user.id) return;

  const toActor = game.actors.get(payload.toActorId);
  if (!toActor || !toActor.testUserPermission(game.user, "OWNER")) {
    await emitToModuleSocket({
      type: MSG.RESPONSE_TO_SENDER,
      requestId: payload.requestId,
      toSenderUserId: payload.fromUserId,
      responderUserId: game.user.id,
      accepted: false,
      error: "recipientNoPermission"
    });
    ui.notifications?.warn?.(__t("itemTransfer.recipientNoPermission"));
    return;
  }

  const typeLabel = String(payload.itemType ?? "").toUpperCase();
  const content = `
    <div class="grr-receive-item">
      <div style="display:flex; gap:10px; align-items:center;">
        <img src="${payload.itemImg ?? "icons/svg/item-bag.svg"}" style="width:40px; height:40px; border-radius:6px; object-fit:cover;" />
        <div>
          <div>${__t("itemTransfer.senderWantsToSend", { sender: escapeHtml(payload.fromUserName ?? "Player") })}</div>
          <div style="font-size:14px;"><b>${escapeHtml(payload.itemName ?? "Item")}</b> × ${escapeHtml(payload.quantity)} <span style="opacity:.8">(${escapeHtml(typeLabel)})</span></div>
        </div>
      </div>
      <hr/>
      <p>${__t("itemTransfer.acceptHint")}</p>
    </div>
  `;

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) throw new Error("Foundry DialogV2 API is unavailable.");
  await DialogV2.wait({
    window: { title: __t("itemTransfer.incomingTitle"), icon: "fa-solid fa-box-open" },
    position: { width: 460, height: "auto" },
    content,
    modal: false,
    rejectClose: false,
    buttons: [
      {
        action: "accept",
        icon: "fa-solid fa-check",
        label: __t("itemTransfer.accept"),
        default: true,
        callback: async () => {
          await emitToModuleSocket({
            type: MSG.RESPONSE_TO_SENDER,
            requestId: payload.requestId,
            toSenderUserId: payload.fromUserId,
            responderUserId: game.user.id,
            accepted: true
          });
          ui.notifications.info(__t("itemTransfer.acceptedInfo"));
        }
      },
      {
        action: "decline",
        icon: "fa-solid fa-times",
        label: __t("itemTransfer.decline"),
        callback: async () => {
          await emitToModuleSocket({
            type: MSG.RESPONSE_TO_SENDER,
            requestId: payload.requestId,
            toSenderUserId: payload.fromUserId,
            responderUserId: game.user.id,
            accepted: false
          });
          ui.notifications.info(__t("itemTransfer.declinedInfo"));
        }
      }
    ]
  });
}

async function handleResponseToSender(payload) {
  if (payload.toSenderUserId !== game.user.id) return;

  const req = pendingTransfers.get(payload.requestId);
  if (!req || req.phase !== "offered" || payload.responderUserId !== req.toUserId) return;

  if (Date.now() - req.createdAt > OFFER_LIFETIME_MS) {
    pendingTransfers.delete(req.requestId);
    ui.notifications?.warn?.(__t("itemTransfer.expired"));
    return;
  }

  const toUser = game.users.get(req.toUserId);
  if (!payload.accepted) {
    pendingTransfers.delete(req.requestId);
    const message = payload.error === "recipientNoPermission"
      ? __t("itemTransfer.recipientNoPermission")
      : __t("itemTransfer.declinedBy", { user: toUser?.name ?? "Player" });
    ui.notifications?.info?.(message);
    return;
  }

  const fromActor = game.actors.get(req.fromActorId);
  const item = fromActor?.items?.get(req.itemId);
  const toActor = game.actors.get(req.toActorId);
  if (!fromActor || !item || !toUser?.active || !toActor) {
    pendingTransfers.delete(req.requestId);
    ui.notifications?.error?.(__t("itemTransfer.transferFailedMsg"));
    return;
  }
  if (!fromActor.testUserPermission(game.user, "OWNER")) {
    pendingTransfers.delete(req.requestId);
    ui.notifications?.error?.(__t("itemTransfer.senderNoPermission"));
    return;
  }
  if (!toActor.testUserPermission(toUser, "OWNER")) {
    pendingTransfers.delete(req.requestId);
    ui.notifications?.error?.(__t("itemTransfer.recipientNoPermission"));
    return;
  }

  const available = getItemQuantity(item);
  const quantity = parseTransferQuantity(req.quantity);
  if (!quantity || quantity > available) {
    pendingTransfers.delete(req.requestId);
    ui.notifications?.warn?.(__t("itemTransfer.invalidQuantity", {
      quantity: Number.isSafeInteger(available) ? available : 0
    }));
    return;
  }

  const lockKey = `${fromActor.id}:${item.id}`;
  if (transfersInProgress.has(lockKey)) {
    pendingTransfers.delete(req.requestId);
    ui.notifications?.warn?.(__t("itemTransfer.busy"));
    return;
  }
  transfersInProgress.add(lockKey);

  const originalItemData = item.toObject();
  const commitItemData = foundry.utils.deepClone(originalItemData);
  commitItemData.system ??= {};
  commitItemData.system.quantity ??= {};
  commitItemData.system.quantity.value = quantity;

  try {
    if (quantity === available) {
      await fromActor.deleteEmbeddedDocuments("Item", [item.id]);
    } else {
      await item.update({ "system.quantity.value": available - quantity });
    }

    req.phase = "committing";
    req.lockKey = lockKey;
    req.rollback = { originalItemData, available, deleted: quantity === available };
    req.timeoutId = globalThis.setTimeout(() => {
      rollbackOutgoingTransfer(req.requestId, __t("itemTransfer.transferTimeout"));
    }, COMMIT_TIMEOUT_MS);

    await emitToModuleSocket({
      type: MSG.COMMIT_TO_RECIPIENT,
      requestId: req.requestId,
      toUserId: req.toUserId,
      toActorId: req.toActorId,
      fromUserId: req.fromUserId,
      fromActorId: req.fromActorId,
      fromActorName: fromActor.name,
      itemData: commitItemData,
      quantity
    });
  } catch (err) {
    console.error(`${MODULE_ID} | item-transfer | sender commit failed`, err);
    await rollbackOutgoingTransfer(req.requestId, __t("itemTransfer.transferFailedMsg"));
  }
}

async function handleCommitToRecipient(payload) {
  if (payload.toUserId !== game.user.id) return;

  const cached = recipientCommitResults.get(payload.requestId);
  if (cached && Date.now() - cached.createdAt < OFFER_LIFETIME_MS) {
    await emitToModuleSocket({
      type: MSG.RESULT_TO_SENDER,
      requestId: payload.requestId,
      toSenderUserId: payload.fromUserId,
      responderUserId: game.user.id,
      success: cached.success,
      error: cached.error ?? null
    });
    return;
  }

  const toActor = game.actors.get(payload.toActorId);
  if (!toActor || !toActor.testUserPermission(game.user, "OWNER")) {
    recipientCommitResults.set(payload.requestId, { createdAt: Date.now(), success: false, error: "recipientNoPermission" });
    await emitToModuleSocket({
      type: MSG.RESULT_TO_SENDER,
      requestId: payload.requestId,
      toSenderUserId: payload.fromUserId,
      responderUserId: game.user.id,
      success: false,
      error: "recipientNoPermission"
    });
    return;
  }

  const itemData = foundry.utils.deepClone(payload.itemData ?? {});
  const quantity = parseTransferQuantity(payload.quantity);
  if (!itemData?.name || !isAllowedItem(itemData) || !quantity) {
    recipientCommitResults.set(payload.requestId, { createdAt: Date.now(), success: false, error: "invalidPayload" });
    await emitToModuleSocket({
      type: MSG.RESULT_TO_SENDER,
      requestId: payload.requestId,
      toSenderUserId: payload.fromUserId,
      responderUserId: game.user.id,
      success: false,
      error: "invalidPayload"
    });
    return;
  }

  try {
    const existingItem = Array.from(toActor.items.values()).find(other => canStackItems(itemData, other)) ?? null;
    if (existingItem) {
      const currentQuantity = getItemQuantity(existingItem);
      const newQuantity = currentQuantity + quantity;
      if (!Number.isSafeInteger(currentQuantity) || currentQuantity < 0 || !Number.isSafeInteger(newQuantity)) {
        throw new Error("Recipient item quantity is invalid or would overflow");
      }
      await existingItem.update({ "system.quantity.value": newQuantity });
    } else {
      delete itemData._id;
      itemData.system ??= {};
      itemData.system.quantity ??= {};
      itemData.system.quantity.value = quantity;
      const created = await toActor.createEmbeddedDocuments("Item", [itemData]);
      if (!Array.isArray(created) || created.length !== 1) throw new Error("Recipient item creation failed");
    }

    recipientCommitResults.set(payload.requestId, { createdAt: Date.now(), success: true });
    ui.notifications?.info?.(__t("itemTransfer.received", { item: itemData.name, quantity }));
    await emitToModuleSocket({
      type: MSG.RESULT_TO_SENDER,
      requestId: payload.requestId,
      toSenderUserId: payload.fromUserId,
      responderUserId: game.user.id,
      success: true
    });
  } catch (err) {
    console.error(`${MODULE_ID} | item-transfer | recipient commit failed`, err);
    recipientCommitResults.set(payload.requestId, { createdAt: Date.now(), success: false, error: "recipientUpdateFailed" });
    await emitToModuleSocket({
      type: MSG.RESULT_TO_SENDER,
      requestId: payload.requestId,
      toSenderUserId: payload.fromUserId,
      responderUserId: game.user.id,
      success: false,
      error: "recipientUpdateFailed"
    });
    ui.notifications?.error?.(__t("itemTransfer.transferFailedMsg"));
  }
}

async function handleResultToSender(payload) {
  if (payload.toSenderUserId !== game.user.id) return;

  const req = pendingTransfers.get(payload.requestId);
  if (!req || req.phase !== "committing" || payload.responderUserId !== req.toUserId) return;
  if (req.timeoutId) globalThis.clearTimeout(req.timeoutId);

  if (!payload.success) {
    const message = payload.error === "recipientNoPermission"
      ? __t("itemTransfer.recipientNoPermission")
      : __t("itemTransfer.transferFailedMsg");
    await rollbackOutgoingTransfer(req.requestId, message);
    return;
  }

  pendingTransfers.delete(req.requestId);
  if (req.lockKey) transfersInProgress.delete(req.lockKey);

  const fromActor = game.actors.get(req.fromActorId);
  const toActor = game.actors.get(req.toActorId);
  const itemName = req.rollback?.originalItemData?.name ?? "Item";
  ui.notifications?.info?.(__t("itemTransfer.transferred", {
    item: itemName,
    quantity: req.quantity,
    from: fromActor?.name ?? "",
    to: toActor?.name ?? ""
  }));
}

async function rollbackOutgoingTransfer(requestId, message) {
  const req = pendingTransfers.get(requestId);
  if (!req) return;
  if (req.timeoutId) globalThis.clearTimeout(req.timeoutId);

  try {
    const fromActor = game.actors.get(req.fromActorId);
    const rollback = req.rollback;
    if (fromActor && rollback) {
      if (rollback.deleted) {
        const restoreData = foundry.utils.deepClone(rollback.originalItemData);
        try {
          await fromActor.createEmbeddedDocuments("Item", [restoreData], { keepId: true });
        } catch (_) {
          delete restoreData._id;
          await fromActor.createEmbeddedDocuments("Item", [restoreData]);
        }
      } else {
        const currentItem = fromActor.items.get(req.itemId);
        if (currentItem) await currentItem.update({ "system.quantity.value": rollback.available });
      }
    }
  } catch (rollbackError) {
    console.error(`${MODULE_ID} | item-transfer | sender rollback failed`, rollbackError);
    ui.notifications?.error?.(__t("itemTransfer.rollbackFailed"));
  } finally {
    if (req.lockKey) transfersInProgress.delete(req.lockKey);
    pendingTransfers.delete(requestId);
  }

  if (message) ui.notifications?.error?.(message);
}

async function handleInfoToUsers(payload) {
  const ids = Array.isArray(payload.toUserIds) ? payload.toUserIds : [];
  if (ids.length && !ids.includes(game.user.id)) return;
  if (payload.message) ui.notifications?.info(payload.message);
}

async function emitToModuleSocket(payload) {
  return game.socket.emit(`module.${MODULE_ID}`, payload);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
