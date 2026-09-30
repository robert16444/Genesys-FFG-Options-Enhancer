
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
  REQUEST_TO_GM: "ITEM_TRANSFER_REQUEST_TO_GM",
  REQUEST_TO_RECIPIENT: "ITEM_TRANSFER_REQUEST_TO_RECIPIENT",
  RESPONSE_TO_GM: "ITEM_TRANSFER_RESPONSE_TO_GM",
  INFO_TO_USERS: "ITEM_TRANSFER_INFO_TO_USERS"
};

const lastRCItemInfoByDocument = new WeakMap(); // Document -> {actorId, itemId}
const contextMenuDocuments = new WeakSet();
const contextMenuObservers = new WeakMap();
const pendingTransfers = new Map();
const transfersInProgress = new Set();
const OFFER_LIFETIME_MS = 10 * 60 * 1000;

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

function isPrimaryGM() {
  const activeGM = game.users.find(user => user.active && user.isGM);
  return game.user.isGM && activeGM?.id === game.user.id;
}

async function notifyTransferUsers(userIds, message) {
  await emitToModuleSocket({ type: MSG.INFO_TO_USERS, toUserIds: userIds, message });
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
            const requestPayload = {
              type: MSG.REQUEST_TO_GM,
              fromUserId: game.user.id,
              fromActorId: fromActor.id,
              itemId,
              quantity,
              toUserId
            };

            if (isPrimaryGM()) await handleRequestToGM(requestPayload);
            else await emitToModuleSocket(requestPayload);

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
    case MSG.REQUEST_TO_GM:
      return handleRequestToGM(payload);
    case MSG.REQUEST_TO_RECIPIENT:
      return handleRequestToRecipient(payload);
    case MSG.RESPONSE_TO_GM:
      return handleResponseToGM(payload);
    case MSG.INFO_TO_USERS:
      return handleInfoToUsers(payload);
  }
}

async function handleRequestToGM(payload) {
  if (!isPrimaryGM()) return;

  const fromUser = game.users.get(payload.fromUserId);
  const toUser = game.users.get(payload.toUserId);
  const fromActor = game.actors.get(payload.fromActorId);
  const toActor = toUser?.character ? game.actors.get(toUser.character.id) : null;
  const item = fromActor?.items?.get(payload.itemId);

  if (!fromUser || !toUser || !fromActor || !toActor || !item) return;

  // The GM does not trust the quantity or the source actor supplied over the socket.
  if (!fromUser.active || !toUser.active || toUser.isGM || fromUser.id === toUser.id ||
      fromActor.id === toActor.id ||
      (!fromUser.isGM && !fromActor.testUserPermission(fromUser, "OWNER"))) return;

  if (!isAllowedItem(item)) {
    await emitToModuleSocket({ type: MSG.INFO_TO_USERS, toUserIds: [payload.fromUserId], message: __t("itemTransfer.onlyAllowed") });
    return;
  }

  const quantity = parseTransferQuantity(payload.quantity);
  const available = getItemQuantity(item);
  if (!quantity || quantity > available) {
    await notifyTransferUsers([payload.fromUserId], __t("itemTransfer.invalidQuantity", {
      quantity: Number.isSafeInteger(available) ? available : 0
    }));
    return;
  }

  const now = Date.now();
  for (const [id, offer] of pendingTransfers) {
    if (now - offer.createdAt > OFFER_LIFETIME_MS) pendingTransfers.delete(id);
  }
  const requestId = foundry.utils.randomID();
  const offer = {
    requestId,
    createdAt: now,
    fromUserId: payload.fromUserId,
    fromActorId: fromActor.id,
    itemId: item.id,
    quantity,
    toUserId: toUser.id,
    toActorId: toActor.id
  };
  pendingTransfers.set(requestId, offer);

  try {
    await emitToModuleSocket({
      type: MSG.REQUEST_TO_RECIPIENT,
      ...offer,
      fromUserName: fromUser.name,
      itemName: item.name,
      itemImg: item.img ?? "icons/svg/item-bag.svg",
      itemType: item.type
    });
  } catch (err) {
    pendingTransfers.delete(requestId);
    throw err;
  }
}

async function handleRequestToRecipient(payload) {
  if (payload.toUserId !== game.user.id) return;

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
          await emitToModuleSocket({ type: MSG.RESPONSE_TO_GM, accepted: true, request: payload, responderUserId: game.user.id });
          ui.notifications.info(__t("itemTransfer.acceptedInfo"));
        }
      },
      {
        action: "decline",
        icon: "fa-solid fa-times",
        label: __t("itemTransfer.decline"),
        callback: async () => {
          await emitToModuleSocket({ type: MSG.RESPONSE_TO_GM, accepted: false, request: payload, responderUserId: game.user.id });
          ui.notifications.info(__t("itemTransfer.declinedInfo"));
        }
      }
    ]
  });
}

