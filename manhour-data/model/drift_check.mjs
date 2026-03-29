/**
 * Check for model drift by analyzing recent performance log entries.
 * Alerts when the model is consistently over- or under-predicting.
 *
 * Usage:
 *   node model/drift_check.mjs
 *   node model/drift_check.mjs --window 10
 *   node model/drift_check.mjs --help
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function parseArgs(argv) {
  const o = {
    logPath: path.join(ROOT, "artifacts", "performance_log.json"),
    window: 5,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(`Usage:
  node model/drift_check.mjs [options]

Options:
  --window N    Number of recent entries to analyze (default: 5)
  --log PATH    Path to performance_log.json
  --help        Show this message

Alerts:
  ⚠ DRIFT DETECTED   — most recent N jobs trend consistently over or under
  ✓ NO DRIFT          — model predictions are within normal variance
`);
      process.exit(0);
    }
    else if (a === "--window") o.window = Number(argv[++i]);
    else if (a === "--log") o.logPath = argv[++i];
  }
  return o;
}

function main() {
  const args = parseArgs(process.argv);

  if (!fs.existsSync(args.logPath)) {
    console.log("  No performance log found. Submit jobs with 'npm run submit' to start tracking.");
    console.log(`  Expected: ${path.relative(ROOT, args.logPath)}`);
    return;
  }

  let log;
  try {
    log = JSON.parse(fs.readFileSync(args.logPath, "utf8"));
  } catch {
    console.error("  Failed to parse performance log.");
    return;
  }

  if (!Array.isArray(log) || log.length === 0) {
    console.log("  Performance log is empty. Submit jobs to start tracking.");
    return;
  }

  const recent = log.slice(-args.window);
  const n = recent.length;

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                  MODEL DRIFT CHECK                          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  // ── Summary stats ──
  const ratings = { FAST: 0, AVERAGE: 0, SLOW: 0 };
  let sumModelErr = 0;
  let sumModelAbsErr = 0;
  let sumModelPctErr = 0;
  let overCount = 0;
  let underCount = 0;

  for (const entry of recent) {
    ratings[entry.rating] = (ratings[entry.rating] || 0) + 1;
    const err = entry.modelError ?? 0;
    sumModelErr += err;
    sumModelAbsErr += Math.abs(err);
    sumModelPctErr += Math.abs(entry.modelErrorPct ?? 0);
    if (err > 0) underCount++;
    if (err < 0) overCount++;
  }

  const meanErr = sumModelErr / n;
  const meanAbsErr = sumModelAbsErr / n;
  const meanPctErr = sumModelPctErr / n;
  const bias = meanErr > 0 ? "under-predicting" : "over-predicting";

  console.log(`  Analyzing last ${n} of ${log.length} total submissions`);
  console.log();
  console.log("  Recent entries:");
  console.log("  " + "─".repeat(80));
  console.log("  " + ["Date".padEnd(12), "Customer".padEnd(25), "Rating".padEnd(9), "Actual".padStart(7), "Pred".padStart(7), "Err".padStart(7)].join("  "));
  console.log("  " + "─".repeat(80));

  for (const entry of recent) {
    const date = (entry.timestamp ?? "").slice(0, 10);
    const cust = String(entry.customer ?? "").slice(0, 25).padEnd(25);
    const ratingClr = entry.rating === "FAST" ? "\x1b[32m" : entry.rating === "SLOW" ? "\x1b[31m" : "\x1b[33m";
    const rating = `${ratingClr}${String(entry.rating).padEnd(9)}\x1b[0m`;
    const actual = String(entry.actualHours ?? "").padStart(7);
    const pred = String(entry.modelPredicted ?? "").padStart(7);
    const err = entry.modelError ?? 0;
    const sign = err >= 0 ? "+" : "";
    console.log(`  ${date.padEnd(12)}  ${cust}  ${rating}  ${actual}  ${pred}  ${sign}${err.toFixed(0).padStart(5)}`);
  }

  console.log();
  console.log("  Metrics:");
  console.log(`    Ratings:        ${ratings.FAST} fast, ${ratings.AVERAGE} average, ${ratings.SLOW} slow`);
  console.log(`    Mean error:     ${meanErr >= 0 ? "+" : ""}${meanErr.toFixed(1)} hrs (model is ${bias})`);
  console.log(`    Mean |error|:   ${meanAbsErr.toFixed(1)} hrs`);
  console.log(`    Mean |% error|: ${meanPctErr.toFixed(1)}%`);
  console.log(`    Direction:      ${underCount} under, ${overCount} over`);
  console.log();

  // ── Drift detection ──
  const driftThresholdPct = 70;
  const biasThresholdHrs = 50;
  const slowRatio = ratings.SLOW / n;
  const fastRatio = ratings.FAST / n;
  const directionBias = Math.max(underCount, overCount) / n;

  let driftDetected = false;
  const alerts = [];

  if (slowRatio >= driftThresholdPct / 100) {
    driftDetected = true;
    alerts.push(`${(slowRatio * 100).toFixed(0)}% of recent jobs rated SLOW — model may be under-predicting.`);
  }
  if (fastRatio >= driftThresholdPct / 100) {
    driftDetected = true;
    alerts.push(`${(fastRatio * 100).toFixed(0)}% of recent jobs rated FAST — model may be over-predicting.`);
  }
  if (Math.abs(meanErr) > biasThresholdHrs && directionBias >= 0.7) {
    driftDetected = true;
    alerts.push(`Systematic bias: mean error ${meanErr >= 0 ? "+" : ""}${meanErr.toFixed(0)} hrs (${bias}).`);
  }

  if (driftDetected) {
    console.log("  \x1b[31m⚠  DRIFT DETECTED\x1b[0m");
    for (const a of alerts) console.log(`     ${a}`);
    console.log();
    console.log("  Recommended action: retrain the model with recent data.");
    console.log("    npm run train");
  } else {
    console.log("  \x1b[32m✓  NO DRIFT DETECTED\x1b[0m");
    console.log("     Model predictions are within normal variance.");
  }
  console.log();

  // ── All-time summary ──
  if (log.length > n) {
    const allRatings = { FAST: 0, AVERAGE: 0, SLOW: 0 };
    for (const entry of log) {
      allRatings[entry.rating] = (allRatings[entry.rating] || 0) + 1;
    }
    console.log(`  All-time (${log.length} jobs): ${allRatings.FAST} fast, ${allRatings.AVERAGE} average, ${allRatings.SLOW} slow`);
    console.log();
  }
}

main();
