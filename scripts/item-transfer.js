
const MODULE_ID = "genesys-ffg-options-enhancer";
import { Lang } from "./i18n.js";
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

let lastRCItemInfo = null; // {actorId, itemId}
let grrContextStateInstalled = false;

export function registerItemTransferFeature() {
  if (!isItemTransferEnabled()) return;
  const ContextMenuCls =
    foundry?.applications?.ux?.ContextMenu?.implementation ??
    foundry?.applications?.ux?.ContextMenu ??
    foundry?.applications?.api?.ContextMenu;

  const bindForSheet = (app, html) => {
    const actor = app?.actor ?? app?.document;
    if (!actor || !actor.isOwner) return;

    const root = html?.[0] ?? html;
    if (!(root instanceof HTMLElement)) return;

    const itemSelector = "li.item[data-item-id], div.item[data-item-id], .item[data-item-id]";
    if (!root.querySelector(itemSelector)) return;

    // Track right-click so we know which item the menu is for
    root.addEventListener("contextmenu", (ev) => {
      const el = ev.target?.closest?.(itemSelector);
      if (!el) return;
      const itemId = el.dataset.itemId;
      if (!itemId) return;
      const item = actor.items?.get?.(itemId);
      if (!isAllowedItem(item)) return; // don't set if not allowed

      lastRCItemInfo = { actorId: actor.id, itemId };
    }, true);

    // Install a document-level MutationObserver once per client
    if (!document.body.dataset.grrObserverInstalled) {
      installContextMenuObserver();
      document.body.dataset.grrObserverInstalled = "1";
    }

    // Fallback menu if the system provides none
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
            return onSendItemClicked(actor, id);
          }
        }
      ]);
      root.dataset.grrFallbackBound = "1";
    }
  };

  Hooks.on("renderActorSheet", bindForSheet);
  Hooks.on("renderActorSheetV2", bindForSheet);
  Hooks.on("renderActorSheetFG", bindForSheet);
  Hooks.on("renderActorSheetFGv2", bindForSheet);
}

/** Observe for creation of the native context menu and inject our entry under the first item */
function installContextMenuObserver() {
  if (!grrContextStateInstalled) {
    // Clear stale item context before every new right-click. If the click really
    // happened on a valid item row, the sheet-level handler will immediately set it again.
    document.addEventListener("contextmenu", () => {
      lastRCItemInfo = null;
    }, true);

    // Also clear any remembered item after normal clicks / Escape so it cannot leak
    // into unrelated context menus opened later.
    document.addEventListener("click", () => {
      lastRCItemInfo = null;
    }, true);
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") lastRCItemInfo = null;
    }, true);

    grrContextStateInstalled = true;
  }

  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const menu = node.matches?.("nav.context-menu, .context-menu, #context-menu") ? node : node.querySelector?.("nav.context-menu, .context-menu, #context-menu");
        if (!menu) continue;

        // Only augment once per menu instance
        if (menu.dataset.grrAugmented === "1") continue;
        const list = menu.querySelector("ol, ul, .context-items, .menu") || menu;
        if (!list) continue;

        // Insert only if lastRCItemInfo still points to a valid, allowed item
        const info = lastRCItemInfo;
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
          if (labelTarget) {
            if (labelTarget === li) li.textContent = __t("itemTransfer.contextLabel");
            else labelTarget.textContent = __t("itemTransfer.contextLabel");
          }

          first.insertAdjacentElement("afterend", li);
        } else {
          li = document.createElement("li");
          li.className = "context-item grr-context-send-item";
          li.innerHTML = `<a><i class="fas fa-paper-plane"></i><span class="label">${__t("itemTransfer.contextLabel")}</span></a>`;
          list.appendChild(li);
        }

        menu.dataset.grrAugmented = "1";
        requestAnimationFrame(() => restyleExpandedMenu(menu, list, li, first));

        li.addEventListener("click", (e) => {
          e.preventDefault();
          lastRCItemInfo = null;
          if (!actor || !item) return;
          try { menu.style.display = "none"; } catch (e) {}
          onSendItemClicked(actor, item.id);
        });
      }
    }
  });

  obs.observe(document.body, {childList: true, subtree: true});
}


