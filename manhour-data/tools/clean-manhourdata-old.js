/**
 * Clean accounting export (ManhourdataOld.xlsx): labour hours only, bare columns,
 * filter noise, parse bin size from Ship To Name (e.g. 4512 → 45ft × 12 rings).
 *
 * Usage:
 *   node tools/clean-manhourdata-old.js [path/to/ManhourdataOld.xlsx] [output_dir]
 *
 * Output (default under folder containing the xlsx: artifacts/):
 *   manhourdataold_cleaned.csv
 *   manhourdataold_parse_summary.txt
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { parseBinSize, parseFromFourDigitNumber } = require("../lib/parseBinSizeFromInvoice.js");

function defaultPaths() {
  const candidatesIn = [
    path.join(__dirname, "..", "..", "ManhourdataOld.xlsx"),
    path.join(__dirname, "..", "..", "..", "ManhourdataOld.xlsx"),
    path.join(__dirname, "..", "..", "..", "..", "ManhourdataOld.xlsx"),
  ];
  let inPath = candidatesIn.find((p) => fs.existsSync(p)) || candidatesIn[0];
  const base = path.dirname(inPath);
  const outDir = path.join(base, "artifacts");
  return { inPath, outDir };
}

const MIN_HOURS = 10;

/** Invoice lines dropped from cleaned export (e.g. multi-bin x2 list with no clean per-bin split). */
const EXCLUDED_INVOICE_NOS = new Set(["0000002722"]);

/** Corrected total labour hours (before xN splits) when Ship Qty in export is wrong. */
/** Ship qty is often per-bin; values are (hours per bin × bin count) before xN split. */
const INVOICE_TOTAL_HOURS_OVERRIDE = new Map([
  ["0000001475", 1096], // 4×3617 Charles Rivett: 274 × 4
  ["0000001321", 330], // 3310NC x 2 Yorkshire: 165 × 2
  ["0000002249", 588], // 4214NC x 3 @ DS&B: 196 × 3
]);

/**
 * Bin build labour only — not hardware, freight, hotel, boom truck, generic "Labour", etc.
 * - Standard product: "Labour 1 Man per Hour" (suffixes allowed except pour-pad lines, which are dropped)
 * - Tracking splits: "Labour for #### … per Man Hour(for Tracking Only)"
 */
function isBinLabourDescription(desc) {
  const s = String(desc ?? "").trim();
  if (!s) return false;
  if (/^Labour 1 Man per Hour/i.test(s)) return true;
  if (/^Labour for\s+.+\s*per Man Hour/i.test(s)) return true;
  return false;
}

/** Pads, concrete, tear/rebuild — not bin steel labour for modeling */
function isExcludedPadConcreteTear(shipTo, description) {
  const combined = `${String(shipTo ?? "")}\n${String(description ?? "")}`;
  const t = combined.toLowerCase();
  if (/\bpour(?:ing)?\s+pads?\b/.test(t)) return true;
  if (/\bpour\s+pad\b/.test(t)) return true;
  if (/\bconcrete\b/.test(t)) return true;
  if (/\bto\s+pour\s+pad\b/.test(t)) return true;
  if (/\btear\s+down\b/.test(t)) return true;
  if (/\brebuild\b/.test(t)) return true;
  return false;
}

/**
 * Leading "N X ####" (1–2 digit N): "4 X 3617- Charles Rivett" → N bins of that size; hours ÷ N.
 * N must be 1–2 digits so "2112 x 2" does not match as (21)(12 x 2).
 */
