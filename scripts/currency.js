import './talent-fix.js';

const MODID = "genesys-ffg-options-enhancer";

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
        ui.notifications.info(game.i18n.localize("GFOE.Sent"));
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
        ui.notifications.info(game.i18n.localize("GFOE.Sent"));
        this.render(true);
      } catch (err) {
        console.error(err);
        ui.notifications.error(err.message ?? err);
      }
    });
}
}

export class GFOECurrency {

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
  
static async removeCoinsSpecific(actor, delta) {
    delta = { g: Math.max(0, Math.floor(delta.g||0)), s: Math.max(0, Math.floor(delta.s||0)), b: Math.max(0, Math.floor(delta.b||0)) };
    const bal = this.getBalance(actor);

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
      const ratio = Math.floor(fromVal / toVal);
      toGain = amount * ratio;
      remainderFrom = 0;
    } else if (fromVal < toVal) {
      const ratio = Math.floor(toVal / fromVal);
      toGain = Math.floor(amount / ratio);
      remainderFrom = amount % ratio;
    } else {
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
    const newS = { g: sBal.g - (delta.g||0), s: sBal.s - (delta.s||0), b: sBal.b - (delta.b||0) };
    if (newS.g < 0 || newS.s < 0 || newS.b < 0) throw new Error(game.i18n.localize("GFOE.ErrNotEnoughSpecific"));
    await this.setBalance(sender, newS);
    const rBal = this.getBalance(recipient);
    const newR = { g: rBal.g + (delta.g||0), s: rBal.s + (delta.s||0), b: rBal.b + (delta.b||0) };
    await this.setBalance(recipient, newR);
  }

  
  static async sendCoinsSpecific(senderActor, recipientId, delta) {
    delta = { g: Math.max(0, Math.floor(delta.g||0)), s: Math.max(0, Math.floor(delta.s||0)), b: Math.max(0, Math.floor(delta.b||0)) };
    if (!recipientId) throw new Error(game.i18n.localize("GFOE.ErrNoRecipient"));
    const bal = this.getBalance(senderActor);
    if (delta.g > (bal.g||0) || delta.s > (bal.s||0) || delta.b > (bal.b||0)) {
      throw new Error(game.i18n.localize("GFOE.ErrNotEnoughSpecific"));
    }
    const offer = {
      type: "currencyOffer",
      id: (crypto?.randomUUID?.() || foundry.utils.randomID?.(16) || `${Date.now()}-${Math.floor(Math.random()*1e9)}`),
      mode: "specific",
      senderId: senderActor.id,
      recipientId,
      delta
    };
    game.socket.emit("module."+MODID, offer);
  

  }
  static async sendCoinsByValue(senderActor, recipientId, amount, unit) {
    amount = Math.max(0, Math.floor(amount||0));
    if (!recipientId) throw new Error(game.i18n.localize("GFOE.ErrNoRecipient"));
    if (amount <= 0) return;
    const balBase = this.toBase(this.getBalance(senderActor));
    const {silverPerGold, bronzePerSilver} = this.ratios();
    const coinValue = (u) => (u === "g" ? silverPerGold * bronzePerSilver : (u === "s" ? bronzePerSilver : 1));
    const reqBase = amount * coinValue(unit);
    if (reqBase > balBase) {
      throw new Error(game.i18n.localize("GFOE.ErrNotEnoughFunds"));
    }
    const offer = {
      type: "currencyOffer",
      id: (crypto?.randomUUID?.() || foundry.utils.randomID?.(16) || `${Date.now()}-${Math.floor(Math.random()*1e9)}`),
      mode: "value",
      senderId: senderActor.id,
      recipientId,
      amount,
      unit
    };
    game.socket.emit("module."+MODID, offer);
  }

}

export function registerCurrencyUIHook() {
  Hooks.on("renderActorSheet", (app, html, data) => {
    try {
      const actor = app.actor;
      if (!actor || actor.type !== "character") return;

      const tab = html.find(".tab.items");
      if (!tab.length) return;

      const headerEl = tab.find(".items-header .header-name").filter((i,e)=>{
        return e?.innerText?.trim() === game.i18n.localize("SWFFG.ItemsGear");
      }).closest(".items-header");

      if (!headerEl.length) return;

      if (headerEl.find(".gfoe-currency-btn").length) return;

      const btn = $(`<div class="gfoe-currency-btn" title="${game.i18n.localize("GFOE.OpenCurrency")}"><i class="fa-solid fa-coins"></i></div>`);
      btn.css({ cursor: "pointer", display: "inline-flex", "align-items":"center", "justify-content":"center", "margin-left":"6px" });
      headerEl.append(btn);

      btn.on("click", (ev) => {
        ev.preventDefault();
        const app = new GFOECurrencyApp(actor, {});
        app.render(true);
      });
    } catch (e) {
      console.error("GFOE currency hook error:", e);
    }
  });
}


