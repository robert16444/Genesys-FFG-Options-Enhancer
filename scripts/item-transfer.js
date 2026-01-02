const MODULE_ID = "genesys-ffg-options-enhancer";

/**
 * Item Transfer feature:
 * - Adds right-click context menu option "Send to player" on items in Actor sheets you own.
 * - Sender selects an online player (who has an assigned character).
 * - Recipient receives an accept/decline dialog.
 * - Transfer is executed by the GM client (create item on recipient actor, delete item from sender actor).
 *
 * Allowed item types: armour, gear, weapon (case-insensitive).
 */

function dbg(...args) { console.log(`${MODULE_ID} | item-transfer |`, ...args); }

const ALLOWED_TYPES = new Set(["armour", "armor", "gear", "weapon"]);

function isAllowedItem(item) {
  const t = String(item?.type ?? "").toLowerCase();
  return ALLOWED_TYPES.has(t);
}

/** Socket message types */
const MSG = {
  REQUEST_TO_GM: "ITEM_TRANSFER_REQUEST_TO_GM",
  REQUEST_TO_RECIPIENT: "ITEM_TRANSFER_REQUEST_TO_RECIPIENT",
  RESPONSE_TO_GM: "ITEM_TRANSFER_RESPONSE_TO_GM",
  INFO_TO_USERS: "ITEM_TRANSFER_INFO_TO_USERS"
};

export function registerItemTransferFeature() {
  Hooks.on("renderActorSheet", (app, html) => {
    try {
      const actor = app?.actor;
      if (!actor) return;
      if (!actor.isOwner) return;

      const itemSelector = ".item[data-item-id], li.item[data-item-id], .inventory .item[data-item-id]";
      const root = html?.[0];
      const items = root?.querySelectorAll?.(itemSelector);
      if (!items || items.length === 0) return;

      if (root.dataset.grrItemTransferBound === "1") return;
      root.dataset.grrItemTransferBound = "1";

      new ContextMenu(html, itemSelector, [
        {
          name: "Send to player",
          icon: '<i class="fas fa-paper-plane"></i>',
          condition: (li) => {
            const itemId = li?.dataset?.itemId;
            if (!itemId) return false;
            const item = actor.items.get(itemId);
            return isAllowedItem(item);
          },
          callback: (li) => onSendItemClicked(actor, li?.dataset?.itemId)
        }
      ]);
    } catch (err) {
      console.error(`${MODULE_ID} | item-transfer | renderActorSheet hook error`, err);
    }
  });
}

async function onSendItemClicked(fromActor, itemId) {
  try {
    const item = fromActor.items.get(itemId);
    if (!item) return ui.notifications.warn("Item not found.");

    if (!isAllowedItem(item)) {
      ui.notifications.warn("Only Armour, Gear, and Weapon items can be sent.");
      return;
    }

    const candidates = getOnlinePlayersWithCharacters()
      .filter(u => u.id !== game.user.id);

    if (candidates.length === 0) {
      ui.notifications.warn("No other online players with assigned characters.");
      return;
    }

    const options = candidates.map(u => `<option value="${u.id}">${escapeHtml(u.name)} — ${escapeHtml(u.character.name)}</option>`).join("");

    const typeLabel = String(item.type ?? "").toUpperCase();
    const content = `
      <div class="grr-send-item">
        <p><b>Send item:</b> ${escapeHtml(item.name)} <span style="opacity:.8">(${escapeHtml(typeLabel)})</span></p>
        <div class="form-group">
          <label>To (online player)</label>
          <select name="grrRecipient">${options}</select>
        </div>
      </div>
    `;

    new Dialog({
      title: "Send to player",
      content,
      buttons: {
        send: {
          icon: '<i class="fas fa-paper-plane"></i>',
          label: "Send",
          callback: async (html) => {
            const toUserId = html.find("select[name='grrRecipient']").val();
            if (!toUserId) return ui.notifications.warn("Pick a recipient.");
            await emitToModuleSocket({
              type: MSG.REQUEST_TO_GM,
              fromUserId: game.user.id,
              fromActorId: fromActor.id,
              itemId,
              toUserId
            });
            ui.notifications.info("Transfer request sent.");
          }
        },
        cancel: { label: "Cancel" }
      },
      default: "send"
    }).render(true);

  } catch (err) {
    console.error(`${MODULE_ID} | item-transfer | onSendItemClicked error`, err);
    ui.notifications.error("Failed to send item (see console).");
  }
}