function expandLeadingCountBin(row) {
  const st = String(row.ship_to ?? "");
  const m = st.match(/^\s*(\d{1,2})\s*[xX]\s*(\d{4})\b/);
  if (!m) return [row];
  const n = parseInt(m[1], 10);
  const code = parseInt(m[2], 10);
  if (n < 2 || n > 50) return [row];
  const p = parseFromFourDigitNumber(code);
  const hEach = Math.round((row.hours / n) * 100) / 100;
  const out = [];
  for (let k = 0; k < n; k++) {
    out.push({
      ...row,
      hours: hEach,
      ship_to: `${row.ship_to} — ${k + 1} of ${n}`,
      diameter_ft: p ? p.diameter : row.diameter_ft,
      rings: p ? p.rings : row.rings,
      bin_parse_source: p ? `xn_leading:${code}:${n}` : row.bin_parse_source,
      split_index: `${k + 1}/${n}`,
      split_bin_code: String(code),
    });
  }
  return out;
}

/**
 * "#### x N" / "####NC x N" in ship_to (incl. comma lists). Sum of all N = physical bins; hours ÷ sum.
 * N=2 keeps "1st/2nd of 2" labels when a single code; N≥3 uses "k of N".
 */
function expandMultiplierRows(row) {
  const st = String(row.ship_to ?? "");
  const re = /\b(\d{4})\s*(?:NC\s*)?x\s*(\d+)\b/gi;
  const matches = [...st.matchAll(re)];
  if (matches.length === 0) return [row];

  let totalBins = 0;
  for (const m of matches) {
    const n = parseInt(m[2], 10);
    if (Number.isFinite(n) && n >= 1) totalBins += n;
  }
  if (totalBins < 2) return [row];

  const hEach = Math.round((row.hours / totalBins) * 100) / 100;
  const multiCodes = matches.length > 1;
  const out = [];
  for (const m of matches) {
    const code = parseInt(m[1], 10);
    const n = parseInt(m[2], 10);
    if (!Number.isFinite(n) || n < 1) continue;
    const p = parseFromFourDigitNumber(code);
    for (let k = 0; k < n; k++) {
      let shipSuffix;
      if (n === 2) {
        const rank = k === 0 ? "1st" : "2nd";
        shipSuffix = multiCodes ? `${code} ${rank} of 2` : `${rank} of 2`;
      } else {
        shipSuffix = multiCodes ? `${code} ${k + 1} of ${n}` : `${k + 1} of ${n}`;
      }
      out.push({
        ...row,
        hours: hEach,
        ship_to: `${row.ship_to} — ${shipSuffix}`,
        diameter_ft: p ? p.diameter : row.diameter_ft,
        rings: p ? p.rings : row.rings,
        bin_parse_source: p ? `xn_split:${code}:${n}` : row.bin_parse_source,
        split_index: `${k + 1}/${n}`,
        split_bin_code: String(code),
      });
    }
  }
  return out;
}

/**
 * Two same-size bins on one invoice line (e.g. "4212 Bins- Hunco Farms"): hours ÷ 2.
 */
function expandHuncoTwoBins(row) {
  if (String(row.invoice_no ?? "").trim() !== "0000004394") return [row];
  const n = 2;
  const hEach = Math.round((row.hours / n) * 100) / 100;
  const code = 4212;
  const p = parseFromFourDigitNumber(code);
  const out = [];
  for (let k = 0; k < n; k++) {
    out.push({
      ...row,
      hours: hEach,
      ship_to: `${row.ship_to} — ${k + 1} of ${n}`,
      diameter_ft: p ? p.diameter : row.diameter_ft,
      rings: p ? p.rings : row.rings,
      bin_parse_source: p ? `xn_split:${code}:${n}` : row.bin_parse_source,
      split_index: `${k + 1}/${n}`,
      split_bin_code: String(code),
    });
  }
  return out;
}

function escapeCsv(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
    return v.trim().slice(0, 10);
  }
  return String(v ?? "").trim();
}

/**
 * Brock vs Westeel from ship-to / description text.
 * NC = narrow core (Brock); WC = wide core (Westeel).
 */