async function handleResponseToGM(payload) {
  if (!isPrimaryGM()) return;

  const requestId = payload.request?.requestId;
  const req = pendingTransfers.get(requestId);
  if (!req || payload.responderUserId !== req.toUserId) return;
  pendingTransfers.delete(requestId); // A response is processed only once.
  if (Date.now() - req.createdAt > OFFER_LIFETIME_MS) {
    await notifyTransferUsers([req.fromUserId, req.toUserId], __t("itemTransfer.expired"));
    return;
  }

  const fromActor = game.actors.get(req.fromActorId);
  const toActor = game.actors.get(req.toActorId);
  const item = fromActor?.items?.get(req.itemId);
  const fromUser = game.users.get(req.fromUserId);
  const toUser = game.users.get(req.toUserId);

  if (!fromActor || !toActor || !fromUser || !toUser) return;

  if (!payload.accepted) {
    await notifyTransferUsers([req.fromUserId], __t("itemTransfer.declinedBy", { user: toUser.name }));
    return;
  }

  if (!item) {
    await notifyTransferUsers([req.fromUserId, req.toUserId], __t("itemTransfer.missingItem", { actor: fromActor.name }));
    return;
  }

  if (!isAllowedItem(item)) {
    await notifyTransferUsers([req.fromUserId], __t("itemTransfer.onlyAllowed"));
    return;
  }

  const lockKey = `${fromActor.id}:${item.id}`;
  const recipientLockKey = `recipient:${toActor.id}`;
  if (transfersInProgress.has(lockKey) || transfersInProgress.has(recipientLockKey)) {
    await notifyTransferUsers([req.fromUserId, req.toUserId], __t("itemTransfer.busy"));
    return;
  }
  transfersInProgress.add(lockKey);
  transfersInProgress.add(recipientLockKey);

  try {
    const available = getItemQuantity(item);
    const quantity = parseTransferQuantity(req.quantity);
    if (!quantity || quantity > available) {
      await notifyTransferUsers([req.fromUserId, req.toUserId], __t("itemTransfer.invalidQuantity", {
        quantity: Number.isSafeInteger(available) ? available : 0
      }));
      return;
    }

    let created = [];
    let existingItem = null;
    let previousRecipientQuantity = null;
    try {
      existingItem = Array.from(toActor.items.values()).find(other => canStackItems(item, other)) ?? null;
      if (existingItem) {
        previousRecipientQuantity = getItemQuantity(existingItem);
        const newQuantity = previousRecipientQuantity + quantity;
        if (!Number.isSafeInteger(previousRecipientQuantity) || previousRecipientQuantity < 0 ||
            !Number.isSafeInteger(newQuantity)) {
          throw new Error("Recipient item quantity is invalid or would overflow");
        }
        await existingItem.update({ "system.quantity.value": newQuantity });
      } else {
        const itemData = item.toObject();
        delete itemData._id; // New item only when no exact-name match exists.
        itemData.system ??= {};
        itemData.system.quantity ??= {};
        itemData.system.quantity.value = quantity;
        created = await toActor.createEmbeddedDocuments("Item", [itemData]);
        if (!Array.isArray(created) || created.length !== 1) throw new Error("Recipient item creation failed");
      }

      if (quantity === available) {
        await fromActor.deleteEmbeddedDocuments("Item", [item.id]);
      } else {
        await item.update({ "system.quantity.value": available - quantity });
      }
    } catch (err) {
      // If the sender's stock could not be changed, restore the recipient's
      // previous stack quantity or delete the newly created item.
      try {
        if (existingItem && Number.isSafeInteger(previousRecipientQuantity) &&
            getItemQuantity(existingItem) !== previousRecipientQuantity) {
          await existingItem.update({ "system.quantity.value": previousRecipientQuantity });
        } else if (created.length) {
          await toActor.deleteEmbeddedDocuments("Item", created.map(newItem => newItem.id));
        }
      } catch (rollbackError) {
        console.error(`${MODULE_ID} | item-transfer | rollback failed; GM must check inventories`, rollbackError);
        await notifyTransferUsers([req.fromUserId, req.toUserId], __t("itemTransfer.rollbackFailed"));
      }
      throw err;
    }

    try {
      await notifyTransferUsers([req.fromUserId, req.toUserId], __t("itemTransfer.transferred", {
        item: item.name,
        quantity,
        from: fromActor.name,
        to: toActor.name
      }));
    } catch (notifyError) {
      console.warn(`${MODULE_ID} | item-transfer | transfer completed but notification failed`, notifyError);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | item-transfer | GM transfer failed`, err);
    await notifyTransferUsers([req.fromUserId, req.toUserId], __t("itemTransfer.transferFailedMsg"));
  } finally {
    transfersInProgress.delete(lockKey);
    transfersInProgress.delete(recipientLockKey);
  }
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
