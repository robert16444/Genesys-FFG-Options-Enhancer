import { isElementLike, ownerDocumentOf, unwrapElement } from "./popout-compat.js";

const GFOE_TALENT_NODESC_REGEX = /\$\{\s*Lang\.t\(\s*['\"]talent\.ui\.noDescription['\"]\s*\)\s*\}/;

function replaceNoDescPlaceholders(root) {
  const element = isElementLike(root) ? root : unwrapElement(root);
  if (!element) return;
  const localized = (game?.i18n?.localize?.('talent.ui.noDescription')) || 'No description.';
  const doc = ownerDocumentOf(element);
  const NodeFilterCtor = doc?.defaultView?.NodeFilter ?? globalThis.NodeFilter;
  if (!doc?.createTreeWalker || !NodeFilterCtor) return;

  const treeWalker = doc.createTreeWalker(element, NodeFilterCtor.SHOW_TEXT, null);
  let node;
  const toChange = [];
  while ((node = treeWalker.nextNode())) {
    if (GFOE_TALENT_NODESC_REGEX.test(node.nodeValue || '')) toChange.push(node);
  }
  toChange.forEach(n => { n.nodeValue = localized; });

  element.querySelectorAll('.talent-description, .gfoe-talent-desc, .item-desc, [data-talent-desc]').forEach(el => {
    const txt = (el.textContent || '').trim();
    if (!txt || GFOE_TALENT_NODESC_REGEX.test(txt)) el.textContent = localized;
  });
}

function handleRender(app, html) {
  try { replaceNoDescPlaceholders(unwrapElement(html) ?? unwrapElement(app)); } catch (_) { /* ignore */ }
}

Hooks.on('renderApplication', handleRender);
Hooks.on('renderApplicationV2', handleRender);
Hooks.on('renderActorSheet', handleRender);
Hooks.on('renderActorSheetV2', handleRender);

Hooks.on('Popout:loaded', (_app, node) => {
  try { replaceNoDescPlaceholders(node); } catch (_) { /* ignore */ }
});
