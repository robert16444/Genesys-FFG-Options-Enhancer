import './talent-fix.js';
import { ownerDocumentOf } from './popout-compat.js';

// Currency Manager for Genesys FFG Options Enhancer
const MODID = "genesys-ffg-options-enhancer";
const pendingCurrencyTransfers = new Map();
const currencyTransfersInProgress = new Set();
const processedCurrencyCommits = new Set();
let currencySocketRegistered = false;

function getPrimaryGM() {
  return Array.from(game.users ?? []).find(user => user?.active && user?.isGM) ?? null;
}

function isPrimaryGM() {
  return getPrimaryGM()?.id === game.user?.id;
}

function getRecipientUser(recipient) {
  const activeUsers = Array.from(game.users ?? []).filter(user => user?.active);
  const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const playerOwner = activeUsers.find(user => !user.isGM && recipient.testUserPermission?.(user, ownerLevel));
  if (playerOwner) return playerOwner;
  return getPrimaryGM();
}

async function emitCurrencySocket(payload) {
  return game.socket.emit(`module.${MODID}`, payload);
}

function refreshCurrencyWindows(actorIds = []) {
  const ids = new Set(actorIds);
  for (const app of Object.values(ui.windows ?? {})) {
    if (app?.id === "gfoe-currency-app" && ids.has(app.actor?.id)) {
      try { app.render(true); } catch (_) {}
    }
  }
}

function notifyLocal(message, level = "info") {
  const fn = ui.notifications?.[level] ?? ui.notifications?.info;
  fn?.call(ui.notifications, message);
}

function isCurrencyEnabled() {
  try {
    return game.settings.get(MODID, "enableCurrency");
  } catch (_) {
    return true;
  }
}

export const GFOEi18n = {
  dict: {},
  async init() {
    try {
      let selected = null;
      try { selected = game?.settings?.get?.(MODID, "language"); } catch(e) { selected = null; }
      if (!selected) { try { selected = game?.settings?.get?.(MODID, "uiLanguage"); } catch(e) { /* ignore */ } }

      const normalize = (v) => String(v || "").toLowerCase();
      let lang;
      const sel = normalize(selected);
      if (sel && sel !== "auto") {
        if (sel.startsWith("pl") || sel === "polski" || sel === "polish") lang = "pl";
        else lang = "en";
      } else {
        lang = normalize(game?.i18n?.lang) || normalize(navigator?.language) || "en";
      }

      const file = (String(lang||"").startsWith("pl")) ? "pl" : "en";
      const url = `modules/${MODID}/lang/${file}.json`;
      const resp = await fetch(url);
      if (resp.ok) {
        const dict = await resp.json();
        GFOEi18n.dict = dict || {};
        if (foundry && foundry.utils && game && game.i18n) {
          foundry.utils.mergeObject(game.i18n.translations, GFOEi18n.dict, { inplace: true });
        }
      }
    } catch (e) {
      console.error("GFOEi18n init failed:", e);
    }
  },
  localize(key) {
    try { if (game && game.i18n && game.i18n.localize) return game.i18n.localize(key); } catch(e) {}
    return (GFOEi18n.dict && GFOEi18n.dict[key]) || key;
  }
};


Hooks.once('init', () => { try { GFOEi18n.init(); } catch(e){ console.error(e);} });


export class GFOEAddCoinsApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gfoe-add-coins",
      title: game.i18n.localize("GFOE.AddCoins"),
      template: "modules/" + MODID + "/templates/add-coins.hbs",
      width: 380, resizable: false
    });
  }
  constructor(actor, opts={}) { super(opts); this.actor = actor; }
  async getData() {
    await (GFOEi18n?.init?.() || Promise.resolve());
 return {}; }
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".open-add").on("click", () => new GFOEAddCoinsApp(this.actor).render(true));
    html.find(".open-remove").on("click", () => new GFOERemoveCoinsApp(this.actor).render(true));
    html.find(".open-exchange").on("click", () => new GFOEExchangeCoinsApp(this.actor).render(true));
    html.find(".open-send").on("click", () => new GFOESendCoinsApp(this.actor).render(true));
    super.activateListeners(html);
    html.find(".apply-add").on("click", async () => {
      const g = Number(html.find("input[name='add-g']").val()) || 0;
      const s = Number(html.find("input[name='add-s']").val()) || 0;
      const b = Number(html.find("input[name='add-b']").val()) || 0;
      await GFOECurrency.addCoins(this.actor, {g,s,b});
      ui.notifications.info(game.i18n.localize("GFOE.Added"));
      const mgr = Object.values(ui.windows || {}).find(w => w?.id === 'gfoe-currency-app');
      if (mgr) mgr.render(true);
    
      this.close(); 
    });
  }
}

