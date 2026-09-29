const POPOUT_MODULE_ID = "popout";

let initialized = false;
const documentInitializers = new Set();
const initializedDocuments = new WeakSet();

export function isElementLike(value) {
  return Boolean(value && value.nodeType === 1 && typeof value.querySelector === "function");
}

export function unwrapElement(value) {
  if (isElementLike(value)) return value;
  if (isElementLike(value?.[0])) return value[0];
  if (isElementLike(value?.element)) return value.element;
  if (isElementLike(value?._element)) return value._element;
  if (isElementLike(value?.element?.[0])) return value.element[0];
  if (isElementLike(value?._element?.[0])) return value._element[0];
  return null;
}

export function ownerDocumentOf(value, fallback = globalThis.document) {
  const element = unwrapElement(value);
  return element?.ownerDocument ?? value?.ownerDocument ?? fallback ?? null;
}

export function ownerWindowOf(value, fallback = globalThis.window) {
  return ownerDocumentOf(value)?.defaultView ?? fallback ?? null;
}

export function createElementFor(value, tagName) {
  const doc = ownerDocumentOf(value);
  if (!doc?.createElement) throw new Error(`Cannot create <${tagName}> without a DOM document.`);
  return doc.createElement(tagName);
}

export function isPopOutActive() {
  try { return Boolean(game?.modules?.get?.(POPOUT_MODULE_ID)?.active && globalThis.PopoutModule); }
  catch (_) { return false; }
}

function initializeDocument(doc) {
  if (!doc || initializedDocuments.has(doc)) return;
  initializedDocuments.add(doc);
  for (const initializer of documentInitializers) {
    try { initializer(doc); }
    catch (err) { console.warn("genesys-ffg-options-enhancer | PopOut document initializer failed", err); }
  }
}

export function registerPopOutDocumentInitializer(initializer) {
  if (typeof initializer !== "function") return;
  documentInitializers.add(initializer);

  const mainDocument = globalThis.document;
  if (mainDocument) {
    try { initializer(mainDocument); }
    catch (err) { console.warn("genesys-ffg-options-enhancer | PopOut document initializer failed", err); }
  }

  // If PopOut! is already active and has windows open, initialize their documents too.
  try {
    const poppedOut = globalThis.PopoutModule?.poppedOut;
    if (poppedOut?.values) {
      for (const entry of poppedOut.values()) {
        const doc = entry?.window?.document;
        if (doc) {
          try { initializer(doc); }
          catch (err) { console.warn("genesys-ffg-options-enhancer | PopOut document initializer failed", err); }
        }
      }
    }
  } catch (_) {}
}

export function initializePopOutCompatibility() {
  if (initialized) return;
  initialized = true;

  if (globalThis.document) initializeDocument(globalThis.document);

  Hooks.on("Popout:loaded", (_app, node) => {
    initializeDocument(ownerDocumentOf(node, null));
  });

  Hooks.on("renderApplication", (app, html) => initializeDocument(ownerDocumentOf(unwrapElement(html) ?? app, null)));
  Hooks.on("renderApplicationV2", (app, html) => initializeDocument(ownerDocumentOf(unwrapElement(html) ?? app, null)));
}
