/**
 * Submit a completed bin job: evaluate performance vs model + neighbors,
 * rate as FAST / AVERAGE / SLOW, and append to training CSV.
 *
 * Usage:
 *   node model/submit_job.mjs --customer "Smith Farms" --diameter 42 --rings 14 --hours 260 --guys 6
 *   node model/submit_job.mjs --customer "Big Build" --diameter 72 --rings 25 --hours 1300 --guys 8 --sidedraw --daysweep --year 2025
 *   node model/submit_job.mjs --help
 *   node model/submit_job.mjs --dry-run --customer Test --diameter 36 --rings 17 --hours 280 --guys 6
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { loadModel, predictBinJobHours } from "./bin_hours_api.mjs";
import {
  loadBinTrainingRecords,
  num,
  yn,
} from "./features_bin.mjs";
import { bushelsCornThousands } from "./bushels_brock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const FLAG_NAMES = ["Sidedraw", "Stirator", "TopDry", "DaySweep", "HopperBin"];

function usage() {
  console.log(`Usage:
  node model/submit_job.mjs [options]

Required:
  --customer NAME    Customer / job name
  --diameter N       Bin diameter in feet
  --rings N          Number of rings
  --hours N          Actual man-hours for the completed job

Optional:
  --guys N           Crew size (default: 6)
  --drive N          Drive hours (default: 1)
  --bushels N        Capacity in thousands of bushels (default: auto-estimate)
  --manufacturer S   Brock | Westeel (default: Brock)
  --year N           Year of the build (default: current year)
  --sidedraw         Enable Sidedraw flag
  --stirator         Enable Stirator flag
  --topdry           Enable TopDry flag
  --daysweep         Enable DaySweep flag
  --hopperbin        Enable HopperBin flag
  --neighbors N      Number of similar historical jobs to show (default: 3)
  --dry-run          Evaluate only — do not append to training CSV
  --retrain          Retrain the model after appending (runs npm run train)
  --model PATH       Path to model.json
  --csv PATH         Path to training CSV
  --help             Show this message
`);
}

function parseArgs(argv) {
  const o = {
    customer: "",
    diameter: NaN,
    rings: NaN,
    hours: NaN,
    guys: 6,
    drive: 1,
    bushels: NaN,
    manufacturer: "Brock",
    year: new Date().getFullYear(),
    sidedraw: false,
    stirator: false,
    topDry: false,
    daySweep: false,
    hopperBin: false,
    neighbors: 3,
    dryRun: false,
    retrain: false,
    model: path.join(ROOT, "artifacts", "model.json"),
    csv: path.join(ROOT, "bin_hours_parsed.csv"),
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { usage(); process.exit(0); }
    else if (a === "--customer") o.customer = argv[++i];
    else if (a === "--diameter") o.diameter = Number(argv[++i]);
    else if (a === "--rings") o.rings = Number(argv[++i]);
    else if (a === "--hours") o.hours = Number(argv[++i]);
    else if (a === "--guys") o.guys = Number(argv[++i]);
    else if (a === "--drive") o.drive = Number(argv[++i]);
    else if (a === "--bushels") o.bushels = Number(argv[++i]);
    else if (a === "--manufacturer") o.manufacturer = argv[++i];
    else if (a === "--year") o.year = Number(argv[++i]);
    else if (a === "--sidedraw") o.sidedraw = true;
    else if (a === "--stirator") o.stirator = true;
    else if (a === "--topdry") o.topDry = true;
    else if (a === "--daysweep") o.daySweep = true;
    else if (a === "--hopperbin") o.hopperBin = true;
    else if (a === "--neighbors") o.neighbors = Number(argv[++i]);
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--retrain") o.retrain = true;
    else if (a === "--model") o.model = argv[++i];
    else if (a === "--csv") o.csv = argv[++i];
    else { console.error(`Unknown arg: ${a}`); process.exit(1); }
  }
  return o;
}

function estimateBushels(diameter, rings, manufacturer) {
  return bushelsCornThousands(diameter, rings, manufacturer);
}

function jobDistance(input, hist) {
  const dD = num(input.Diameter) - num(hist.Diameter);
  const dR = num(input.Rings) - num(hist.Rings);
  let dist = 1.0 * (dD * dD) + 2.0 * (dR * dR);
  for (const flag of FLAG_NAMES) {
    if (yn(input[flag]) !== yn(hist[flag])) dist += 5.0;
  }
  const mA = String(input.BinManufacturer ?? "Brock").trim();
  const mB = String(hist.BinManufacturer ?? "Brock").trim();
  if (mA !== mB) dist += 3.0;
  return dist;
}

/**
 * Rate a job's pace relative to model prediction and neighbor average.
 *
 * Uses the geometric mean of (actual/predicted) and (actual/neighborAvg) to
 * blend both signals. Thresholds are calibrated against the training set:
 *   FAST:    actual ≤ 85% of expected  (well under budget)
 *   AVERAGE: 85–115% of expected       (within normal range)
 *   SLOW:    actual > 115% of expected  (over budget)
 */