export class GFOERemoveCoinsApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gfoe-remove-coins",
      title: game.i18n.localize("GFOE.RemoveCoins"),
      template: "modules/" + MODID + "/templates/remove-coins.hbs",
      width: 420, resizable: false
    });
  }
  constructor(actor, opts={}) { super(opts); this.actor = actor; }
  async getData() {
    await (GFOEi18n?.init?.() || Promise.resolve());
 return {}; }
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".open-add").on("click", () => new GFOEAddCoinsApp(this.actor).render(true));
    html.find(".open-remove").on("click", () => new GFOERemoveCoinsApp(this.actor).render(true));
    html.find(".open-exchange").on("click", () => new GFOEExchangeCoinsApp(this.actor).render(true));
    html.find(".open-send").on("click", () => new GFOESendCoinsApp(this.actor).render(true));
    super.activateListeners(html);
    html.find("input[name='remove-mode']").on("change", ev => {
      const mode = ev.currentTarget.value || html.find("input[name='remove-mode']:checked").val();
      html.find(".remove-specific").toggle(mode === "specific");
      html.find(".remove-value").toggle(mode === "value");
    });
    html.find(".apply-remove").on("click", async () => {
      const mode = html.find("input[name='remove-mode']:checked").val();
      try {
        if (mode === "specific") {
          const g = Number(html.find("input[name='rem-g']").val()) || 0;
          const s = Number(html.find("input[name='rem-s']").val()) || 0;
          const b = Number(html.find("input[name='rem-b']").val()) || 0;
          await GFOECurrency.removeCoinsSpecific(this.actor, {g,s,b});
        } else {
          const amount = Number(html.find("input[name='rem-amount']").val()) || 0;
          const unit = html.find("input[name='rem-unit']:checked").val();
          await GFOECurrency.removeCoinsByValue(this.actor, amount, unit);
        }
        ui.notifications.info(game.i18n.localize("GFOE.Removed"));
      const mgr = Object.values(ui.windows || {}).find(w => w?.id === 'gfoe-currency-app');
      if (mgr) mgr.render(true);
        this.close();
      } catch (err) {
        console.error(err);
        ui.notifications.error(err.message ?? err);
      }
    });
  }
}

export class GFOEExchangeCoinsApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gfoe-exchange-coins",
      title: game.i18n.localize("GFOE.ExchangeCoins"),
      template: "modules/" + MODID + "/templates/exchange-coins.hbs",
      width: 420, resizable: false
    });
  }
  constructor(actor, opts={}) { super(opts); this.actor = actor; }
  async getData() {
    await (GFOEi18n?.init?.() || Promise.resolve());
 return {}; }
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".open-add").on("click", () => new GFOEAddCoinsApp(this.actor).render(true));
    html.find(".open-remove").on("click", () => new GFOERemoveCoinsApp(this.actor).render(true));
    html.find(".open-exchange").on("click", () => new GFOEExchangeCoinsApp(this.actor).render(true));
    html.find(".open-send").on("click", () => new GFOESendCoinsApp(this.actor).render(true));
    super.activateListeners(html);
    html.find(".apply-exchange").on("click", async () => {
      const amount = Number(html.find("input[name='ex-amount']").val()) || 0;
      const from = html.find("input[name='ex-from']:checked").val();
      const to = html.find("input[name='ex-to']:checked").val();
      try {
        await GFOECurrency.exchange(this.actor, amount, from, to);
        ui.notifications.info(game.i18n.localize("GFOE.Exchanged"));
        const mgr = Object.values(ui.windows || {}).find(w => w?.id === 'gfoe-currency-app');
        if (mgr) mgr.render(true);
        this.close();
      } catch (err) {
        console.error(err);
        ui.notifications.error(err.message ?? err);
      }
    });
  }
}

export class GFOESendCoinsApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gfoe-send-coins",
      title: game.i18n.localize("GFOE.SendCoins"),
      template: "modules/" + MODID + "/templates/send-coins.hbs",
      width: 440, resizable: false
    });
  }
  constructor(actor, opts={}) { super(opts); this.actor = actor; }
  async getData() {
    await (GFOEi18n?.init?.() || Promise.resolve());

    const contents = (game.actors && game.actors.contents) ? game.actors.contents : Array.from(game.actors ?? []);
    const recipients = contents.filter(a => a && a.type === "character" && a.id !== this.actor.id).map(a => ({id:a.id, name:a.name}));
    return { recipients };
  }
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".open-add").on("click", () => new GFOEAddCoinsApp(this.actor).render(true));
    html.find(".open-remove").on("click", () => new GFOERemoveCoinsApp(this.actor).render(true));
    html.find(".open-exchange").on("click", () => new GFOEExchangeCoinsApp(this.actor).render(true));
    html.find(".open-send").on("click", () => new GFOESendCoinsApp(this.actor).render(true));
    super.activateListeners(html);
    html.find("input[name='send-mode']").on("change", ev => {
      const mode = ev.currentTarget.value || html.find("input[name='send-mode']:checked").val();
      html.find(".send-specific").toggle(mode === "specific");
      html.find(".send-value").toggle(mode === "value");
    });
    html.find(".apply-send").on("click", async () => {
      const targetId = html.find("select[name='send-target']").val();
      if (!targetId) { ui.notifications.error(game.i18n.localize("GFOE.ErrNoRecipient")); return; }
      const mode = html.find("input[name='send-mode']:checked").val();
      try {
        if (mode === "specific") {
          const g = Number(html.find("input[name='send-g']").val()) || 0;
          const s = Number(html.find("input[name='send-s']").val()) || 0;
          const b = Number(html.find("input[name='send-b']").val()) || 0;
          await GFOECurrency.sendCoinsSpecific(this.actor, targetId, {g,s,b});
        } else {
          const amount = Number(html.find("input[name='send-amount']").val()) || 0;
          const unit = html.find("input[name='send-unit']:checked").val();
          await GFOECurrency.sendCoinsByValue(this.actor, targetId, amount, unit);
        }
        this.close();
      } catch (err) {
        console.error(err);
        ui.notifications.error(err.message ?? err);
      }
    });
  }
}

