/** Sum hours column in sheet1_daily_lines.csv (handles quoted fields). */
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

function sumHours(year) {
  const p = path.join(__dirname, "..", "output", `year_${year}`, "sheet1_daily_lines.csv");
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, "utf8").trim().split(/\r?\n/);
  if (lines.length < 2) return 0;
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const hi = headers.indexOf("hours");
  if (hi < 0) return null;
  let s = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const row = parseCsvLine(lines[i]);
    const v = parseFloat(String(row[hi] ?? "").replace(/,/g, ""));
    if (Number.isFinite(v)) s += v;
  }
  return s;
}

const y2023 = sumHours(2023);
const y2024 = sumHours(2024);
console.log(JSON.stringify({ year_2023_sheet1_sum: y2023, year_2024_sheet1_sum: y2024 }));
