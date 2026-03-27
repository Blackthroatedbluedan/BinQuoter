/**
 * Match invoice lines to combined job hours by order # = canonical_job_id.
 * Adds invoice description text for manual bin-spec review.
 *
 * Place your workbook under one of:
 *   BinData/invoices/Invoices_2023_2024.xlsx   (recommended)
 *   BinData/invoices/2024 Invoices.xlsx
 * Or set: INVOICES_XLSX=C:\full\path\to\file.xlsx
 *
 * Reads: output/bin_jobs_clean_2023_2024_combined.csv
 * Writes: same file (backs up to .bak) + output/invoice_match_report.txt
 *
 * Usage: node attach-invoice-descriptions.js
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const OUT_ROOT = path.join(__dirname, "output");
const COMBINED = path.join(OUT_ROOT, "bin_jobs_clean_2023_2024_combined.csv");
const REPORT = path.join(OUT_ROOT, "invoice_match_report.txt");

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((ln) => ln.length > 0);
  return lines.map(parseCsvLine);
}

function escapeCsv(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normHeader(h) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Find order # column index */
function detectOrderCol(headers) {
  const n = headers.length;
  const scored = [];
  for (let i = 0; i < n; i++) {
    const h = normHeader(headers[i]);
    let s = 0;
    if (h === "order no" || h === "order #") s += 14;
    if (h.includes("order no") || h.includes("order #")) s += 12;
    if (h === "order" || h === "order #") s += 10;
    if (h.includes("order") && (h.includes("#") || h.includes("no") || h.includes("num"))) s += 8;
    if (h.includes("job") && (h.includes("#") || h.includes("no") || h.includes("number"))) s += 8;
    if (h === "job" || h === "job number" || h === "job#") s += 6;
    if (h.includes("invoice") && h.includes("job")) s += 5;
    if (h.includes("po") || h.includes("reference")) s += 1;
    scored.push({ i, s, h });
  }
  scored.sort((a, b) => b.s - a.s);
  if (scored[0] && scored[0].s >= 5) return scored[0].i;
  return -1;
}

function detectDescCol(headers) {
  const n = headers.length;
  for (let i = 0; i < n; i++) {
    const h = normHeader(headers[i]);
    if (
      h === "description" ||
      h.includes("description") ||
      h === "desc" ||
      h.includes("item description") ||
      h.includes("line description") ||
      h.includes("memo") ||
      (h.includes("detail") && !h.includes("amount"))
    ) {
      return i;
    }
  }
  /** KLFS export: line text often in Ship To Name */
  for (let i = 0; i < n; i++) {
    const h = normHeader(headers[i]);
    if (h === "ship to name" || h.includes("ship to name")) return i;
  }
  return -1;
}

function cellToString(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number") return String(v);
  return String(v).trim();
}

/** Normalize job key for matching (invoice Order No may be zero-padded). */
function normalizeJobKey(raw) {
  const s = cellToString(raw);
  if (!s) return "";
  const trimmed = s.trim();
  if (/^\d+$/.test(trimmed)) {
    return String(parseInt(trimmed, 10));
  }
  const onlyDigits = s.replace(/\D/g, "");
  if (onlyDigits.length >= 2 && /^\d+$/.test(onlyDigits)) {
    return String(parseInt(onlyDigits, 10));
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Split composite job ids like 6605/6657 */
function expandCanonicalKeys(canonicalId) {
  const s = cellToString(canonicalId);
  if (!s) return [];
  const parts = s.split(/[/|,;]+/).map((x) => x.trim()).filter(Boolean);
  const keys = new Set();
  for (const p of parts) {
    keys.add(normalizeJobKey(p));
    keys.add(p);
  }
  return [...keys].filter(Boolean);
}

function findInvoicesFile() {
  const env = process.env.INVOICES_XLSX;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    path.join(__dirname, "invoices", "Invoices_2023_2024.xlsx"),
    path.join(__dirname, "invoices", "2024 Invoices.xlsx"),
    path.join(__dirname, "invoices", "2023 Invoices.xlsx"),
    path.join(__dirname, "..", "2024 Invoices.xlsx"),
    path.join(__dirname, "..", "Invoices_2023_2024.xlsx"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  const invDir = path.join(__dirname, "invoices");
  if (fs.existsSync(invDir)) {
    const files = fs.readdirSync(invDir).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith("~$"));
    if (files.length === 1) return path.join(invDir, files[0]);
  }
  return null;
}

function readAllInvoiceRows(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath, { cellDates: true, raw: false });
  const orderToDescs = new Map(); // jobKey -> Set of description strings

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (!data.length) continue;
    let headerRow = 0;
    let headers = data[0].map((c) => cellToString(c));
    let oi = detectOrderCol(headers);
    let di = detectDescCol(headers);

    if (oi < 0 || di < 0) {
      if (data.length > 1) {
        headers = data[1].map((c) => cellToString(c));
        oi = detectOrderCol(headers);
        di = detectDescCol(headers);
        if (oi >= 0 && di >= 0) headerRow = 1;
      }
    }

    if (oi < 0 || di < 0) {
      console.warn(`Sheet "${sheetName}": could not detect Order + Description columns; skipped.`);
      continue;
    }

    for (let r = headerRow + 1; r < data.length; r++) {
      const row = data[r];
      if (!row || !row.length) continue;
      const orderRaw = row[oi];
      const desc = cellToString(row[di]);
      if (!desc && !orderRaw) continue;

      const keys = new Set();
      const nk = normalizeJobKey(orderRaw);
      if (nk) keys.add(nk);
      const str = cellToString(orderRaw);
      if (str && str !== nk) keys.add(str.trim());

      for (const k of keys) {
        if (!k) continue;
        if (!orderToDescs.has(k)) orderToDescs.set(k, new Set());
        if (desc) orderToDescs.get(k).add(desc);
      }
    }
  }

  return orderToDescs;
}

