const fs = require("fs");
const path = require("path");
const combined = path.join(__dirname, "..", "output", "bin_jobs_clean_2023_2024_combined.csv");

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

const text = fs.readFileSync(combined, "utf8");
const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
const headers = parseCsvLine(lines[0]).map((h) => h.trim());
const ti = headers.indexOf("trusted");
const mi = headers.indexOf("invoice_match");
const di = headers.indexOf("invoice_description");
const ji = headers.indexOf("canonical_job_id");
const yi = headers.indexOf("source_year");

let trustedTotal = 0;
let trustedWithInvoice = 0;
let trustedMissing = 0;
const missing = [];

for (let r = 1; r < lines.length; r++) {
  const row = parseCsvLine(lines[r]);
  const trusted = String(row[ti] ?? "").toLowerCase().trim() === "yes";
  if (!trusted) continue;
  trustedTotal++;
  const invMatch = String(row[mi] ?? "").toLowerCase().trim() === "yes";
  const desc = String(row[di] ?? "").trim();
  if (invMatch && desc.length > 0) {
    trustedWithInvoice++;
  } else {
    trustedMissing++;
    missing.push({
      source_year: row[yi],
      canonical_job_id: row[ji],
      invoice_match: row[mi],
      desc_len: desc.length,
    });
  }
}

console.log(`trusted=yes rows: ${trustedTotal}`);
console.log(`  with invoice_match=yes AND non-empty Ship To / description: ${trustedWithInvoice}`);
console.log(`  without matching invoice text: ${trustedMissing}`);
console.log("");
if (missing.length) {
  console.log("Trusted jobs missing invoice text (first 25):");
  missing.slice(0, 25).forEach((m) => console.log(JSON.stringify(m)));
}