function inferBinManufacturer(shipTo, description, binParseSource) {
  const combined = `${String(shipTo ?? "")}\n${String(description ?? "")}`;
  const s = combined;
  const src = String(binParseSource ?? "");

  if (/westeel/i.test(s)) return "Westeel";
  if (/brock/i.test(s)) return "Brock";
  if (/\bWC\b/i.test(s)) return "Westeel";
  if (/\d{4}\s*NC\b/i.test(s)) return "Brock";
  if (/\bNC\b/i.test(s)) return "Brock";
  if (/narrow\s*core/i.test(s)) return "Brock";
  if (/wide\s*core/i.test(s)) return "Westeel";

  if (src.startsWith("text_brock") || src === "text_4digit_before_nc" || /^text_commercial/.test(src))
    return "Brock";

  return "";
}

/**
 * Greydafton: same invoice split labour across two product lines for one bin — merge into one row.
 */
function mergeGreydaftonSameInvoiceBin(rows) {
  const groups = new Map();
  const rest = [];

  function greyKey(r) {
    if (!/greydafton/i.test(String(r.ship_to))) return null;
    return [
      r.invoice_no,
      String(r.ship_to).trim(),
      String(r.diameter_ft),
      String(r.rings),
    ].join("|");
  }

  for (const r of rows) {
    const k = greyKey(r);
    if (!k) {
      rest.push(r);
      continue;
    }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const merged = [];
  for (const arr of groups.values()) {
    if (arr.length === 1) {
      merged.push(arr[0]);
      continue;
    }
    const hours = Math.round(arr.reduce((s, x) => s + Number(x.hours), 0) * 100) / 100;
    const dates = arr.map((x) => x.date).sort();
    const desc = arr.map((x) => x.description).join(" | ");
    const base = { ...arr[0] };
    base.hours = hours;
    base.date = dates[0];
    base.description = desc;
    base.bin_manufacturer = inferBinManufacturer(base.ship_to, base.description, base.bin_parse_source);
    merged.push(base);
  }

  return [...rest, ...merged].sort(
    (a, b) =>
      String(a.date).localeCompare(String(b.date)) || String(a.ship_to).localeCompare(String(b.ship_to))
  );
}

function main() {
  const defaults = defaultPaths();
  const inPath = path.resolve(process.argv[2] || defaults.inPath);
  const outDir = process.argv[3] ? path.resolve(process.argv[3]) : defaults.outDir;
  if (!fs.existsSync(inPath)) {
    console.error("Missing", inPath);
    process.exit(1);
  }

  const wb = XLSX.readFile(inPath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
  if (data.length < 2) {
    console.error("No data rows");
    process.exit(1);
  }

  const h = data[0].map((x) => String(x).trim());
  const hi = (name) => h.indexOf(name);
  const iShip = hi("Ship To Name");
  const iQty = hi("Ship Qty");
  const iUM = hi("U/M");
  const iDate = hi("Invoice Date");
  const iInv = hi("Invoice No");
  const iDesc = hi("Description");

  if (iShip < 0 || iQty < 0 || iUM < 0 || iDate < 0 || iDesc < 0) {
    console.error("Expected columns: Description, Ship To Name, Ship Qty, U/M, Invoice Date");
    process.exit(1);
  }

  let outRows = [];

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const descRaw = String(row[iDesc] ?? "").trim();
    if (!isBinLabourDescription(descRaw)) continue;

    const um = String(row[iUM] ?? "").trim().toUpperCase();
    if (um !== "HR") continue;

    const shipTo = String(row[iShip] ?? "").trim();
    if (isExcludedPadConcreteTear(shipTo, descRaw)) continue;

    const dateStr = formatDate(row[iDate]);
    const invNo = iInv >= 0 ? String(row[iInv] ?? "").trim() : "";
    if (EXCLUDED_INVOICE_NOS.has(invNo)) continue;

    let qty = parseFloat(row[iQty]);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (INVOICE_TOTAL_HOURS_OVERRIDE.has(invNo)) {
      qty = INVOICE_TOTAL_HOURS_OVERRIDE.get(invNo);
    }
    if (qty <= MIN_HOURS) continue;

    const bin = parseBinSize("", shipTo);

    const base = {
      date: dateStr,
      hours: qty,
      ship_to: shipTo,
      description: descRaw,
      diameter_ft: bin ? bin.diameter : "",
      rings: bin ? bin.rings : "",
      bin_parse_source: bin ? bin.source : "",
      invoice_no: invNo,
      split_index: "",
      split_bin_code: "",
    };

    for (const expanded of expandLeadingCountBin(base)) {
      for (const expanded2 of expandMultiplierRows(expanded)) {
        for (const expanded3 of expandHuncoTwoBins(expanded2)) {
          if (expanded3.hours <= MIN_HOURS) continue;
          expanded3.bin_manufacturer = inferBinManufacturer(
            expanded3.ship_to,
            expanded3.description,
            expanded3.bin_parse_source
          );
          outRows.push(expanded3);
        }
      }
    }
  }

  const beforeMerge = outRows.length;
  outRows = mergeGreydaftonSameInvoiceBin(outRows);

  const bySource = new Map();
  let parsed = 0;
  let unparsed = 0;
  for (const o of outRows) {
    const d = parseFloat(String(o.diameter_ft));
    if (Number.isFinite(d) && d > 0) {
      parsed++;
      const src = String(o.bin_parse_source || "unknown");
      bySource.set(src, (bySource.get(src) || 0) + 1);
    } else {
      unparsed++;
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, "manhourdataold_cleaned.csv");
  const header = [
    "date",
    "hours",
    "ship_to",
    "description",
    "diameter_ft",
    "rings",
    "bin_manufacturer",
    "bin_parse_source",
    "invoice_no",
    "split_index",
    "split_bin_code",
  ];
  const lines = [header.join(",")];
  for (const o of outRows) {
    lines.push(
      [
        escapeCsv(o.date),
        o.hours,
        escapeCsv(o.ship_to),
        escapeCsv(o.description),
        o.diameter_ft,
        o.rings,
        escapeCsv(o.bin_manufacturer),
        escapeCsv(o.bin_parse_source),
        escapeCsv(o.invoice_no),
        escapeCsv(o.split_index),
        escapeCsv(o.split_bin_code),
      ].join(",")
    );
  }
  fs.writeFileSync(csvPath, lines.join("\n"), "utf8");

  const summaryLines = [
    `Source file: ${inPath}`,
    `Sheet: ${sheetName}`,
    `Filter: bin labour descriptions only; exclude pour pad / concrete / tear / rebuild; U/M = HR; Ship Qty > ${MIN_HOURS}; qty > 0; multipliers: leading "N X ####", "####NC x N" / "#### x N", comma lists — hours ÷ total bin count`,
    `Output rows: ${outRows.length} (before Greydafton merge: ${beforeMerge})`,
    `Bin size parsed from ship_to: ${parsed}`,
    `Bin size not parsed: ${unparsed}`,
    "",
    "Parse source counts (parsed rows only):",
  ];
  [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, n]) => summaryLines.push(`  ${s}: ${n}`));

  const byMfr = new Map();
  for (const o of outRows) {
    const m = String(o.bin_manufacturer || "").trim() || "(unspecified)";
    byMfr.set(m, (byMfr.get(m) || 0) + 1);
  }
  summaryLines.push("", "bin_manufacturer counts:");
  [...byMfr.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([m, n]) => summaryLines.push(`  ${m}: ${n}`));

  const sumPath = path.join(outDir, "manhourdataold_parse_summary.txt");
  fs.writeFileSync(sumPath, summaryLines.join("\n"), "utf8");

  console.log(summaryLines.join("\n"));
  console.log(`\nWrote ${csvPath}`);
  console.log(`\nWrote ${sumPath}`);
}

main();
