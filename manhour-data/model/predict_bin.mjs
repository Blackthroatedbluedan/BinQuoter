/**
 * Predict man-hours for a new bin build and show the 3 closest historical jobs.
 *
 * Usage:
 *   node model/predict_bin.mjs --diameter 42 --rings 14 --guys 6
 *   node model/predict_bin.mjs --diameter 48 --rings 21 --guys 7 --sidedraw --manufacturer Brock
 *   node model/predict_bin.mjs --help
 */
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

function usage() {
  console.log(`Usage:
  node model/predict_bin.mjs [options]

Required:
  --diameter N       Bin diameter in feet
  --rings N          Number of rings

Optional:
  --guys N           Crew size (default: 6)
  --drive N          Drive hours (default: 1)
  --bushels N        Capacity in thousands of bushels (default: auto-estimate)
  --manufacturer S   Brock | Westeel (default: Brock)
  --sidedraw         Enable Sidedraw flag
  --stirator         Enable Stirator flag
  --topdry           Enable TopDry flag
  --daysweep         Enable DaySweep flag
  --hopperbin        Enable HopperBin flag
  --neighbors N      Number of similar historical jobs to show (default: 3)
  --model PATH       Path to model.json
  --csv PATH         Path to training CSV
  --help             Show this message
`);
}

function parseArgs(argv) {
  const o = {
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
    neighbors: 3,
    model: path.join(ROOT, "artifacts", "model.json"),
    csv: path.join(ROOT, "bin_hours_parsed.csv"),
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { usage(); process.exit(0); }
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
    else if (a === "--neighbors") o.neighbors = Number(argv[++i]);
    else if (a === "--model") o.model = argv[++i];
    else if (a === "--csv") o.csv = argv[++i];
    else { console.error(`Unknown arg: ${a}`); process.exit(1); }
  }
  return o;
}

/**
 * Bushels lookup using manufacturer-specific formula (Brock 42″ / Westeel 44″ rings).
 * Falls back to --bushels if provided.
 */
function estimateBushels(diameter, rings, manufacturer) {
  return bushelsCornThousands(diameter, rings, manufacturer);
}

/**
 * Weighted distance between an input job and a historical record.
 * Uses bin geometry (diameter, rings) as primary factors, with equipment
 * flags and manufacturer as secondary. Returns a unitless score (lower = closer).
 */
function jobDistance(input, hist) {
  const dD = num(input.Diameter) - num(hist.Diameter);
  const dR = num(input.Rings) - num(hist.Rings);

  const wDiameter = 1.0;
  const wRings = 2.0;
  const wFlag = 5.0;
  const wMfg = 3.0;

  let dist = wDiameter * (dD * dD) + wRings * (dR * dR);

  for (const flag of FLAG_NAMES) {
    const a = yn(input[flag]);
    const b = yn(hist[flag]);
    if (a !== b) dist += wFlag;
  }

  const mfgInput = String(input.BinManufacturer ?? "Brock").trim();
  const mfgHist = String(hist.BinManufacturer ?? "Brock").trim();
  if (mfgInput !== mfgHist) dist += wMfg;

  return dist;
}

function main() {
  const args = parseArgs(process.argv);

  if (!Number.isFinite(args.diameter) || args.diameter <= 0) {
    console.error("Error: --diameter is required (positive number).");
    process.exit(1);
  }
  if (!Number.isFinite(args.rings) || args.rings < 0) {
    console.error("Error: --rings is required (non-negative number).");
    process.exit(1);
  }

  const bushels = Number.isFinite(args.bushels) && args.bushels > 0
    ? args.bushels
    : estimateBushels(args.diameter, args.rings, args.manufacturer);

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

  const flags = FLAG_NAMES.filter((f) => inputRec[f] === "Yes");

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                  BIN HOURS PREDICTION                       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("  Input:");
  console.log(`    Diameter:     ${args.diameter} ft`);
  console.log(`    Rings:        ${args.rings}`);
  console.log(`    Bushels (k):  ${bushels.toFixed(1)}${Number.isFinite(args.bushels) && args.bushels > 0 ? "" : "  (auto-estimated)"}`);
  console.log(`    Crew size:    ${args.guys}`);
  console.log(`    Drive hours:  ${args.drive}`);
  console.log(`    Manufacturer: ${args.manufacturer}`);
  console.log(`    Equipment:    ${flags.length ? flags.join(", ") : "none"}`);
  console.log();
  console.log("  ┌────────────────────────────────────┐");
  console.log(`  │  PREDICTED HOURS:  ${predicted.toFixed(1).padStart(8)} hrs     │`);
  console.log("  └────────────────────────────────────┘");
  console.log();
  console.log(`  ${nearest.length} closest historical jobs:`);
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
}

main();
