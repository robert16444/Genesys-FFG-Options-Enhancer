const GFOE_TALENT_NODESC_REGEX = /\$\{\s*Lang\.t\(\s*['\"]talent\.ui\.noDescription['\"]\s*\)\s*\}/;

function replaceNoDescPlaceholders(root) {
  const localized = (game?.i18n?.localize?.('talent.ui.noDescription')) || 'No description.';

  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node;
  const toChange = [];
  while ((node = treeWalker.nextNode())) {
    if (GFOE_TALENT_NODESC_REGEX.test(node.nodeValue || '')) {
      toChange.append ? toChange.append(node) : toChange.push(node);
    }
  }
  toChange.forEach(n => { n.nodeValue = localized; });

  root.querySelectorAll('.talent-description, .gfoe-talent-desc, .item-desc, [data-talent-desc]').forEach(el => {
    const txt = (el.textContent || '').trim();
    if (!txt) el.textContent = localized;
    else if (GFOE_TALENT_NODESC_REGEX.test(txt)) el.textContent = localized;
  });
}

Hooks.on('renderApplication', (_app, html) => {
  try { replaceNoDescPlaceholders(html[0] || html?.context || document); } catch(e) { /* ignore */ }
});

Hooks.on('renderActorSheet', (_app, html) => {
  try { replaceNoDescPlaceholders(html[0] || html?.context || document); } catch(e) { /* ignore */ }
});