export async function handleItemTransferSocket(payload) {
  if (!payload?.type) return;

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

  if (!fromUser || !toUser || !fromActor || !toActor || !item) {
    dbg("GM could not resolve transfer request entities", { payload });
    return;
  }

  if (!isAllowedItem(item)) {
    await emitToModuleSocket({
      type: MSG.INFO_TO_USERS,
      toUserIds: [payload.fromUserId],
      message: "Only Armour, Gear, and Weapon items can be sent."
    });
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
          <div><b>${escapeHtml(payload.fromUserName ?? "Player")}</b> wants to send you:</div>
          <div style="font-size:14px;"><b>${escapeHtml(payload.itemName ?? "Item")}</b> <span style="opacity:.8">(${escapeHtml(typeLabel)})</span></div>
        </div>
      </div>
      <hr/>
      <p>Accept to move the item into your character's inventory.</p>
    </div>
  `;

  new Dialog({
    title: "Incoming item",
    content,
    buttons: {
      accept: {
        icon: '<i class="fas fa-check"></i>',
        label: "Accept",
        callback: async () => {
          await emitToModuleSocket({
            type: MSG.RESPONSE_TO_GM,
            accepted: true,
            request: payload,
            responderUserId: game.user.id
          });
          ui.notifications.info("Accepted. The GM will complete the transfer.");
        }
      },
      decline: {
        icon: '<i class="fas fa-times"></i>',
        label: "Decline",
        callback: async () => {
          await emitToModuleSocket({
            type: MSG.RESPONSE_TO_GM,
            accepted: false,
            request: payload,
            responderUserId: game.user.id
          });
          ui.notifications.info("Declined.");
        }
      }
    },
    default: "accept"
  }).render(true);
}

async function handleResponseToGM(payload) {
  if (!game.user.isGM) return;

  const accepted = !!payload.accepted;
  const req = payload.request;
  if (!req) return;

  const fromActor = game.actors.get(req.fromActorId);
  const toActor = game.actors.get(req.toActorId);
  const item = fromActor?.items?.get(req.itemId);

  const fromUser = game.users.get(req.fromUserId);
  const toUser = game.users.get(req.toUserId);

  if (!fromActor || !toActor || !fromUser || !toUser) {
    dbg("GM could not resolve transfer on response", payload);
    return;
  }

  if (!accepted) {
    await emitToModuleSocket({
      type: MSG.INFO_TO_USERS,
      toUserIds: [req.fromUserId],
      message: `${toUser.name} declined your item transfer.`
    });
    return;
  }

  if (!item) {
    await emitToModuleSocket({
      type: MSG.INFO_TO_USERS,
      toUserIds: [req.fromUserId, req.toUserId],
      message: `Item no longer exists in ${fromActor.name}'s inventory.`
    });
    return;
  }

  if (!isAllowedItem(item)) {
    await emitToModuleSocket({
      type: MSG.INFO_TO_USERS,
      toUserIds: [req.fromUserId],
      message: "Only Armour, Gear, and Weapon items can be sent."
    });
    return;
  }

  const itemData = item.toObject();
  try {
    await toActor.createEmbeddedDocuments("Item", [itemData]);
    await fromActor.deleteEmbeddedDocuments("Item", [item.id]);

    await emitToModuleSocket({
      type: MSG.INFO_TO_USERS,
      toUserIds: [req.fromUserId, req.toUserId],
      message: `Transferred "${item.name}" from ${fromActor.name} to ${toActor.name}.`
    });
  } catch (err) {
    console.error(`${MODULE_ID} | item-transfer | GM transfer failed`, err);
    await emitToModuleSocket({
      type: MSG.INFO_TO_USERS,
      toUserIds: [req.fromUserId, req.toUserId],
      message: `Transfer failed (GM: see console).`
    });
  }
}

async function handleInfoToUsers(payload) {
  const ids = Array.isArray(payload.toUserIds) ? payload.toUserIds : [];
  if (ids.length && !ids.includes(game.user.id)) return;
  if (payload.message) ui.notifications?.info(payload.message);
}

function getOnlinePlayersWithCharacters() {
  return game.users
    .filter(u => u.active && !u.isGM && u.character)
    .map(u => ({ id: u.id, name: u.name, character: u.character }));
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