export class GFOECurrencyApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "gfoe-currency-app",
      title: game.i18n.localize("GFOE.CurrencyTitle"),
      template: "modules/" + MODID + "/templates/currency-ui.hbs",
      width: 420,
      height: "auto",
      resizable: false
    });
  }

  constructor(actor, options={}) {
    super(options);
    this.actor = actor;
  }

  /** @override */
  async getData(options={}) {
    await (GFOEi18n?.init?.() || Promise.resolve());

    const bal = GFOECurrency.getBalance(this.actor);
    const recipients = ((game.actors && game.actors.contents) ? game.actors.contents : Array.from(game.actors ?? []))
      .filter(a => a && a.type === "character" && a.id !== this.actor.id)
      .map(a => ({ id: a.id, name: a.name }));
    return {
      balance: bal,
      recipients
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find(".open-add").on("click", () => new GFOEAddCoinsApp(this.actor).render(true));
    html.find(".open-remove").on("click", () => new GFOERemoveCoinsApp(this.actor).render(true));
    html.find(".open-exchange").on("click", () => new GFOEExchangeCoinsApp(this.actor).render(true));
    html.find(".open-send").on("click", () => new GFOESendCoinsApp(this.actor).render(true));
    super.activateListeners(html);

    html.find("input[name='rem-amount']").on("focus", () => {
      html.find("input[name='remove-mode'][value='value']").prop("checked", true).trigger("change");
    });

    html.find("input[name='remove-mode']").on("change", ev => {
      const mode = ev.currentTarget.value || html.find("input[name='remove-mode']:checked").val();
      html.find(".remove-specific").toggle(mode === "specific");
      html.find(".remove-value").toggle(mode === "value");
    });

    html.find(".apply-add").on("click", async () => {
      const g = Number(html.find("input[name='add-g']").val()) || 0;
      const s = Number(html.find("input[name='add-s']").val()) || 0;
      const b = Number(html.find("input[name='add-b']").val()) || 0;
      await GFOECurrency.addCoins(this.actor, {g, s, b});
      ui.notifications.info(game.i18n.localize("GFOE.Added"));
      const mgr = Object.values(ui.windows || {}).find(w => w?.id === 'gfoe-currency-app');
      if (mgr) mgr.render(true);
    
      this.render(true);
    });

    html.find(".apply-remove").on("click", async () => {
      const mode = html.find("input[name='remove-mode']:checked").val();
      try {
        if (mode === "specific") {
          const g = Number(html.find("input[name='rem-g']").val()) || 0;
          const s = Number(html.find("input[name='rem-s']").val()) || 0;
          const b = Number(html.find("input[name='rem-b']").val()) || 0;
          await GFOECurrency.removeCoinsSpecific(this.actor, {g, s, b});
        } else {
          const amount = Number(html.find("input[name='rem-amount']").val()) || 0;
          const unit = html.find("input[name='rem-unit']:checked").val();
          await GFOECurrency.removeCoinsByValue(this.actor, amount, unit);
        }
        ui.notifications.info(game.i18n.localize("GFOE.Removed"));
      const mgr = Object.values(ui.windows || {}).find(w => w?.id === 'gfoe-currency-app');
      if (mgr) mgr.render(true);
        this.render(true);
      } catch (err) {
        console.error(err);
        ui.notifications.error(err.message ?? err);
      }
    });
  
    html.find(".apply-exchange").on("click", async () => {
      const amount = Number(html.find("input[name='ex-amount']").val()) || 0;
      const from = html.find("input[name='ex-from']:checked").val();
      const to = html.find("input[name='ex-to']:checked").val();
      try {
        await GFOECurrency.exchange(this.actor, amount, from, to);
        ui.notifications.info(game.i18n.localize("GFOE.Exchanged"));
        const mgr = Object.values(ui.windows || {}).find(w => w?.id === 'gfoe-currency-app');
        if (mgr) mgr.render(true);
        this.render(true);
      } catch (err) {
        console.error(err);
        ui.notifications.error(err.message ?? err);
      }
    });

    html.find("input[name='send-mode']").on("change", ev => {
      const mode = ev.currentTarget.value || html.find("input[name='send-mode']:checked").val();
      html.find(".send-specific").toggle(mode === "specific");
      html.find(".send-value").toggle(mode === "value");
    });

    html.find(".apply-send").on("click", async () => {
      const targetId = html.find("select[name='send-target']").val();
      if (!targetId) { ui.notifications.error(game.i18n.localize("GFOE.ErrNoRecipient")); return; }
      const mode = html.find("input[name='send-mode']:checked").val();
      try {
        if (mode === "specific") {
          const g = Number(html.find("input[name='send-g']").val()) || 0;
          const s = Number(html.find("input[name='send-s']").val()) || 0;
          const b = Number(html.find("input[name='send-b']").val()) || 0;
          await GFOECurrency.sendCoinsSpecific(this.actor, targetId, {g, s, b});
        } else {
          const amount = Number(html.find("input[name='send-amount']").val()) || 0;
          const unit = html.find("input[name='send-unit']:checked").val();
          await GFOECurrency.sendCoinsByValue(this.actor, targetId, amount, unit);
        }
        this.render(true);
      } catch (err) {
        console.error(err);
        ui.notifications.error(err.message ?? err);
      }
    });
}
}

