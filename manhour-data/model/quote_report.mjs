/**
 * Generate a formatted quote report for a new bin build.
 * Outputs predicted hours, labor cost, and comparable historical jobs.
 *
 * Usage:
 *   node model/quote_report.mjs --customer "Smith Farms" --diameter 42 --rings 14 --guys 6
 *   node model/quote_report.mjs --diameter 48 --rings 21 --guys 7 --sidedraw --rate 65
 *   node model/quote_report.mjs --help
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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

function parseArgs(argv) {
  const o = {
    customer: "",
    diameter: NaN,
    rings: NaN,
    guys: 6,
    drive: 1,
    bushels: NaN,
    manufacturer: "Brock",
    sidedraw: false,
    stirator: false,
    topDry: false,
    daySweep: false,
    hopperBin: false,
    rate: 60,
    neighbors: 3,
    save: false,
    model: path.join(ROOT, "artifacts", "model.json"),
    csv: path.join(ROOT, "bin_hours_parsed.csv"),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { printUsage(); process.exit(0); }
    else if (a === "--customer") o.customer = argv[++i];
    else if (a === "--diameter") o.diameter = Number(argv[++i]);
    else if (a === "--rings") o.rings = Number(argv[++i]);
    else if (a === "--guys") o.guys = Number(argv[++i]);
    else if (a === "--drive") o.drive = Number(argv[++i]);
    else if (a === "--bushels") o.bushels = Number(argv[++i]);
    else if (a === "--manufacturer") o.manufacturer = argv[++i];
    else if (a === "--sidedraw") o.sidedraw = true;
    else if (a === "--stirator") o.stirator = true;
    else if (a === "--topdry") o.topDry = true;
    else if (a === "--daysweep") o.daySweep = true;
    else if (a === "--hopperbin") o.hopperBin = true;
    else if (a === "--rate") o.rate = Number(argv[++i]);
    else if (a === "--neighbors") o.neighbors = Number(argv[++i]);
    else if (a === "--save") o.save = true;
    else if (a === "--model") o.model = argv[++i];
    else if (a === "--csv") o.csv = argv[++i];
    else { console.error(`Unknown arg: ${a}`); process.exit(1); }
  }
  return o;
}

function printUsage() {
  console.log(`Usage:
  node model/quote_report.mjs [options]

Required:
  --diameter N       Bin diameter in feet
  --rings N          Number of rings

Optional:
  --customer NAME    Customer name (for the report header)
  --guys N           Crew size (default: 6)
  --drive N          Drive hours (default: 1)
  --bushels N        Capacity in thousands of bushels (default: auto)
  --manufacturer S   Brock | Westeel (default: Brock)
  --rate N           Labor rate $/hr (default: 60)
  --sidedraw         Sidedraw flag
  --stirator         Stirator flag
  --topdry           TopDry flag
  --daysweep         DaySweep flag
  --hopperbin        HopperBin flag
  --neighbors N      Comparables to show (default: 3)
  --save             Save report to artifacts/quotes/
  --help             Show this message
`);
}

function jobDistance(input, hist) {
  const dD = num(input.Diameter) - num(hist.Diameter);
  const dR = num(input.Rings) - num(hist.Rings);
  let dist = 1.0 * (dD * dD) + 2.0 * (dR * dR);
  for (const f of FLAG_NAMES) {
    if (yn(input[f]) !== yn(hist[f])) dist += 5.0;
  }
  if (String(input.BinManufacturer ?? "Brock").trim() !== String(hist.BinManufacturer ?? "Brock").trim()) dist += 3.0;
  return dist;
}

function fmtMoney(n) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pad(s, w) { return String(s).padStart(w); }

function main() {
  const args = parseArgs(process.argv);
  if (!Number.isFinite(args.diameter) || args.diameter <= 0) {
    console.error("Error: --diameter required."); process.exit(1);
  }
  if (!Number.isFinite(args.rings) || args.rings < 0) {
    console.error("Error: --rings required."); process.exit(1);
  }

  const bushels = Number.isFinite(args.bushels) && args.bushels > 0
    ? args.bushels
    : bushelsCornThousands(args.diameter, args.rings, args.manufacturer);

  const inputRec = {
    Drive_hrs: String(args.drive),
    Build: "New",
    BinManufacturer: args.manufacturer,
    Diameter: String(args.diameter),
    Rings: String(args.rings),
    Bushels_k: String(bushels),
    Guys: String(args.guys),
    Sidedraw: args.sidedraw ? "Yes" : "No",
    Stirator: args.stirator ? "Yes" : "No",
    TopDry: args.topDry ? "Yes" : "No",
    DaySweep: args.daySweep ? "Yes" : "No",
    HopperBin: args.hopperBin ? "Yes" : "No",
  };

  const model = loadModel(args.model);
  const predicted = predictBinJobHours(model.beta, inputRec);
  const laborCost = predicted * args.rate;

  const records = loadBinTrainingRecords(args.csv, {
    yearFilter: null, buildNewOnly: true, defaultGuys: 6,
  });
  const scored = records.map(rec => ({
    rec, dist: jobDistance(inputRec, rec), actual: num(rec.Hours, NaN),
  }));
  scored.sort((a, b) => a.dist - b.dist);
  const nearest = scored.slice(0, Math.max(1, args.neighbors));
  const neighborAvg = nearest.reduce((s, n) => s + n.actual, 0) / nearest.length;
  const neighborCostAvg = neighborAvg * args.rate;

  const flags = FLAG_NAMES.filter(f => inputRec[f] === "Yes");
  const dateStr = new Date().toLocaleDateString("en-CA");

  const lines = [];
  const w = 68;
  const hr = "═".repeat(w);
  const rule = "─".repeat(w);

  lines.push(hr);
  lines.push("  LABOR ESTIMATE — GRAIN BIN CONSTRUCTION");
  lines.push(hr);
  lines.push(`  Date:          ${dateStr}`);
  if (args.customer) lines.push(`  Customer:      ${args.customer}`);
  lines.push("");
  lines.push("  BIN SPECIFICATION");
  lines.push("  " + rule.slice(2));
  lines.push(`  Manufacturer:  ${args.manufacturer}`);
  lines.push(`  Diameter:      ${args.diameter} ft`);
  lines.push(`  Rings:         ${args.rings}`);
  lines.push(`  Capacity:      ${bushels.toFixed(1)} thousand bushels`);
  lines.push(`  Equipment:     ${flags.length ? flags.join(", ") : "None"}`);
  lines.push("");
  lines.push("  CREW");
  lines.push("  " + rule.slice(2));
  lines.push(`  Crew size:     ${args.guys}`);
  lines.push(`  Drive hours:   ${args.drive}`);
  lines.push(`  Labor rate:    ${fmtMoney(args.rate)}/hr`);
  lines.push("");
  lines.push("  ESTIMATE");
  lines.push("  " + rule.slice(2));
  lines.push(`  Predicted hours:     ${pad(predicted.toFixed(1), 8)} hrs`);
  lines.push(`  Estimated labor:     ${pad(fmtMoney(laborCost), 12)}`);
  lines.push("");
  lines.push(`  Neighbor avg hours:  ${pad(neighborAvg.toFixed(1), 8)} hrs`);
  lines.push(`  Neighbor avg cost:   ${pad(fmtMoney(neighborCostAvg), 12)}`);
  lines.push("");

  const lowHrs = Math.min(predicted, neighborAvg) * 0.9;
  const highHrs = Math.max(predicted, neighborAvg) * 1.1;
  lines.push(`  Range (±10%):        ${pad(lowHrs.toFixed(0), 5)} – ${highHrs.toFixed(0)} hrs`);
  lines.push(`                       ${pad(fmtMoney(lowHrs * args.rate), 9)} – ${fmtMoney(highHrs * args.rate)}`);
  lines.push("");
  lines.push("  COMPARABLE HISTORICAL BUILDS");
  lines.push("  " + rule.slice(2));
  lines.push("  " + ["#", "Customer".padEnd(28), "D×R".padStart(7), "Equip".padEnd(12), "Hours".padStart(7), "Year"].join("  "));
  lines.push("  " + rule.slice(2));

  nearest.forEach((n, i) => {
    const r = n.rec;
    const cust = String(r.Customer ?? "").slice(0, 28).padEnd(28);
    const dxr = `${num(r.Diameter)}×${num(r.Rings)}`.padStart(7);
    const eq = FLAG_NAMES.filter(f => yn(r[f])).join(",") || "—";
    const hrs = n.actual.toFixed(1).padStart(7);
    const yr = String(r.year ?? "").padStart(4);
    lines.push(`  ${String(i + 1)}  ${cust}  ${dxr}  ${eq.padEnd(12)}  ${hrs}  ${yr}`);
  });

  lines.push("");
  lines.push("  " + rule.slice(2));
  lines.push(`  Model: Ridge v${model.version} (${model.trainingRows} training builds, LOO RMSE ${Number(model.looRmseHours).toFixed(0)} hrs)`);
  lines.push(hr);

  const report = lines.join("\n");
  console.log(report);

  if (args.save) {
    const outDir = path.join(ROOT, "artifacts", "quotes");
    fs.mkdirSync(outDir, { recursive: true });
    const safeName = (args.customer || "unnamed").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const filename = `quote_${safeName}_${args.diameter}x${args.rings}_${dateStr}.txt`;
    const outPath = path.join(outDir, filename);
    fs.writeFileSync(outPath, report, "utf8");
    console.log(`\n  ✓ Saved to ${path.relative(ROOT, outPath)}`);
  }
}

main();
