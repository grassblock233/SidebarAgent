// Minimal GFM-style table parser used by the DOM renderer. It returns structured
// cells instead of HTML so model output is never inserted through innerHTML.
function hasTablePipe(line) {
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") escaped = true;
    else if (character === "|") return true;
  }
  return false;
}

export function splitMarkdownTableRow(line) {
  let value = typeof line === "string" ? line.trim() : "";
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);

  const cells = [];
  let cell = "";
  let escaped = false;
  let inCode = false;
  // Pipes inside inline code or escaped pipes do not delimit table cells.
  for (const character of value) {
    if (escaped) {
      cell += character === "|" ? "|" : `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "`") inCode = !inCode;
    if (character === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
}

function delimiterAlignment(cell) {
  const value = cell.trim();
  if (!/^:?-{3,}:?$/.test(value)) return null;
  if (value.startsWith(":") && value.endsWith(":")) return "center";
  if (value.endsWith(":")) return "right";
  return "left";
}

export function parseMarkdownTable(lines, startIndex) {
  // A valid delimiter row is required to avoid interpreting ordinary prose as a table.
  const headerLine = lines[startIndex];
  const delimiterLine = lines[startIndex + 1];
  if (typeof headerLine !== "string" || typeof delimiterLine !== "string") return null;
  if (!hasTablePipe(headerLine) || !hasTablePipe(delimiterLine)) return null;

  const headers = splitMarkdownTableRow(headerLine);
  const delimiters = splitMarkdownTableRow(delimiterLine);
  if (!headers.length || headers.length !== delimiters.length) return null;
  const alignments = delimiters.map(delimiterAlignment);
  if (alignments.some((alignment) => alignment === null)) return null;

  const rows = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    if (!line.trim() || !hasTablePipe(line) || /^```|^#{1,3}\s|^[-*]\s|^\d+\.\s|^>\s?/.test(line)) break;
    // Normalize ragged rows to the header width for a stable DOM table shape.
    const cells = splitMarkdownTableRow(line).slice(0, headers.length);
    while (cells.length < headers.length) cells.push("");
    rows.push(cells);
    nextIndex += 1;
  }

  return { headers, alignments, rows, nextIndex };
}
