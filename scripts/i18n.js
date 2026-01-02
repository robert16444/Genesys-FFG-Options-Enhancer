const MODULE_ID = "genesys-ffg-options-enhancer";

export const Lang = new class ModuleLanguage {
  constructor() {
    this.lang = "en";
    this.dicts = {};
  }

  async init() {
    const setting = game.settings.get(MODULE_ID, "language");
    const clientLang = game.i18n?.lang ?? "en";
    this.lang = setting || "en";

    this.dicts = {
      en: await (await fetch(`modules/${MODULE_ID}/lang/en.json`)).json(),
      pl: await (await fetch(`modules/${MODULE_ID}/lang/pl.json`)).json()
    };
  }

  t(path, data) {
    const pick = this.dicts?.[this.lang] ?? this.dicts?.en ?? {};
    let str = path.split(".").reduce((o,k)=> (o&&o[k]!=null)? o[k]: undefined, pick);
    if (str == null) {
      const en = this.dicts?.en ?? {};
      str = path.split(".").reduce((o,k)=> (o&&o[k]!=null)? o[k]: undefined, en) ?? path;
    }
    if (data && typeof str === "string") {
      for (const [kk,v] of Object.entries(data)) {
        str = str.replaceAll(`{${kk}}`, String(v));
      }
    }
    return str;
  }
}();

Hooks.once("init", async () => {
  game.settings.register(MODULE_ID, "language", {
    name: "Language",
    hint: "Select module UI language (no auto-detect).",
    scope: "world",
    config: true,
    type: String,
    choices: {
      
      "en": "English",
      "pl": "Polski"
    },
    default: "en",
    onChange: () => window.location.reload()
  });
  
await Lang.init();

  Handlebars.registerHelper("grr_localize", (key) => Lang.t(key));
});