export class GFOECurrency {

  // Settings helpers
  static ratios() {
    const silverPerGold = Number(game.settings.get(MODID, "silverPerGold") ?? 10);
    const bronzePerSilver = Number(game.settings.get(MODID, "bronzePerSilver") ?? 10);
    return { silverPerGold, bronzePerSilver };
  }

  static toBase({g=0,s=0,b=0}) {
    const {silverPerGold, bronzePerSilver} = this.ratios();
    const totalBronze = (g * silverPerGold * bronzePerSilver) + (s * bronzePerSilver) + b;
    return totalBronze;
  }

  static fromBase(bronzeTotal) {
    const {silverPerGold, bronzePerSilver} = this.ratios();
    const bronzePerGold = silverPerGold * bronzePerSilver;

    const g = Math.floor(bronzeTotal / bronzePerGold);
    bronzeTotal -= g * bronzePerGold;

    const s = Math.floor(bronzeTotal / bronzePerSilver);
    bronzeTotal -= s * bronzePerSilver;

    const b = bronzeTotal;
    return { g, s, b };
  }

  static getBalance(actor) {
    const data = actor.getFlag(MODID, "currency") ?? { g: 0, s: 0, b: 0 };
    return foundry.utils.mergeObject({g:0,s:0,b:0}, data);
  }

  static async setBalance(actor, balance) {
    const sanitized = {
      g: Math.max(0, Math.floor(balance.g||0)),
      s: Math.max(0, Math.floor(balance.s||0)),
      b: Math.max(0, Math.floor(balance.b||0)),
    };
    return actor.setFlag(MODID, "currency", sanitized);
  }

  static async addCoins(actor, delta) {
    const bal = this.getBalance(actor);
    const newBal = {
      g: (bal.g||0) + Math.max(0, Math.floor(delta.g||0)),
      s: (bal.s||0) + Math.max(0, Math.floor(delta.s||0)),
      b: (bal.b||0) + Math.max(0, Math.floor(delta.b||0)),
    };
    return this.setBalance(actor, newBal);
  }

  // Remove specific coins; make change if necessary
  
static async removeCoinsSpecific(actor, delta) {
    delta = { g: Math.max(0, Math.floor(delta.g||0)), s: Math.max(0, Math.floor(delta.s||0)), b: Math.max(0, Math.floor(delta.b||0)) };
    const bal = this.getBalance(actor);

    // No auto-change here: check exact availability per denomination
    if (delta.g > (bal.g||0) || delta.s > (bal.s||0) || delta.b > (bal.b||0)) {
      throw new Error(game.i18n.localize("GFOE.ErrNotEnoughSpecific"));
    }

    const newBal = {
      g: (bal.g||0) - delta.g,
      s: (bal.s||0) - delta.s,
      b: (bal.b||0) - delta.b
    };
    return this.setBalance(actor, newBal);
  }




  // Remove by value in chosen unit, prioritizing target unit first, then auto-make change
  static async removeCoinsByValue(actor, amount, unit) {
    amount = Math.max(0, Math.floor(amount||0));
    if (amount <= 0) return;

    const {silverPerGold, bronzePerSilver} = this.ratios();
    const coinValue = (u) => (u === "g" ? silverPerGold * bronzePerSilver : (u === "s" ? bronzePerSilver : 1));

    const bal = foundry.utils.duplicate(this.getBalance(actor));
    const totalBase = this.toBase(bal);
    let reqBase = amount * coinValue(unit);

    if (reqBase > totalBase) {
      throw new Error(game.i18n.localize("GFOE.ErrNotEnoughFunds"));
    }

    // Prefer the chosen unit first
    if (unit === "g") {
      const pay = Math.min(bal.g||0, amount);
      bal.g = (bal.g||0) - pay;
      reqBase -= pay * coinValue("g");
    } else if (unit === "s") {
      const pay = Math.min(bal.s||0, amount);
      bal.s = (bal.s||0) - pay;
      reqBase -= pay * coinValue("s");
    } else {
      const pay = Math.min(bal.b||0, amount);
      bal.b = (bal.b||0) - pay;
      reqBase -= pay * coinValue("b");
    }

    // Still owed -> consume from rest using change
    if (reqBase > 0) {
      const baseLeft = this.toBase(bal);
      const newBase = baseLeft - reqBase;
      const newBal = this.fromBase(newBase);
      bal.g = newBal.g;
      bal.s = newBal.s;
      bal.b = newBal.b;
    }

    return this.setBalance(actor, bal);
  }