export function registerCurrencySocket() {
  if (!game.socket) return;
  game.socket.on("module."+MODID, async (payload) => {
    try {
      if (payload?.type === "currencyOffer") {
        const recipient = game.actors.get(payload.recipientId);
        if (!recipient) return;
        if (!recipient.isOwner && !game.user.isGM) return;

        const sender = game.actors.get(payload.senderId);
        const senderName = sender?.name ?? game.i18n.localize("GFOE.Unknown");
        let content = "";
        if (payload.mode === "specific") {
          const d = payload.delta || {g:0,s:0,b:0};
          content = `<p>${senderName} ${game.i18n.localize("GFOE.OffersYou")}: ${d.g} ${game.i18n.localize("GFOE.Gold")}, ${d.s} ${game.i18n.localize("GFOE.Silver")}, ${d.b} ${game.i18n.localize("GFOE.Bronze")}.</p>`;
        } else {
          content = `<p>${senderName} ${game.i18n.localize("GFOE.OffersYouValue")}: ${payload.amount} ${game.i18n.localize(payload.unit === "g" ? "GFOE.Gold" : payload.unit === "s" ? "GFOE.Silver" : "GFOE.Bronze")}.</p>`;
        }

        const d = new Dialog({
          title: game.i18n.localize("GFOE.TransferOfferTitle"),
          content,
          buttons: {
            ok: {
              label: game.i18n.localize("GFOE.Accept"),
              callback: () => game.socket.emit("module."+MODID, { type: "currencyOfferAccept", id: payload.id, payload })
            },
            no: {
              label: game.i18n.localize("GFOE.Decline"),
              callback: () => game.socket.emit("module."+MODID, { type: "currencyOfferDecline", id: payload.id, payload })
            }
          },
          default: "ok"
        });
        d.render(true);
        return;
      }

      if (!game.user.isGM) return;

      if (payload?.type === "currencyOfferAccept") {
        const data = payload.payload;
        const sender = game.actors.get(data.senderId);
        const recipient = game.actors.get(data.recipientId);
        if (!sender || !recipient) return;
        try {
          if (data.mode === "specific") {
            await GFOECurrency._applyTransfer(sender, recipient, data.delta || {g:0,s:0,b:0});
          } else {
            await GFOECurrency.removeCoinsByValue(sender, data.amount, data.unit);
            const {silverPerGold, bronzePerSilver} = GFOECurrency.ratios();
            const coinValue = (u) => (u === "g" ? silverPerGold * bronzePerSilver : (u === "s" ? bronzePerSilver : 1));
            const reqBase = data.amount * coinValue(data.unit);
            const base = GFOECurrency.toBase(GFOECurrency.getBalance(recipient)) + reqBase;
            const newR = GFOECurrency.fromBase(base);
            await GFOECurrency.setBalance(recipient, newR);
          }
          ui.notifications.info(game.i18n.localize("GFOE.TransferCompleted"));
        } catch (e) {
          console.error(e);
          ui.notifications.error(game.i18n.localize("GFOE.TransferFailed"));
        }
        return;
      } else if (payload?.type === "currencyOfferDecline") {
        ui.notifications.info(game.i18n.localize("GFOE.TransferDeclined"));
        return;
      }
    } catch (e) {
      console.error("GFOE socket error:", e);
    }
  });
}

export function registerCurrencyAutoRefresh() {
  try {
    Hooks.on("updateActor", (actor, diff) => {
      try {
        const flags = diff?.flags?.[MODID];
        if (flags && Object.prototype.hasOwnProperty.call(flags, "currency")) {
          const win = Object.values(ui.windows || {}).find(w => w?.id === "gfoe-currency-app");
          if (win && win.actor?.id === actor.id) win.render(true);
        }
      } catch (e) { console.error(e); }
    });

    if (game.socket) {
      game.socket.on("module."+MODID, (payload) => {
        try {
          if (payload?.type === "currencyRefresh") {
            const win = Object.values(ui.windows || {}).find(w => w?.id === "gfoe-currency-app");
            if (win && payload.actorIds && payload.actorIds.includes?.(win.actor?.id)) win.render(true);
          }
        } catch (e) { console.error(e); }
      });
    }
  } catch (e) { console.error("GFOE auto-refresh hook error:", e); }
}

Hooks.once('ready', () => { try { GFOEi18n.init(); } catch(e){ console.error(e);} });