function restyleExpandedMenu(menu, list, li, first) {
  try {
    const items = Array.from(list.children).filter(el => el instanceof HTMLElement);
    if (!items.length || !li) return;

    // Force menu/list height to include the injected row.
    const totalHeight = Math.ceil(items.reduce((sum, el) => sum + Math.max(el.offsetHeight, el.getBoundingClientRect().height), 0));
    menu.style.minHeight = `${totalHeight}px`;
    menu.style.height = `${totalHeight}px`;
    menu.style.overflow = "hidden";
    if (list !== menu) {
      list.style.minHeight = `${totalHeight}px`;
      list.style.height = `${totalHeight}px`;
      list.style.overflow = "hidden";
    }

    const source = first && first !== li ? first : items[0];
    if (!source || source === li) return;

    // Keep the DOM structure/classes cloned from the system row so Foundry/system hover
    // styling continues to work. Only normalize size/visibility related properties.
    const sourceInner = source.querySelector(":scope > a, :scope > button, :scope > .menu-item") ?? source;
    const liInner = li.querySelector(":scope > a, :scope > button, :scope > .menu-item") ?? li;

    copyComputedBox(source, li, { includeBackground: false });
    copyComputedBox(sourceInner, liInner, { includeBackground: false });

    li.style.opacity = "1";
    li.style.visibility = "visible";
    li.style.background = "";
    li.style.backgroundColor = "";

    liInner.style.opacity = "1";
    liInner.style.visibility = "visible";
    liInner.style.width = "100%";
    liInner.style.background = "";
    liInner.style.backgroundColor = "";

    const srcIcon = source.querySelector("i");
    const dstIcon = li.querySelector("i");
    if (srcIcon && dstIcon) copyTextStyle(srcIcon, dstIcon);

    const srcLabel = source.querySelector(".label") ?? source.querySelector("span") ?? sourceInner;
    const dstLabel = li.querySelector(".label") ?? li.querySelector("span") ?? liInner;
    if (srcLabel && dstLabel) {
      copyTextStyle(srcLabel, dstLabel);
      dstLabel.textContent = __t("itemTransfer.contextLabel");
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | item-transfer | context menu restyle failed`, err);
  }
}

function copyComputedBox(source, target, { includeBackground = true } = {}) {
  if (!source || !target) return;
  const s = getComputedStyle(source);
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

async function onSendItemClicked(fromActor, itemId) {
  if (!isItemTransferEnabled()) return ui.notifications?.warn?.(__t("itemTransfer.disabled") || "Item transfer is disabled.");
  try {
    const item = fromActor.items.get(itemId);
    if (!item) return ui.notifications.warn(__t("itemTransfer.itemNotFound"));
    if (!isAllowedItem(item)) return ui.notifications.warn(__t("itemTransfer.onlyAllowed"));

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
      </div>
    `;

    new Dialog({
      title: __t("controls.itemTransfer"),
      content,
      buttons: {
        send: {
          icon: '<i class="fas fa-paper-plane"></i>',
          label: __t("request.send"),
          callback: async (html) => {
            const toUserId = html.find("select[name='grrRecipient']").val();
            if (!toUserId) return ui.notifications.warn(__t("request.selectUser"));
            const requestPayload = {
              type: MSG.REQUEST_TO_GM,
              fromUserId: game.user.id,
              fromActorId: fromActor.id,
              itemId,
              toUserId
            };

            if (game.user.isGM) {
              await handleRequestToGM(requestPayload);
            } else {
              await emitToModuleSocket(requestPayload);
            }

            ui.notifications.info(__t("itemTransfer.sent"));
          }
        },
        cancel: { label: __t("common.cancel") }
      },
      default: "send"
    }).render(true);

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
  if (!game.user.isGM) return;

  const fromUser = game.users.get(payload.fromUserId);
  const toUser = game.users.get(payload.toUserId);
  const fromActor = game.actors.get(payload.fromActorId);
  const toActor = toUser?.character ? game.actors.get(toUser.character.id) : null;
  const item = fromActor?.items?.get(payload.itemId);

  if (!fromUser || !toUser || !fromActor || !toActor || !item) return;

  if (!isAllowedItem(item)) {
    await emitToModuleSocket({ type: MSG.INFO_TO_USERS, toUserIds: [payload.fromUserId], message: __t("itemTransfer.onlyAllowed") });
    return;
  }

  await emitToModuleSocket({
    type: MSG.REQUEST_TO_RECIPIENT,
    fromUserId: payload.fromUserId,
    fromUserName: fromUser.name,
    fromActorId: fromActor.id,
    itemId: payload.itemId,
    itemName: item.name,
    itemImg: item.img ?? "icons/svg/item-bag.svg",
    itemType: item.type,
    toUserId: payload.toUserId,
    toActorId: toActor.id
  });
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
          <div style="font-size:14px;"><b>${escapeHtml(payload.itemName ?? "Item")}</b> <span style="opacity:.8">(${escapeHtml(typeLabel)})</span></div>
        </div>
      </div>
      <hr/>
      <p>${__t("itemTransfer.acceptHint")}</p>
    </div>
  `;

  new Dialog({
    title: __t("itemTransfer.incomingTitle"),
    content,
    buttons: {
      accept: { icon: '<i class="fas fa-check"></i>', label: __t("itemTransfer.accept"), callback: async () => {
        await emitToModuleSocket({ type: MSG.RESPONSE_TO_GM, accepted: true, request: payload, responderUserId: game.user.id });
        ui.notifications.info(__t("itemTransfer.acceptedInfo"));
      }},
      decline: { icon: '<i class="fas fa-times"></i>', label: __t("itemTransfer.decline"), callback: async () => {
        await emitToModuleSocket({ type: MSG.RESPONSE_TO_GM, accepted: false, request: payload, responderUserId: game.user.id });
        ui.notifications.info(__t("itemTransfer.declinedInfo"));
      }}
    },
    default: "accept"
  }).render(true);
}

async function handleResponseToGM(payload) {
  if (!game.user.isGM) return;

  const ok = !!payload.accepted;
  const req = payload.request;
  if (!req) return;

  const fromActor = game.actors.get(req.fromActorId);
  const toActor = game.actors.get(req.toActorId);
  const item = fromActor?.items?.get(req.itemId);
  const fromUser = game.users.get(req.fromUserId);
  const toUser = game.users.get(req.toUserId);

  if (!fromActor || !toActor || !fromUser || !toUser) return;

  if (!ok) {
    await emitToModuleSocket({ type: MSG.INFO_TO_USERS, toUserIds: [req.fromUserId], message: __t("itemTransfer.declinedBy", { user: toUser.name }) });
    return;
  }

  if (!item) {
    await emitToModuleSocket({ type: MSG.INFO_TO_USERS, toUserIds: [req.fromUserId, req.toUserId], message: __t("itemTransfer.missingItem", { actor: fromActor.name }) });
    return;
  }

  if (!isAllowedItem(item)) {
    await emitToModuleSocket({ type: MSG.INFO_TO_USERS, toUserIds: [req.fromUserId], message: __t("itemTransfer.onlyAllowed") });
    return;
  }

  try {
    const itemData = item.toObject();
    await toActor.createEmbeddedDocuments("Item", [itemData]);
    await fromActor.deleteEmbeddedDocuments("Item", [item.id]);
    await emitToModuleSocket({ type: MSG.INFO_TO_USERS, toUserIds: [req.fromUserId, req.toUserId], message: __t("itemTransfer.transferred", { item: item.name, from: fromActor.name, to: toActor.name }) });
  } catch (err) {
    console.error(`${MODULE_ID} | item-transfer | GM transfer failed`, err);
    await emitToModuleSocket({ type: MSG.INFO_TO_USERS, toUserIds: [req.fromUserId, req.toUserId], message: __t("itemTransfer.transferFailedMsg") });
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