  // Exchange coins between denominations (uses module ratios). 
  // For higher->lower: exact multiplication. For lower->higher: convert as much as possible, keep remainder in source coin.
  static async exchange(actor, amount, from, to) {
    amount = Math.max(0, Math.floor(amount||0));
    if (amount <= 0) return;
    if (from === to) throw new Error(game.i18n.localize("GFOE.ErrSameUnit"));

    const bal = this.getBalance(actor);
    const map = { g: "g", s: "s", b: "b" };
    if (!map[from] || !map[to]) throw new Error("Invalid unit");
    if ((bal[from]||0) < amount) throw new Error(game.i18n.localize("GFOE.ErrNotEnoughSpecific"));

    const {silverPerGold, bronzePerSilver} = this.ratios();
    const coinValue = (u) => (u === "g" ? silverPerGold * bronzePerSilver : (u === "s" ? bronzePerSilver : 1));

    const fromVal = coinValue(from);
    const toVal = coinValue(to);

    let toGain = 0;
    let remainderFrom = 0;

    if (fromVal > toVal) {
      // higher -> lower: multiply
      const ratio = Math.floor(fromVal / toVal);
      toGain = amount * ratio;
      remainderFrom = 0;
    } else if (fromVal < toVal) {
      // lower -> higher: divide, keep remainder
      const ratio = Math.floor(toVal / fromVal);
      toGain = Math.floor(amount / ratio);
      remainderFrom = amount % ratio;
    } else {
      // equal (shouldn't happen unless same unit)
      toGain = amount;
      remainderFrom = 0;
    }

    const newBal = foundry.utils.duplicate(bal);
    newBal[from] = (newBal[from]||0) - amount + remainderFrom;
    newBal[to] = (newBal[to]||0) + toGain;

    return this.setBalance(actor, newBal);
  }

  static async _applyTransfer(sender, recipient, delta) {
    const sBal = this.getBalance(sender);
    const rBal = this.getBalance(recipient);
    const newS = { g: sBal.g - (delta.g||0), s: sBal.s - (delta.s||0), b: sBal.b - (delta.b||0) };
    if (newS.g < 0 || newS.s < 0 || newS.b < 0) throw new Error(game.i18n.localize("GFOE.ErrNotEnoughSpecific"));
    const newR = { g: rBal.g + (delta.g||0), s: rBal.s + (delta.s||0), b: rBal.b + (delta.b||0) };
    try {
      await this.setBalance(sender, newS);
      await this.setBalance(recipient, newR);
    } catch (error) {
      try { await this.setBalance(sender, sBal); } catch (_) {}
      try { await this.setBalance(recipient, rBal); } catch (_) {}
      throw error;
    }
    return { sender: newS, recipient: newR };
  }

  static balanceAfterValueRemoval(balance, amount, unit) {
    amount = Math.max(0, Math.floor(amount||0));
    const bal = foundry.utils.duplicate(balance ?? { g: 0, s: 0, b: 0 });
    if (amount <= 0) return bal;
    const {silverPerGold, bronzePerSilver} = this.ratios();
    const coinValue = (u) => (u === "g" ? silverPerGold * bronzePerSilver : (u === "s" ? bronzePerSilver : 1));
    const totalBase = this.toBase(bal);
    let reqBase = amount * coinValue(unit);
    if (reqBase > totalBase) throw new Error(game.i18n.localize("GFOE.ErrNotEnoughFunds"));
    if (unit === "g") {
      const pay = Math.min(bal.g||0, amount);
      bal.g = (bal.g||0) - pay;
      reqBase -= pay * coinValue("g");
    } else if (unit === "s") {
      const pay = Math.min(bal.s||0, amount);
      bal.s = (bal.s||0) - pay;
      reqBase -= pay * coinValue("s");
    } else {
      const pay = Math.min(bal.b||0, amount);
      bal.b = (bal.b||0) - pay;
      reqBase -= pay;
    }
    if (reqBase > 0) {
      const newBal = this.fromBase(this.toBase(bal) - reqBase);
      bal.g = newBal.g;
      bal.s = newBal.s;
      bal.b = newBal.b;
    }
    return bal;
  }

  static async _applyValueTransfer(sender, recipient, amount, unit) {
    amount = Math.max(0, Math.floor(amount||0));
    if (amount <= 0) return { sender: this.getBalance(sender), recipient: this.getBalance(recipient) };
    const sBal = this.getBalance(sender);
    const rBal = this.getBalance(recipient);
    const newS = this.balanceAfterValueRemoval(sBal, amount, unit);
    const {silverPerGold, bronzePerSilver} = this.ratios();
    const coinValue = (u) => (u === "g" ? silverPerGold * bronzePerSilver : (u === "s" ? bronzePerSilver : 1));
    const newR = this.fromBase(this.toBase(rBal) + amount * coinValue(unit));
    try {
      await this.setBalance(sender, newS);
      await this.setBalance(recipient, newR);
    } catch (error) {
      try { await this.setBalance(sender, sBal); } catch (_) {}
      try { await this.setBalance(recipient, rBal); } catch (_) {}
      throw error;
    }
    return { sender: newS, recipient: newR };
  }

