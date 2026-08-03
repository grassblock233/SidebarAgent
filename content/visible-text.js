// Injected on demand into the active tab. The IIFE return value is sent back by
// chrome.scripting.executeScript, so this file must remain self-contained.
(() => {
  const MAX_OUTPUT_CHARS = 12_000;
  const MAX_INSPECTED_SEGMENTS = 50_000;
  const ignoredTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const segmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;
  const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const parts = [];
  let inspectedSegments = 0;

  function intersects(first, second) {
    return first.right > second.left && first.left < second.right &&
      first.bottom > second.top && first.top < second.bottom;
  }

  function visibleBounds(element) {
    // Intersect every clipping ancestor with the viewport. Geometry outside an
    // overflow container is not visible even when the text node itself exists.
    const bounds = { ...viewport };
    for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
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

  function textSegments(text) {
    // Segmenting prevents a partially visible long text node from being treated
    // as wholly visible. The regex fallback preserves CJK character boundaries.
    if (segmenter) return [...segmenter.segment(text)].map(({ segment, index }) => ({ segment, index }));
    const segments = [];
    const pattern = /\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
    for (const match of text.matchAll(pattern)) segments.push({ segment: match[0], index: match.index });
    return segments;
  }

  function visibleTextFromNode(node) {
    const element = node.parentElement;
    if (!element || !node.data.trim()) return "";
    const bounds = visibleBounds(element);
    if (!bounds) return "";
    const elementRect = element.getBoundingClientRect();
    if (elementRect.width > 0 && elementRect.height > 0 && !intersects(elementRect, bounds)) return "";

    const visible = [];
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
      else if (visible.length && !/\s$/.test(visible.at(-1))) visible.push(" ");
    }
    return visible.join("").replace(/[ \t]+/g, " ").trim();
  }

  // TreeWalker preserves document order without copying or mutating page nodes.
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && inspectedSegments <= MAX_INSPECTED_SEGMENTS) {
    const text = visibleTextFromNode(walker.currentNode);
    if (!text) continue;
    const display = getComputedStyle(walker.currentNode.parentElement).display;
    const block = !["inline", "contents", "inline-block", "inline-flex", "inline-grid"].includes(display);
    parts.push({ text, block });
  }

  // Preserve block boundaries while keeping inline fragments readable as prose.
  let combined = "";
  for (const part of parts) {
    if (combined) combined += part.block ? "\n" : " ";
    combined += part.text;
  }
  combined = combined
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    id: crypto.randomUUID(),
    text: combined.slice(0, MAX_OUTPUT_CHARS),
    originalLength: combined.length,
    truncated: combined.length > MAX_OUTPUT_CHARS,
    title: document.title || "当前网页",
    url: location.href,
    createdAt: Date.now(),
    captureType: "viewport"
  };
})();
