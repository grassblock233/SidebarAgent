// Injected on demand into the active tab. The IIFE return value is sent back by
// chrome.scripting.executeScript, so this file must remain self-contained.
(() => {
  interface RectLike { left: number; top: number; right: number; bottom: number }
  interface VisiblePart { node: Text; text: string }
  interface SerializedNode { html: string; truncated: boolean }
  const MAX_OUTPUT_CHARS = 12_000;
  const MAX_HTML_CHARS = 24_000;
  const MAX_INSPECTED_SEGMENTS = 50_000;
  const ignoredTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const allowedTags = new Set([
    "A", "ARTICLE", "B", "BLOCKQUOTE", "CAPTION", "CODE", "DD", "DL", "DT", "EM",
    "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6",
    "HEADER", "I", "LI", "MAIN", "OL", "P", "PRE", "SECTION", "STRONG", "TABLE",
    "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL"
  ]);
  const contentTags = new Set([
    "BLOCKQUOTE", "CAPTION", "DD", "DT", "FIGCAPTION", "H1", "H2", "H3",
    "H4", "H5", "H6", "LI", "P", "PRE", "TD", "TH"
  ]);
  const plainBlockTags = new Set([
    "ARTICLE", "BLOCKQUOTE", "CAPTION", "DD", "DL", "DT", "FIGCAPTION", "FIGURE",
    "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "LI", "MAIN",
    "OL", "P", "PRE", "SECTION", "TABLE", "TR", "UL"
  ]);
  const inlineDisplays = new Set(["inline", "contents", "inline-block", "inline-flex", "inline-grid"]);
  const segmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;
  const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const parts: VisiblePart[] = [];
  let inspectedSegments = 0;

  function intersects(first: RectLike, second: RectLike): boolean {
    return first.right > second.left && first.left < second.right &&
      first.bottom > second.top && first.top < second.bottom;
  }

  function visibleBounds(element: Element): RectLike | null {
    // Intersect every clipping ancestor with the viewport. Geometry outside an
    // overflow container is not visible even when the text node itself exists.
    const bounds = { ...viewport };
    for (let current: HTMLElement | null = element instanceof HTMLElement ? element : element.parentElement; current && current !== document.documentElement; current = current.parentElement) {
      if (ignoredTags.has(current.tagName) || current.hidden || current.getAttribute("aria-hidden") === "true") return null;
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || style.contentVisibility === "hidden") return null;
      const clipsX = ["auto", "scroll", "hidden", "clip"].includes(style.overflowX);
      const clipsY = ["auto", "scroll", "hidden", "clip"].includes(style.overflowY);
      if (clipsX || clipsY) {
        const rect = current.getBoundingClientRect();
        if (clipsX) {
          bounds.left = Math.max(bounds.left, rect.left);
          bounds.right = Math.min(bounds.right, rect.right);
        }
        if (clipsY) {
          bounds.top = Math.max(bounds.top, rect.top);
          bounds.bottom = Math.min(bounds.bottom, rect.bottom);
        }
        if (bounds.left >= bounds.right || bounds.top >= bounds.bottom) return null;
      }
    }
    return bounds;
  }

  function textSegments(text: string): Array<{ segment: string; index: number }> {
    // Segmenting prevents a partially visible long text node from being treated
    // as wholly visible. The regex fallback preserves CJK character boundaries.
    if (segmenter) return [...segmenter.segment(text)].map(({ segment, index }) => ({ segment, index }));
    const segments: Array<{ segment: string; index: number }> = [];
    const pattern = /\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
    for (const match of text.matchAll(pattern)) segments.push({ segment: match[0], index: match.index });
    return segments;
  }

  function visibleTextFromNode(node: Text): string {
    const element = node.parentElement;
    if (!element || !node.data.trim()) return "";
    const bounds = visibleBounds(element);
    if (!bounds) return "";
    const elementRect = element.getBoundingClientRect();
    if (elementRect.width > 0 && elementRect.height > 0 && !intersects(elementRect, bounds)) return "";

    const visible: string[] = [];
    // Range rectangles provide rendered positions for individual word segments.
    for (const { segment, index } of textSegments(node.data)) {
      inspectedSegments += 1;
      if (inspectedSegments > MAX_INSPECTED_SEGMENTS) break;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + segment.length);
      const onScreen = [...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0 && intersects(rect, bounds));
      range.detach();
      if (onScreen) visible.push(segment);
      else if (visible.length && !/\s$/.test(visible[visible.length - 1] ?? "")) visible.push(" ");
    }
    return visible.join("").replace(/[ \t]+/g, " ").trim();
  }

  function normalizedTagName(element: Element): string {
    if (element.tagName === "B") return "strong";
    if (element.tagName === "I") return "em";
    return element.tagName.toLowerCase();
  }

  function copySafeAttributes(source: Element, target: HTMLElement): void {
    if (source.tagName === "A") {
      try {
        const href = new URL(source.getAttribute("href") || "", location.href);
        if (["http:", "https:"].includes(href.protocol)) target.setAttribute("href", href.href);
      } catch {
        // Invalid and non-web links are intentionally omitted from AI context.
      }
    }

    if (["TD", "TH"].includes(source.tagName)) {
      for (const attribute of ["colspan", "rowspan"]) {
        const value = Number.parseInt(source.getAttribute(attribute) || "", 10);
        if (Number.isInteger(value) && value > 1 && value <= 100) target.setAttribute(attribute, String(value));
      }
    }

    if (source.tagName === "OL") {
      const start = Number.parseInt(source.getAttribute("start") || "", 10);
      if (Number.isInteger(start) && start !== 1) target.setAttribute("start", String(start));
    }
  }

  function nearestFallbackBlock(ancestors: Element[]): Element | null {
    if (ancestors.some((element) => contentTags.has(element.tagName))) return null;
    return [...ancestors].reverse().find((element) => {
      if (allowedTags.has(element.tagName) || ignoredTags.has(element.tagName)) return false;
      return !inlineDisplays.has(getComputedStyle(element).display);
    }) || null;
  }

  function appendVisibleText(parent: HTMLElement, text: string): void {
    const previousText = parent.textContent || "";
    const needsSpace = previousText && !/\s$/.test(previousText) && !/^\s/.test(text) &&
      !/^[,.;:!?，。！？；：、）】》]/.test(text) && !/[（【《]$/.test(previousText);
    if (needsSpace) parent.append(document.createTextNode(" "));
    parent.append(document.createTextNode(text));
  }

  function buildSanitizedTree(visibleParts: VisiblePart[]): HTMLDivElement {
    const root = document.createElement("div");
    const clones = new Map<Element, HTMLElement>();

    for (const part of visibleParts) {
      const ancestors: Element[] = [];
      for (let element = part.node.parentElement; element && element !== document.documentElement; element = element.parentElement) {
        ancestors.unshift(element);
      }
      const fallbackBlock = nearestFallbackBlock(ancestors);
      let parent: HTMLElement = root;

      for (const original of ancestors) {
        const tagName = allowedTags.has(original.tagName)
          ? normalizedTagName(original)
          : original === fallbackBlock ? "p" : "";
        if (!tagName) continue;

        let clone = clones.get(original);
        if (!clone) {
          clone = document.createElement(tagName);
          copySafeAttributes(original, clone);
          clones.set(original, clone);
          parent.append(clone);
        }
        parent = clone;
      }
      appendVisibleText(parent, part.text);
    }
    return root;
  }

  function plainTextFromTree(root: HTMLElement): string {
    let output = "";

    const appendLineBreak = (): void => {
      output = output.replace(/[ \t]+$/g, "");
      if (output && !output.endsWith("\n")) output += "\n";
    };
    const appendText = (text: string): void => {
      const needsSpace = output && !/[\s\t]$/.test(output) && !/^\s/.test(text) &&
        !/^[,.;:!?，。！？；：、）】》]/.test(text) && !/[（【《]$/.test(output);
      if (needsSpace) output += " ";
      output += text;
    };

    const visit = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        appendText((node as Text).data);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const element = node as Element;
      const tagName = element.tagName;
      if (plainBlockTags.has(tagName)) appendLineBreak();
      for (const child of element.childNodes) visit(child);
      if (["TD", "TH"].includes(tagName)) {
        output = output.replace(/[ \t]+$/g, "");
        output += "\t";
      } else if (plainBlockTags.has(tagName)) {
        appendLineBreak();
      }
    };

    for (const child of root.childNodes) visit(child);
    return output
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function escapeHtmlText(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function escapeHtmlAttribute(value: string): string {
    return escapeHtmlText(value).replaceAll('"', "&quot;");
  }

  function serializeTextWithinBudget(value: string, budget: number): SerializedNode {
    let html = "";
    let consumed = 0;
    for (const character of value) {
      const encoded = escapeHtmlText(character);
      if (html.length + encoded.length > budget) break;
      html += encoded;
      consumed += character.length;
    }
    return { html, truncated: consumed < value.length };
  }

  function serializeNodeWithinBudget(node: Node, budget: number): SerializedNode {
    if (node.nodeType === Node.TEXT_NODE) return serializeTextWithinBudget((node as Text).data, budget);
    if (node.nodeType !== Node.ELEMENT_NODE) return { html: "", truncated: false };

    const element = node as Element;
    const attributes = [...element.attributes]
      .map(({ name, value }) => ` ${name}="${escapeHtmlAttribute(value)}"`)
      .join("");
    const openingTag = `<${element.localName}${attributes}>`;
    const closingTag = `</${element.localName}>`;
    if (openingTag.length + closingTag.length > budget) return { html: "", truncated: true };

    let html = openingTag;
    let truncated = false;
    const children = [...element.childNodes];
    for (let index = 0; index < children.length; index += 1) {
      const remaining = budget - html.length - closingTag.length;
      const result = serializeNodeWithinBudget(children[index], remaining);
      html += result.html;
      if (result.truncated || (!result.html && remaining <= 0)) {
        truncated = true;
        break;
      }
      if (index === children.length - 1) continue;
      if (budget - html.length - closingTag.length <= 0) {
        truncated = true;
        break;
      }
    }
    return { html: `${html}${closingTag}`, truncated };
  }

  function serializeTreeWithinBudget(root: HTMLElement, budget: number): SerializedNode {
    let html = "";
    let truncated = false;
    const children = [...root.childNodes];
    for (let index = 0; index < children.length; index += 1) {
      const result = serializeNodeWithinBudget(children[index], budget - html.length);
      html += result.html;
      if (result.truncated || !result.html) {
        truncated = true;
        break;
      }
    }
    return { html: html.trim(), truncated };
  }

  // TreeWalker preserves document order without copying or mutating page nodes.
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && inspectedSegments <= MAX_INSPECTED_SEGMENTS) {
    const text = visibleTextFromNode(walker.currentNode as Text);
    if (!text) continue;
    parts.push({ node: walker.currentNode as Text, text });
  }

  // Only whitelisted ancestors of visible text are cloned. Serialization applies
  // a separate budget while always closing emitted tags to keep the HTML valid.
  const sanitizedTree = buildSanitizedTree(parts);
  const combined = plainTextFromTree(sanitizedTree);
  const structured = serializeTreeWithinBudget(sanitizedTree, MAX_HTML_CHARS);

  const result = {
    id: crypto.randomUUID(),
    text: combined.slice(0, MAX_OUTPUT_CHARS),
    originalLength: combined.length,
    truncated: combined.length > MAX_OUTPUT_CHARS,
    html: structured.html,
    htmlTruncated: structured.truncated,
    contentType: structured.html ? "text/html" : "text/plain",
    title: document.title || "当前网页",
    url: location.href,
    createdAt: Date.now(),
    captureType: "viewport"
  };
  (globalThis as typeof globalThis & { __SIDEBAR_AGENT_CAPTURE__?: typeof result }).__SIDEBAR_AGENT_CAPTURE__ = result;
})();