  static async sendCoinsSpecific(senderActor, recipientId, delta) {
    delta = { g: Math.max(0, Math.floor(delta.g||0)), s: Math.max(0, Math.floor(delta.s||0)), b: Math.max(0, Math.floor(delta.b||0)) };
    if (!recipientId) throw new Error(game.i18n.localize("GFOE.ErrNoRecipient"));
    if (delta.g + delta.s + delta.b <= 0) return;
    const recipient = game.actors.get(recipientId);
    if (!recipient || recipient.id === senderActor.id) throw new Error(game.i18n.localize("GFOE.ErrNoRecipient"));
    const bal = this.getBalance(senderActor);
    if (delta.g > (bal.g||0) || delta.s > (bal.s||0) || delta.b > (bal.b||0)) throw new Error(game.i18n.localize("GFOE.ErrNotEnoughSpecific"));
    const recipientUser = getRecipientUser(recipient);
    if (!recipientUser) throw new Error(game.i18n.localize("GFOE.ErrNoRecipientUser"));
    const offer = {
      id: crypto?.randomUUID?.() || foundry.utils.randomID?.(16) || `${Date.now()}-${Math.floor(Math.random()*1e9)}`,
      senderUserId: game.user.id,
      senderActorId: senderActor.id,
      recipientActorId: recipient.id,
      recipientUserId: recipientUser.id,
      mode: "specific",
      delta,
      createdAt: Date.now()
    };
    pendingCurrencyTransfers.set(offer.id, offer);
    notifyLocal(game.i18n.localize("GFOE.OfferSent"));
    const outgoing = { type: "currencyOffer", ...offer, toUserId: recipientUser.id };
    if (recipientUser.id === game.user.id) await showCurrencyOffer(outgoing);
    else await emitCurrencySocket(outgoing);
  }

  static async sendCoinsByValue(senderActor, recipientId, amount, unit) {
    amount = Math.max(0, Math.floor(amount||0));
    if (!recipientId) throw new Error(game.i18n.localize("GFOE.ErrNoRecipient"));
    if (amount <= 0) return;
    const recipient = game.actors.get(recipientId);
    if (!recipient || recipient.id === senderActor.id) throw new Error(game.i18n.localize("GFOE.ErrNoRecipient"));
    const balBase = this.toBase(this.getBalance(senderActor));
    const {silverPerGold, bronzePerSilver} = this.ratios();
    const coinValue = (u) => (u === "g" ? silverPerGold * bronzePerSilver : (u === "s" ? bronzePerSilver : 1));
    if (amount * coinValue(unit) > balBase) throw new Error(game.i18n.localize("GFOE.ErrNotEnoughFunds"));
    const recipientUser = getRecipientUser(recipient);
    if (!recipientUser) throw new Error(game.i18n.localize("GFOE.ErrNoRecipientUser"));
    const offer = {
      id: crypto?.randomUUID?.() || foundry.utils.randomID?.(16) || `${Date.now()}-${Math.floor(Math.random()*1e9)}`,
      senderUserId: game.user.id,
      senderActorId: senderActor.id,
      recipientActorId: recipient.id,
      recipientUserId: recipientUser.id,
      mode: "value",
      amount,
      unit,
      createdAt: Date.now()
    };
    pendingCurrencyTransfers.set(offer.id, offer);
    notifyLocal(game.i18n.localize("GFOE.OfferSent"));
    const outgoing = { type: "currencyOffer", ...offer, toUserId: recipientUser.id };
    if (recipientUser.id === game.user.id) await showCurrencyOffer(outgoing);
    else await emitCurrencySocket(outgoing);
  }

  static async creditTransfer(recipient, offer) {
    const before = this.getBalance(recipient);
    let after;
    if (offer.mode === "specific") {
      const d = offer.delta ?? { g: 0, s: 0, b: 0 };
      after = { g: before.g + (d.g||0), s: before.s + (d.s||0), b: before.b + (d.b||0) };
    } else {
      const {silverPerGold, bronzePerSilver} = this.ratios();
      const coinValue = offer.unit === "g" ? silverPerGold * bronzePerSilver : offer.unit === "s" ? bronzePerSilver : 1;
      after = this.fromBase(this.toBase(before) + Math.max(0, Math.floor(offer.amount||0)) * coinValue);
    }
    await this.setBalance(recipient, after);
    return { before, after };
  }

}

