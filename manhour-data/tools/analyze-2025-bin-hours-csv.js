/**
 * Cross-check "2025 Man Hour Data - 2025 Bin Hours.csv" vs workbook totals
 * and flag rows that should not be treated as 2025 calibration builds.
 *
 * Usage: node tools/analyze-2025-bin-hours-csv.js
 */
const fs = require("fs");
const path = require("path");

const CSV = path.join(__dirname, "..", "2025 Man Hour Data - 2025 Bin Hours.csv");

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

function main() {
  if (!fs.existsSync(CSV)) {
    console.error("Missing", CSV);
    process.exit(1);
  }
  const raw = fs.readFileSync(CSV, "utf8");
  const lines = raw.split(/\r?\n/);

  let footerTotal = null;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^,+$/.test(line.replace(/,/g, ""))) continue;
    if (/total bin hours/i.test(line)) {
      const p = parseCsvLine(line);
      const numCell = p.find((x) => /^\d+\.?\d*$/.test(String(x).trim()));
      if (numCell) footerTotal = parseFloat(numCell);
      continue;
    }
    const p = parseCsvLine(line);
    if (p.length < 8) continue;
    const hours = parseFloat(p[7]);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    const yearRaw = String(p[14] ?? p[p.length - 1] ?? "").trim();
    const year = /^\d{4}$/.test(yearRaw) ? parseInt(yearRaw, 10) : NaN;
    rows.push({
      line: i + 1,
      customer: String(p[0] || "").trim(),
      hours,
      year,
      diameter: parseFloat(p[4]),
      rings: parseFloat(p[5]),
    });
  }

  const sum2025 = rows
    .filter((r) => r.year === 2025)
    .reduce((s, r) => s + r.hours, 0);
  const sumAllNumericYear = rows
    .filter((r) => r.year === 2025 || r.year === 2024)
    .reduce((s, r) => s + r.hours, 0);
  const wrongYear = rows.filter((r) => Number.isFinite(r.year) && r.year !== 2025);

  const sorted = [...rows].sort((a, b) => a.hours - b.hours);
  const med = sorted[Math.floor(sorted.length / 2)];

  const out = {
    csv_path: CSV,
    data_rows_with_positive_hours: rows.length,
    sum_hours_year_equals_2025: sum2025,
    sum_hours_2024_or_2025_rows: sumAllNumericYear,
    footer_total_in_csv: footerTotal,
    matches_workbook_sheet1_year2025_8288_82:
      footerTotal != null && Math.abs(sum2025 - footerTotal) < 0.02,
    rows_not_year_2025: wrongYear,
    hours_median_all_parsed_rows: med ? med.hours : null,
    note:
      "Workbook analyze-2025-hours.ps1 filters sheet1 to year=2025 only (25 rows, 8288.82). CSV should match when year column is correct.",
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
