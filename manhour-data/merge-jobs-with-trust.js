/**
 * Combine per-year clean job rollups + trust flags into one CSV for modeling.
 *
 * Inputs (from npm run job-trust):
 *   output/year_2023/sheet1_jobs_with_trust.csv
 *   output/year_2024/sheet1_jobs_with_trust.csv
 *
 * Output:
 *   output/bin_jobs_clean_2023_2024_combined.csv
 *
 * Usage: node merge-jobs-with-trust.js
 */
const fs = require("fs");
const path = require("path");

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

function main() {
  const outRoot = path.join(__dirname, "output");
  const years = [2023, 2024];
  const header = [
    "source_year",
    "canonical_job_id",
    "total_hours_sheet1",
    "contributor_count",
    "contributors_semicolon_separated",
    "trusted",
  ];

  const rows = [];
  for (const year of years) {
    const p = path.join(outRoot, `year_${year}`, "sheet1_jobs_with_trust.csv");
    if (!fs.existsSync(p)) {
      console.error(`Missing ${p}`);
      process.exit(1);
    }
    const table = parseCsv(fs.readFileSync(p, "utf8"));
    const h = table[0].map((x) => x.trim());
    const idx = {
      id: h.indexOf("canonical_job_id"),
      hrs: h.indexOf("total_hours_sheet1"),
      cnt: h.indexOf("contributor_count"),
      people: h.indexOf("contributors_semicolon_separated"),
      trust: h.indexOf("trusted"),
    };
    if (idx.id < 0 || idx.hrs < 0 || idx.trust < 0) {
      console.error(`Unexpected headers in ${p}`);
      process.exit(1);
    }
    for (let r = 1; r < table.length; r++) {
      const line = table[r];
      rows.push({
        source_year: year,
        canonical_job_id: line[idx.id] ?? "",
        total_hours_sheet1: line[idx.hrs] ?? "",
        contributor_count: line[idx.cnt] ?? "",
        contributors_semicolon_separated: line[idx.people] ?? "",
        trusted: line[idx.trust] ?? "",
      });
    }
  }

  const dest = path.join(outRoot, "bin_jobs_clean_2023_2024_combined.csv");
  const linesOut = [header.join(",")];
  for (const row of rows) {
    linesOut.push(
      [
        row.source_year,
        escapeCsv(row.canonical_job_id),
        row.total_hours_sheet1,
        row.contributor_count,
        escapeCsv(row.contributors_semicolon_separated),
        row.trusted,
      ].join(",")
    );
  }
  fs.writeFileSync(dest, linesOut.join("\n"), "utf8");

  const trustedYes = rows.filter((r) => String(r.trusted).toLowerCase() === "yes").length;
  console.log(`Wrote ${dest}`);
  console.log(`  Rows: ${rows.length} (${years.join(" + ")})`);
  console.log(`  trusted=yes: ${trustedYes}, trusted=no: ${rows.length - trustedYes}`);
}

main();