// Hook to add the currency button to the Items (Gear) section on character sheets
export function registerCurrencyUIHook() {
  if (!isCurrencyEnabled()) return;
  Hooks.on("renderActorSheet", (app, html, data) => {
    if (!isCurrencyEnabled()) return;
    try {
      const actor = app.actor;
      if (!actor || actor.type !== "character") return;

      // Only on the Items tab content:
      const tab = html.find(".tab.items");
      if (!tab.length) return;

      // Find the Gear section header (with SWFFG.ItemsGear) and place a button there
      const headerEl = tab.find(".items-header .header-name").filter((i,e)=>{
        return e?.innerText?.trim() === game.i18n.localize("SWFFG.ItemsGear");
      }).closest(".items-header");

      if (!headerEl.length) return;

      // Avoid duplicate
      if (headerEl.find(".gfoe-currency-btn").length) return;

      const headerNode = headerEl[0];
      const btn = ownerDocumentOf(headerNode).createElement("div");
      btn.className = "gfoe-currency-btn";
      btn.title = game.i18n.localize("GFOE.OpenCurrency");
      btn.innerHTML = '<i class="fa-solid fa-coins"></i>';
      Object.assign(btn.style, { cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", marginLeft: "6px" });
      headerNode.appendChild(btn);

      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const currencyApp = new GFOECurrencyApp(actor, {});
        currencyApp.render(true);
      });
    } catch (e) {
      console.error("GFOE currency hook error:", e);
    }
  });
}


async function sendCurrencyInfo(userIds, message, level = "info") {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  if (ids.includes(game.user.id)) notifyLocal(message, level);
  const remoteIds = ids.filter(id => id !== game.user.id);
  if (remoteIds.length) await emitCurrencySocket({ type: "currencyInfo", toUserIds: remoteIds, message, level });
}

async function showCurrencyOffer(payload) {
  if (payload.toUserId !== game.user.id) return;
  const sender = game.actors.get(payload.senderActorId);
  const senderName = sender?.name ?? game.i18n.localize("GFOE.Unknown");
  let content;
  if (payload.mode === "specific") {
    const d = payload.delta ?? {g:0,s:0,b:0};
    content = `<p>${senderName} ${game.i18n.localize("GFOE.OffersYou")}: ${d.g} ${game.i18n.localize("GFOE.Gold")}, ${d.s} ${game.i18n.localize("GFOE.Silver")}, ${d.b} ${game.i18n.localize("GFOE.Bronze")}.</p>`;
  } else {
    const key = payload.unit === "g" ? "GFOE.Gold" : payload.unit === "s" ? "GFOE.Silver" : "GFOE.Bronze";
    content = `<p>${senderName} ${game.i18n.localize("GFOE.OffersYouValue")}: ${payload.amount} ${game.i18n.localize(key)}.</p>`;
  }
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) throw new Error("Foundry DialogV2 API is unavailable.");
  await DialogV2.wait({
    window: { title: game.i18n.localize("GFOE.TransferOfferTitle"), icon: "fa-solid fa-coins" },
    position: { width: 430, height: "auto" },
    content,
    modal: false,
    rejectClose: false,
    buttons: [
      {
        action: "accept",
        label: game.i18n.localize("GFOE.Accept"),
        icon: "fa-solid fa-check",
        default: true,
        callback: async () => {
          const response = { type: "currencyTransferResponse", id: payload.id, accepted: true, responderUserId: game.user.id, toUserId: payload.senderUserId };
          if (payload.senderUserId === game.user.id) await handleCurrencyTransferResponse(response);
          else await emitCurrencySocket(response);
        }
      },
      {
        action: "decline",
        label: game.i18n.localize("GFOE.Decline"),
        icon: "fa-solid fa-xmark",
        callback: async () => {
          const response = { type: "currencyTransferResponse", id: payload.id, accepted: false, responderUserId: game.user.id, toUserId: payload.senderUserId };
          if (payload.senderUserId === game.user.id) await handleCurrencyTransferResponse(response);
          else await emitCurrencySocket(response);
        }
      }
    ]
  });
}

async function handleCurrencyTransferResponse(payload) {
  if (payload.toUserId !== game.user.id) return;
  const offer = pendingCurrencyTransfers.get(payload.id);
  if (!offer || payload.responderUserId !== offer.recipientUserId) return;
  if (!payload.accepted) {
    pendingCurrencyTransfers.delete(payload.id);
    notifyLocal(game.i18n.localize("GFOE.TransferDeclined"));
    return;
  }
  if (currencyTransfersInProgress.has(offer.id)) return;
  currencyTransfersInProgress.add(offer.id);
  const sender = game.actors.get(offer.senderActorId);
  if (!sender || (!game.user.isGM && !sender.isOwner)) {
    pendingCurrencyTransfers.delete(offer.id);
    currencyTransfersInProgress.delete(offer.id);
    notifyLocal(game.i18n.localize("GFOE.TransferFailed"), "error");
    return;
  }
  const before = GFOECurrency.getBalance(sender);
  try {
    let after;
    if (offer.mode === "specific") {
      const d = offer.delta ?? { g: 0, s: 0, b: 0 };
      after = { g: before.g - (d.g||0), s: before.s - (d.s||0), b: before.b - (d.b||0) };
      if (after.g < 0 || after.s < 0 || after.b < 0) throw new Error(game.i18n.localize("GFOE.ErrNotEnoughSpecific"));
    } else {
      after = GFOECurrency.balanceAfterValueRemoval(before, offer.amount, offer.unit);
    }
    await GFOECurrency.setBalance(sender, after);
    offer.senderBalanceBefore = before;
    offer.status = "committing";
    pendingCurrencyTransfers.set(offer.id, offer);
    refreshCurrencyWindows([sender.id]);
    const commit = { type: "currencyTransferCommit", ...offer, toUserId: offer.recipientUserId };
    if (offer.recipientUserId === game.user.id) await handleCurrencyTransferCommit(commit);
    else await emitCurrencySocket(commit);
  } catch (error) {
    console.error("GFOE currency sender update failed:", error);
    pendingCurrencyTransfers.delete(offer.id);
    currencyTransfersInProgress.delete(offer.id);
    notifyLocal(error?.message || game.i18n.localize("GFOE.TransferFailed"), "error");
  }
}

