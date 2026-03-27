/**
 * Combine 2025 bin-hours CSV (parsed workbook) with filled historical training rows.
 * Writes bin_hours_parsed.csv for npm run train.
 *
 * Base file must contain only rows from parse-bin-hours (no historical), so re-runs
 * do not duplicate historical lines.
 *
 * Usage:
 *   node model/merge_bin_training_csv.mjs
 *   node model/merge_bin_training_csv.mjs --base data/bin_hours_2025_parsed.csv --historical data/historical_training_filled.csv
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readCsv, writeCsv } from "./csv_utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const OUT_HEADERS = [
  "Customer",
  "Drive_hrs",
  "Build",
  "BinManufacturer",
  "Diameter",
  "Rings",
  "Bushels_k",
  "Hours",
  "Guys",
  "Sidedraw",
  "Stirator",
  "TopDry",
  "DaySweep",
  "HopperBin",
  "year",
];

function parseArgs(argv) {
  let base = path.join(ROOT, "data", "bin_hours_2025_parsed.csv");
  let historical = path.join(ROOT, "data", "historical_training_filled.csv");
  let out = path.join(ROOT, "bin_hours_parsed.csv");
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--base") base = argv[++i];
    else if (argv[i] === "--historical") historical = argv[++i];
    else if (argv[i] === "--out") out = argv[++i];
  }
  return { base, historical, out };
}

function mapHistoricalRow(rec) {
  const drive =
    String(rec.Drive_hrs_TO_FILL ?? "").trim() ||
    String(rec.Drive_hrs ?? "").trim();
  const guys =
    String(rec.Guys_TO_FILL ?? "").trim() ||
    String(rec.Guys ?? "").trim();
  const o = {};
  for (const h of OUT_HEADERS) {
    if (h === "Drive_hrs") o[h] = drive;
    else if (h === "Guys") o[h] = guys;
    else o[h] = rec[h] !== undefined ? String(rec[h]).trim() : "";
  }
  return o;
}

function normalizeBaseRow(rec) {
  const o = {};
  for (const h of OUT_HEADERS) {
    o[h] = rec[h] !== undefined ? String(rec[h]).trim() : "";
  }
  return o;
}

function main() {
  const { base, historical, out } = parseArgs(process.argv);

  if (!fs.existsSync(base)) {
    console.error("Base file not found:", base);
    process.exit(1);
  }
  if (!fs.existsSync(historical)) {
    console.error("Historical file not found:", historical);
    process.exit(1);
  }

  const baseCsv = readCsv(base);
  const histCsv = readCsv(historical);

  const merged = [];
  for (const rec of baseCsv.records) merged.push(normalizeBaseRow(rec));
  for (const rec of histCsv.records) merged.push(mapHistoricalRow(rec));

  fs.mkdirSync(path.dirname(out), { recursive: true });
  writeCsv(out, OUT_HEADERS, merged);
  console.log(
    `Wrote ${out} (${baseCsv.records.length} base + ${histCsv.records.length} historical = ${merged.length} rows).`
  );
}

main();
