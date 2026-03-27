/**
 * Predict hours per sold job and calendar / ISO week when each finishes.
 * Usage:
 *   node model/predict_schedule.mjs --start 2026-04-15 --jobs jobs_sold.csv --hours-per-week 320
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readCsv, writeCsv } from "./csv_utils.mjs";
import { predictHours, num } from "./features_bin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function parseArgs(argv) {
  const o = {
    start: null,
    jobs: path.join(ROOT, "jobs_sold.csv"),
    model: path.join(ROOT, "artifacts", "model.json"),
    hoursPerWeek: 320,
    out: path.join(ROOT, "artifacts", "schedule.csv"),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--start") o.start = argv[++i];
    else if (a === "--jobs") o.jobs = argv[++i];
    else if (a === "--model") o.model = argv[++i];
    else if (a === "--hours-per-week") o.hoursPerWeek = Number(argv[++i]);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`Usage:
  node model/predict_schedule.mjs --start YYYY-MM-DD [--jobs path] [--model path]
    [--hours-per-week N] [--out path]

hours-per-week: crew capacity (labor hours you can apply per calendar week).
`);
      process.exit(0);
    }
  }
  return o;
}

function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid date (use YYYY-MM-DD): ${s}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d);
}

/** ISO week number and ISO week-year for local date */
function isoWeekInfo(d) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const n =
    1 +
    Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return { isoYear: date.getFullYear(), isoWeek: n };
}

function addDays(d, days) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.start) {
    console.error("Required: --start YYYY-MM-DD (first day work can begin on sold backlog)");
    process.exit(1);
  }
  if (!Number.isFinite(args.hoursPerWeek) || args.hoursPerWeek <= 0) {
    console.error("Invalid --hours-per-week");
    process.exit(1);
  }

  const start = parseISODate(args.start);
  const model = JSON.parse(fs.readFileSync(args.model, "utf8"));
  const beta = model.beta;
  if (!Array.isArray(beta)) {
    console.error("model.json missing beta array; run: npm run train");
    process.exit(1);
  }

  const { records } = readCsv(args.jobs);
  if (!records.length) {
    console.error("No rows in jobs file.");
    process.exit(1);
  }

  const enriched = records.map((rec, idx) => {
    const seq = num(rec.sequence, idx + 1);
    const jt = String(rec.job_type || "bin").trim().toLowerCase();
    let hours = NaN;
    const ov = rec.hours_override?.trim();
    if (ov !== undefined && ov !== "" && Number.isFinite(Number(ov))) {
      hours = Number(ov);
    } else if (jt === "bin") {
      const build = String(rec.Build ?? "").trim();
      if (build && build !== "New") {
        console.warn(
          `Row ${idx + 2}: Build='${build}' — model is trained on New builds only; prediction may be off.`
        );
      }
      hours = predictHours(beta, rec);
    } else if (jt === "millwright") {
      hours = Number(model.defaults?.millwright_hours ?? 60);
    } else if (jt === "concrete") {
      hours = Number(model.defaults?.concrete_hours ?? 130);
    } else {
      throw new Error(`Unknown job_type '${rec.job_type}' (use bin|millwright|concrete)`);
    }
    if (!Number.isFinite(hours) || hours < 0) {
      throw new Error(`Bad hours for row ${idx + 2}: ${hours}`);
    }
    return { ...rec, _seq: seq, _jt: jt, _hours: hours };
  });

  enriched.sort((a, b) => a._seq - b._seq);

  let cumulative = 0;
  const outRows = [];
  for (const row of enriched) {
    cumulative += row._hours;
    const daysElapsed = (7 * cumulative) / args.hoursPerWeek;
    const completion = addDays(start, daysElapsed);
    const { isoYear, isoWeek } = isoWeekInfo(completion);
    outRows.push({
      sequence: row._seq,
      job_type: row._jt,
      predicted_hours: Math.round(row._hours * 100) / 100,
      cumulative_hours: Math.round(cumulative * 100) / 100,
      completion_date: formatDate(completion),
      iso_year: isoYear,
      iso_week: isoWeek,
      label: row.label || row.Customer || row.name || "",
    });
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  const headers = [
    "sequence",
    "job_type",
    "predicted_hours",
    "cumulative_hours",
    "completion_date",
    "iso_year",
    "iso_week",
    "label",
  ];
  writeCsv(args.out, headers, outRows);
  console.log(`Wrote ${args.out} (${outRows.length} jobs).`);
  if (outRows.length) {
    const last = outRows[outRows.length - 1];
    console.log(
      `Backlog finishes ~ ${last.completion_date} (ISO week ${last.iso_year}-W${String(last.iso_week).padStart(2, "0")}).`
    );
  }
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

main();