async function handleCurrencyTransferCommit(payload) {
  if (payload.toUserId !== game.user.id) return;
  const recipient = game.actors.get(payload.recipientActorId);
  const result = { type: "currencyTransferResult", id: payload.id, toUserId: payload.senderUserId, responderUserId: game.user.id, success: false };
  try {
    if (!recipient || (!game.user.isGM && !recipient.isOwner)) throw new Error(game.i18n.localize("GFOE.TransferFailed"));
    if (!processedCurrencyCommits.has(payload.id)) {
      await GFOECurrency.creditTransfer(recipient, payload);
      processedCurrencyCommits.add(payload.id);
    }
    refreshCurrencyWindows([recipient.id]);
    result.success = true;
    notifyLocal(game.i18n.localize("GFOE.TransferCompleted"));
  } catch (error) {
    console.error("GFOE currency recipient update failed:", error);
    result.error = error?.message || game.i18n.localize("GFOE.TransferFailed");
    notifyLocal(result.error, "error");
  }
  if (payload.senderUserId === game.user.id) await handleCurrencyTransferResult(result);
  else await emitCurrencySocket(result);
}

async function handleCurrencyTransferResult(payload) {
  if (payload.toUserId !== game.user.id) return;
  const offer = pendingCurrencyTransfers.get(payload.id);
  if (!offer || payload.responderUserId !== offer.recipientUserId) return;
  const sender = game.actors.get(offer.senderActorId);
  if (payload.success) {
    pendingCurrencyTransfers.delete(offer.id);
    currencyTransfersInProgress.delete(offer.id);
    if (sender) refreshCurrencyWindows([sender.id]);
    notifyLocal(game.i18n.localize("GFOE.TransferCompleted"));
    return;
  }
  try {
    if (sender && offer.senderBalanceBefore) await GFOECurrency.setBalance(sender, offer.senderBalanceBefore);
  } catch (rollbackError) {
    console.error("GFOE currency rollback failed:", rollbackError);
  }
  pendingCurrencyTransfers.delete(offer.id);
  currencyTransfersInProgress.delete(offer.id);
  if (sender) refreshCurrencyWindows([sender.id]);
  notifyLocal(payload.error || game.i18n.localize("GFOE.TransferFailed"), "error");
}

export function registerCurrencySocket() {
  if (!isCurrencyEnabled() || !game.socket || currencySocketRegistered) return;
  currencySocketRegistered = true;
  game.socket.on(`module.${MODID}`, async payload => {
    try {
      if (!isCurrencyEnabled() || !payload?.type) return;
      if (payload.type === "currencyOffer") {
        await showCurrencyOffer(payload);
        return;
      }
      if (payload.type === "currencyTransferResponse") {
        await handleCurrencyTransferResponse(payload);
        return;
      }
      if (payload.type === "currencyTransferCommit") {
        await handleCurrencyTransferCommit(payload);
        return;
      }
      if (payload.type === "currencyTransferResult") {
        await handleCurrencyTransferResult(payload);
        return;
      }
      if (payload.type === "currencyInfo") {
        if (Array.isArray(payload.toUserIds) && payload.toUserIds.includes(game.user.id)) notifyLocal(payload.message, payload.level);
      }
    } catch (error) {
      console.error("GFOE socket error:", error);
    }
  });
}

export function registerCurrencyAutoRefresh() {
  if (!isCurrencyEnabled()) return;
  try {
    Hooks.on("updateActor", (actor, diff) => {
      if (!isCurrencyEnabled()) return;
      try {
        const flags = diff?.flags?.[MODID];
        if (flags && Object.prototype.hasOwnProperty.call(flags, "currency")) refreshCurrencyWindows([actor.id]);
      } catch (e) { console.error(e); }
    });

    if (game.socket) {
      game.socket.on("module."+MODID, (payload) => {
        try {
          if (payload?.type === "currencyRefresh") refreshCurrencyWindows(payload.actorIds ?? []);
        } catch (e) { console.error(e); }
      });
    }
  } catch (e) { console.error("GFOE auto-refresh hook error:", e); }
}

Hooks.once('ready', () => { try { GFOEi18n.init(); } catch(e){ console.error(e);} });