function main() {
  const xlsxPath = findInvoicesFile();
  if (!xlsxPath) {
    console.error(`
No invoice workbook found.

Place your file as:
  ${path.join(__dirname, "invoices", "Invoices_2023_2024.xlsx")}

Or set environment variable:
  INVOICES_XLSX=C:\\\\path\\\\to\\\\your.xlsx

Then run: node attach-invoice-descriptions.js
`);
    process.exit(1);
  }

  if (!fs.existsSync(COMBINED)) {
    console.error(`Missing ${COMBINED} — run npm run merge-jobs-trust first.`);
    process.exit(1);
  }

  console.log(`Reading invoices: ${xlsxPath}`);
  const orderToDescs = readAllInvoiceRows(xlsxPath);

  let table = parseCsv(fs.readFileSync(COMBINED, "utf8"));
  let headers = table[0].map((h) => h.trim());

  const stripNames = new Set([
    "invoice_description",
    "invoice_description_count",
    "invoice_match",
  ]);
  const keepIdx = headers.map((h) => !stripNames.has(h));
  headers = headers.filter((_, i) => keepIdx[i]);
  table = table.map((row) => row.filter((_, i) => keepIdx[i]));

  const idx = {
    job: headers.indexOf("canonical_job_id"),
  };
  if (idx.job < 0) {
    console.error("combined CSV missing canonical_job_id");
    process.exit(1);
  }

  const colIndex = {};
  headers.forEach((h, i) => {
    if (colIndex[h] === undefined) colIndex[h] = i;
  });

  const newCols = [
    "invoice_description",
    "invoice_description_count",
    "invoice_match",
  ];
  const outHeaders = headers.concat(newCols);

  const lines = [outHeaders.join(",")];
  let matchedRows = 0;
  const usedInvoiceKeys = new Set();

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const jobId = row[idx.job] ?? "";
    const keys = expandCanonicalKeys(jobId);
    const descSets = [];
    let match = "no";
    for (const k of keys) {
      if (orderToDescs.has(k)) {
        descSets.push(orderToDescs.get(k));
        usedInvoiceKeys.add(k);
        match = "yes";
      }
    }
    let merged = [];
    if (descSets.length) {
      const all = new Set();
      for (const s of descSets) {
        for (const d of s) all.add(d);
      }
      merged = [...all];
      matchedRows++;
    }
    const descText = merged.join(" | ");

    const line = outHeaders.map((h) => {
      if (h === "invoice_description") return escapeCsv(descText);
      if (h === "invoice_description_count") return merged.length;
      if (h === "invoice_match") return match;
      return escapeCsv(row[colIndex[h]] ?? "");
    });
    lines.push(line.join(","));
  }

  fs.copyFileSync(COMBINED, COMBINED + ".bak");
  fs.writeFileSync(COMBINED, lines.join("\n"), "utf8");

  const allKeys = [...orderToDescs.keys()];
  const unused = allKeys.filter((k) => !usedInvoiceKeys.has(k));

  const report = [
    `Invoice file: ${xlsxPath}`,
    `Invoice distinct order keys (normalized): ${allKeys.length}`,
    `Combined rows with invoice_match=yes: ${matchedRows}`,
    `Invoice keys not matched to any combined job row: ${unused.length}`,
    unused.length ? `Sample unmatched keys: ${unused.slice(0, 30).join(", ")}` : "",
    "",
  ].join("\n");

  fs.writeFileSync(REPORT, report, "utf8");
  console.log(report);
  console.log(`Backup: ${COMBINED}.bak`);
  console.log(`Updated: ${COMBINED}`);
  console.log(`Report: ${REPORT}`);
}

main();