function ratePerformance(actual, predicted, neighborAvgHours) {
  const ratioModel = predicted > 0 ? actual / predicted : 1;
  const ratioNeighbors = neighborAvgHours > 0 ? actual / neighborAvgHours : 1;
  const blended = Math.sqrt(ratioModel * ratioNeighbors);

  if (blended <= 0.85) return { rating: "FAST", blended, ratioModel, ratioNeighbors };
  if (blended <= 1.15) return { rating: "AVERAGE", blended, ratioModel, ratioNeighbors };
  return { rating: "SLOW", blended, ratioModel, ratioNeighbors };
}

function ratingColor(rating) {
  if (rating === "FAST") return "\x1b[32m";    // green
  if (rating === "AVERAGE") return "\x1b[33m"; // yellow
  return "\x1b[31m";                            // red
}
const RESET = "\x1b[0m";

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Append a structured entry to artifacts/performance_log.json.
 * The log is an array of objects — one per submitted job.
 */
function appendPerformanceLog(logPath, entry) {
  let log = [];
  if (fs.existsSync(logPath)) {
    try { log = JSON.parse(fs.readFileSync(logPath, "utf8")); } catch { log = []; }
  }
  log.push(entry);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.customer) {
    console.error("Error: --customer is required.");
    process.exit(1);
  }
  if (!Number.isFinite(args.diameter) || args.diameter <= 0) {
    console.error("Error: --diameter is required (positive number).");
    process.exit(1);
  }
  if (!Number.isFinite(args.rings) || args.rings < 0) {
    console.error("Error: --rings is required (non-negative number).");
    process.exit(1);
  }
  if (!Number.isFinite(args.hours) || args.hours <= 0) {
    console.error("Error: --hours is required (positive number — actual hours for the completed job).");
    process.exit(1);
  }

  const bushels = Number.isFinite(args.bushels) && args.bushels > 0
    ? args.bushels
    : estimateBushels(args.diameter, args.rings, args.manufacturer);

  const inputRec = {
    Customer: args.customer,
    Drive_hrs: String(args.drive),
    Build: "New",
    BinManufacturer: args.manufacturer,
    Diameter: String(args.diameter),
    Rings: String(args.rings),
    Bushels_k: String(bushels),
    Hours: String(args.hours),
    Guys: String(args.guys),
    Sidedraw: args.sidedraw ? "Yes" : "No",
    Stirator: args.stirator ? "Yes" : "No",
    TopDry: args.topDry ? "Yes" : "No",
    DaySweep: args.daySweep ? "Yes" : "No",
    HopperBin: args.hopperBin ? "Yes" : "No",
    year: String(args.year),
  };

  const model = loadModel(args.model);
  const predicted = predictBinJobHours(model.beta, inputRec);

  const records = loadBinTrainingRecords(args.csv, {
    yearFilter: null,
    buildNewOnly: true,
    defaultGuys: 6,
  });

  const scored = records.map((rec) => ({
    rec,
    dist: jobDistance(inputRec, rec),
    actual: num(rec.Hours, NaN),
  }));
  scored.sort((a, b) => a.dist - b.dist);
  const nearest = scored.slice(0, Math.max(1, args.neighbors));
  const neighborAvg = nearest.reduce((s, n) => s + n.actual, 0) / nearest.length;

  const perf = ratePerformance(args.hours, predicted, neighborAvg);
  const modelErr = args.hours - predicted;
  const modelPct = predicted > 0 ? ((args.hours - predicted) / predicted) * 100 : 0;
  const neighborErr = args.hours - neighborAvg;

  const flags = FLAG_NAMES.filter((f) => inputRec[f] === "Yes");
  const clr = ratingColor(perf.rating);

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                  JOB PERFORMANCE REPORT                     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  Customer:      ${args.customer}`);
  console.log(`  Bin:           ${args.diameter}ft × ${args.rings} rings  (${bushels.toFixed(1)}k bu)`);
  console.log(`  Crew:          ${args.guys} guys,  ${args.drive} hr drive`);
  console.log(`  Manufacturer:  ${args.manufacturer}`);
  console.log(`  Equipment:     ${flags.length ? flags.join(", ") : "none"}`);
  console.log(`  Year:          ${args.year}`);
  console.log();
  console.log("  ┌──────────────────────────────────────────────────────┐");
  console.log(`  │  ACTUAL HOURS:     ${String(args.hours.toFixed(1)).padStart(8)} hrs                   │`);
  console.log(`  │  MODEL PREDICTED:  ${predicted.toFixed(1).padStart(8)} hrs  (${modelErr >= 0 ? "+" : ""}${modelErr.toFixed(0)} / ${modelPct >= 0 ? "+" : ""}${modelPct.toFixed(0)}%)${" ".repeat(Math.max(0, 7 - String(Math.round(modelPct)).length))}│`);
  console.log(`  │  NEIGHBOR AVG:     ${neighborAvg.toFixed(1).padStart(8)} hrs  (${neighborErr >= 0 ? "+" : ""}${neighborErr.toFixed(0)})${" ".repeat(Math.max(0, 18 - String(Math.round(neighborErr)).length))}│`);
  console.log("  │                                                      │");
  console.log(`  │  RATING:  ${clr}${perf.rating.padEnd(8)}${RESET}                                     │`);
  console.log("  └──────────────────────────────────────────────────────┘");
  console.log();

  if (perf.rating === "FAST") {
    console.log("  ✓ This build came in under expected hours.");
    console.log(`    ${((1 - perf.blended) * 100).toFixed(0)}% faster than expected (model + neighbor blend).`);
  } else if (perf.rating === "SLOW") {
    console.log("  ✗ This build ran over expected hours.");
    console.log(`    ${((perf.blended - 1) * 100).toFixed(0)}% slower than expected (model + neighbor blend).`);
  } else {
    console.log("  ● This build was within normal range.");
  }
  console.log();

  console.log(`  ${nearest.length} closest historical comparables:`);
  console.log("  ─────────────────────────────────────────────────────────────");
  console.log(
    "  " +
      ["#", "Customer".padEnd(30), "D×R".padStart(7), "Equip".padEnd(12), "Hours".padStart(7), "Year"].join("  ")
  );
  console.log("  ─────────────────────────────────────────────────────────────");

  nearest.forEach((n, i) => {
    const r = n.rec;
    const cust = String(r.Customer ?? "").slice(0, 30).padEnd(30);
    const dxr = `${num(r.Diameter)}×${num(r.Rings)}`.padStart(7);
    const eq = FLAG_NAMES.filter((f) => yn(r[f])).join(",") || "—";
    const hrs = n.actual.toFixed(1).padStart(7);
    const yr = String(r.year ?? "").padStart(4);
    console.log(`  ${String(i + 1).padStart(1)}  ${cust}  ${dxr}  ${eq.padEnd(12)}  ${hrs}  ${yr}`);
  });
  console.log();

  // ── Performance log entry ──
  const logEntry = {
    timestamp: new Date().toISOString(),
    customer: args.customer,
    diameter: args.diameter,
    rings: args.rings,
    bushelsK: bushels,
    guys: args.guys,
    driveHours: args.drive,
    manufacturer: args.manufacturer,
    equipment: flags,
    year: args.year,
    actualHours: args.hours,
    modelPredicted: Math.round(predicted * 10) / 10,
    neighborAvg: Math.round(neighborAvg * 10) / 10,
    modelError: Math.round(modelErr * 10) / 10,
    modelErrorPct: Math.round(modelPct * 10) / 10,
    neighborError: Math.round(neighborErr * 10) / 10,
    blendedRatio: Math.round(perf.blended * 1000) / 1000,
    rating: perf.rating,
    neighbors: nearest.map(n => ({
      customer: String(n.rec.Customer ?? ""),
      diameter: num(n.rec.Diameter),
      rings: num(n.rec.Rings),
      hours: n.actual,
      year: String(n.rec.year ?? ""),
    })),
  };

  // ── Append to training CSV + log ──
  if (args.dryRun) {
    console.log("  [dry-run] Skipping CSV append and performance log.");
    console.log();
    return;
  }

  const csvHeaders = [
    "Customer", "Drive_hrs", "Build", "BinManufacturer", "Diameter", "Rings",
    "Bushels_k", "Hours", "Guys", "Sidedraw", "Stirator", "TopDry",
    "DaySweep", "HopperBin", "year",
  ];
  const csvValues = csvHeaders.map((h) => csvEscape(inputRec[h]));
  const line = csvValues.join(",");

  fs.appendFileSync(args.csv, "\n" + line, "utf8");

  const logPath = path.join(ROOT, "artifacts", "performance_log.json");
  appendPerformanceLog(logPath, logEntry);

  console.log(`  ✓ Appended to ${path.relative(ROOT, args.csv)}`);
  console.log(`  ✓ Logged to ${path.relative(ROOT, logPath)}`);
  console.log(`    Row: ${line}`);
  console.log();
  if (args.retrain) {
    console.log("  Retraining model...");
    console.log();
    try {
      execSync("node model/train_model.mjs", { cwd: ROOT, stdio: "inherit" });
      console.log();
      console.log("  ✓ Model retrained with new data.");
    } catch (e) {
      console.error("  ✗ Retrain failed:", e.message);
    }
  } else {
    console.log("  Note: run 'npm run train' (or use --retrain) to retrain the model with this new data.");
  }
  console.log();
}

main();
