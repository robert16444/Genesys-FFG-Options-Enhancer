
export function GFOE_buildCastOptions(description) {
  try {
    const api = game.modules.get("genesys-ffg-options-enhancer")?.api;
    if (!api) return [];
    const txt = description ?? "";
    const costs = api.parseActivationCosts(txt) || [];
    if (!costs.length) return [];
    const isPL = String(game?.i18n?.lang || navigator?.language || "en").toLowerCase().startsWith("pl");
    const label = (i, n) => `${n} ${Lang.t("talent.mana")} (${Lang.t("talent.variant")} ${i})`;
    return costs.map((n, idx) => ({ label: label(idx+1, Number(n)), cost: Number(n) }));
  } catch(e) {
    console.error("GFOE_buildCastOptions failed:", e);
    return [];
  }
}

export function GFOE_firstActivationCost(description) {
  try {
    const api = game.modules.get("genesys-ffg-options-enhancer")?.api;
    const costs = api?.parseActivationCosts(description || "") || [];
    return (costs.length ? Number(costs[0]) : NaN);
  } catch(e) { return NaN; }
}
