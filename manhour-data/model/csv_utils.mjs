import fs from "fs";

/** Parse one CSV line (handles quoted fields, RFC-style). */
export function parseCsvLine(line) {
  const result = [];
  let cur = "";
  let i = 0;
  let inQuote = false;
  while (i < line.length) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else {
          inQuote = false;
          i++;
        }
      } else {
        cur += c;
        i++;
      }
    } else {
      if (c === '"') {
        inQuote = true;
        i++;
      } else if (c === ",") {
        result.push(cur);
        cur = "";
        i++;
      } else {
        cur += c;
        i++;
      }
    }
  }
  result.push(cur);
  return result;
}

export function parseCsv(text) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((ln) => ln.length > 0);
  return lines.map(parseCsvLine);
}

export function readCsv(path) {
  const text = fs.readFileSync(path, "utf8");
  const rows = parseCsv(text);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = rows[r][c] !== undefined ? String(rows[r][c]).trim() : "";
    }
    records.push(obj);
  }
  return { headers, records };
}

export function writeCsv(path, headers, records) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const rec of records) {
    lines.push(headers.map((h) => esc(rec[h])).join(","));
  }
  fs.writeFileSync(path, lines.join("\n"), "utf8");
}
