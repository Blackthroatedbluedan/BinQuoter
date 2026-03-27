/**
 * Add parsed bin diameter/rings from invoice text + job # encoding, and flag concrete
 * lines so bin calculator can use bin_hours_for_bin_model (excludes concrete scope).
 *
 * Reads:  output/bin_jobs_clean_2023_2024_combined.csv
 * Writes: same (backup .bak2) + strips old enrich columns if re-run
 *
 * Usage: node enrich-bin-jobs-csv.js
 */
const fs = require("fs");
const path = require("path");
const {
  isConcreteInDescription,
  parseBinSize,
  binHoursForModel,
} = require("./lib/parseBinSizeFromInvoice.js");

const OUT = path.join(__dirname, "output", "bin_jobs_clean_2023_2024_combined.csv");

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

function escapeCsv(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const ENRICH_COLS = [
  "parsed_diameter_ft",
  "parsed_rings",
  "bin_size_parse_source",
  "bin_exclude_concrete",
  "bin_hours_for_bin_model",
];

function main() {
  if (!fs.existsSync(OUT)) {
    console.error(`Missing ${OUT}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(OUT, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const headerRow = parseCsvLine(lines[0]).map((h) => h.trim());

  const strip = new Set(ENRICH_COLS);
  const baseHeaders = headerRow.filter((h) => !strip.has(h));
  const headers = baseHeaders.concat(ENRICH_COLS);

  const idx = {};
  baseHeaders.forEach((h, i) => {
    idx[h] = i;
  });

  const outLines = [headers.join(",")];
  for (let r = 1; r < lines.length; r++) {
    const row = parseCsvLine(lines[r]);
    const obj = {};
    baseHeaders.forEach((h) => {
      const j = headerRow.indexOf(h);
      obj[h] = j >= 0 && row[j] !== undefined ? row[j] : "";
    });

    const jobId = obj.canonical_job_id ?? "";
    const inv = obj.invoice_description ?? "";
    const total = obj.total_hours_sheet1 ?? "";

    const concrete = isConcreteInDescription(inv);
    const parsed = parseBinSize(jobId, inv);

    obj.parsed_diameter_ft = parsed ? String(parsed.diameter) : "";
    obj.parsed_rings = parsed ? String(parsed.rings) : "";
    obj.bin_size_parse_source = parsed ? parsed.source : "";
    obj.bin_exclude_concrete = concrete ? "yes" : "no";
    obj.bin_hours_for_bin_model = binHoursForModel(total, inv);

    const line = headers.map((h) => escapeCsv(obj[h]));
    outLines.push(line.join(","));
  }

  fs.copyFileSync(OUT, OUT + ".bak2");
  fs.writeFileSync(OUT, outLines.join("\n"), "utf8");
  console.log(`Wrote ${OUT}`);
  console.log(`Backup: ${OUT}.bak2`);
  console.log(
    `Columns added: ${ENRICH_COLS.join(", ")}`
  );
}

main();
