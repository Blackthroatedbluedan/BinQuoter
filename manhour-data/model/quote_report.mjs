/**
 * Generate a formatted quote report for a new bin build.
 * Includes full cost breakdown: labor (billing + internal), hotel, diesel, machine rental.
 *
 * Usage:
 *   node model/quote_report.mjs --customer "Smith Farms" --diameter 42 --rings 14 --drive 2
 *   node model/quote_report.mjs --diameter 48 --rings 21 --drive 3 --sidedraw --machine
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

// ── Cost defaults ──
const BILLING_RATE = 60;         // $/hr charged to customer, per crew member
const LABOURER_WAGE = 24;        // $/hr internal cost
const FOREMAN_WAGE = 40;         // $/hr internal cost
const DEFAULT_LABOURERS = 5;
const DEFAULT_FOREMEN = 1;
const HOTEL_RATE = 160;          // $/room/night
const HOTEL_PPL_PER_ROOM = 2;
const HOTEL_DRIVE_THRESHOLD = 1.5; // hrs — stay at hotel if drive > this
const DIESEL_RATE_PER_KM = 0.55;  // $/km (crew truck + trailer)
const AVG_SPEED_KMH = 80;         // average highway speed
const MACHINE_RENTAL_PER_DAY = 250;
const WORK_HOURS_PER_DAY = 10;    // effective build hours per day

function parseArgs(argv) {
  const o = {
    customer: "",
    diameter: NaN,
    rings: NaN,
    labourers: DEFAULT_LABOURERS,
    foremen: DEFAULT_FOREMEN,
    drive: 1,
    bushels: NaN,
    manufacturer: "Brock",
    sidedraw: false,
    stirator: false,
    topDry: false,
    daySweep: false,
    hopperBin: false,
    billingRate: BILLING_RATE,
    dieselRate: DIESEL_RATE_PER_KM,
    hotelRate: HOTEL_RATE,
    machine: false,
    machineRate: MACHINE_RENTAL_PER_DAY,
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
    else if (a === "--labourers") o.labourers = Number(argv[++i]);
    else if (a === "--foremen") o.foremen = Number(argv[++i]);
    else if (a === "--guys") { const g = Number(argv[++i]); o.labourers = Math.max(0, g - o.foremen); }
    else if (a === "--drive") o.drive = Number(argv[++i]);
    else if (a === "--bushels") o.bushels = Number(argv[++i]);
    else if (a === "--manufacturer") o.manufacturer = argv[++i];
    else if (a === "--sidedraw") o.sidedraw = true;
    else if (a === "--stirator") o.stirator = true;
    else if (a === "--topdry") o.topDry = true;
    else if (a === "--daysweep") o.daySweep = true;
    else if (a === "--hopperbin") o.hopperBin = true;
    else if (a === "--rate") o.billingRate = Number(argv[++i]);
    else if (a === "--diesel-rate") o.dieselRate = Number(argv[++i]);
    else if (a === "--hotel-rate") o.hotelRate = Number(argv[++i]);
    else if (a === "--machine") o.machine = true;
    else if (a === "--machine-rate") o.machineRate = Number(argv[++i]);
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

Crew:
  --labourers N      Number of labourers (default: ${DEFAULT_LABOURERS})
  --foremen N        Number of foremen (default: ${DEFAULT_FOREMEN})
  --guys N           Total crew size (shortcut: sets labourers = guys - foremen)
  --drive N          One-way drive hours to site (default: 1)

Costs:
  --rate N           Billing rate $/hr per crew member (default: ${BILLING_RATE})
  --diesel-rate N    Diesel cost $/km (default: ${DIESEL_RATE_PER_KM})
  --hotel-rate N     Hotel $/room/night (default: ${HOTEL_RATE})
  --machine          Include machine/crane rental
  --machine-rate N   Machine rental $/day (default: ${MACHINE_RENTAL_PER_DAY})

Bin:
  --customer NAME    Customer name
  --bushels N        Capacity in thousands of bushels (default: auto)
  --manufacturer S   Brock | Westeel (default: Brock)
  --sidedraw         Sidedraw flag
  --stirator         Stirator flag
  --topdry           TopDry flag
  --daysweep         DaySweep flag
  --hopperbin        HopperBin flag

Other:
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

  const crewSize = args.labourers + args.foremen;
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
    Guys: String(crewSize),
    Sidedraw: args.sidedraw ? "Yes" : "No",
    Stirator: args.stirator ? "Yes" : "No",
    TopDry: args.topDry ? "Yes" : "No",
    DaySweep: args.daySweep ? "Yes" : "No",
    HopperBin: args.hopperBin ? "Yes" : "No",
  };

  const model = loadModel(args.model);
  const predicted = predictBinJobHours(model.beta, inputRec);

  // ── Build days estimate ──
  const buildDays = Math.ceil(predicted / (crewSize * WORK_HOURS_PER_DAY));

  // ── Labor cost (billing to customer) ──
  const laborRevenue = predicted * args.billingRate;

  // ── Internal crew cost ──
  const internalCostPerHour = (args.labourers * LABOURER_WAGE) + (args.foremen * FOREMAN_WAGE);
  const internalLabor = (predicted / crewSize) * internalCostPerHour;

  // ── Hotel ──
  const needsHotel = args.drive > HOTEL_DRIVE_THRESHOLD;
  const hotelRooms = needsHotel ? Math.ceil(crewSize / HOTEL_PPL_PER_ROOM) : 0;
  const hotelNights = needsHotel ? Math.max(0, buildDays - 1) : 0;
  const hotelCost = hotelRooms * hotelNights * args.hotelRate;

  // ── Diesel ──
  const oneWayKm = args.drive * AVG_SPEED_KMH;
  const roundTripKm = oneWayKm * 2;
  const dieselTrips = needsHotel ? 1 : buildDays;
  const totalKm = roundTripKm * dieselTrips;
  const dieselCost = totalKm * args.dieselRate;

  // ── Machine rental ──
  const machineCost = args.machine ? buildDays * args.machineRate : 0;

  // ── Drive time labor (crew gets paid while driving) ──
  const driveTrips = needsHotel ? 2 : buildDays * 2;
  const totalDriveHours = driveTrips * args.drive;
  const driveLaborCost = totalDriveHours * internalCostPerHour;

  // ── Totals ──
  const totalProjectCost = laborRevenue + hotelCost + dieselCost + machineCost;
  const totalInternalCost = internalLabor + driveLaborCost + hotelCost + dieselCost + machineCost;
  const grossMargin = totalProjectCost - totalInternalCost;
  const marginPct = totalProjectCost > 0 ? (grossMargin / totalProjectCost) * 100 : 0;

  // ── Neighbors ──
  const records = loadBinTrainingRecords(args.csv, {
    yearFilter: null, buildNewOnly: true, defaultGuys: 6,
  });
  const scored = records.map(rec => ({
    rec, dist: jobDistance(inputRec, rec), actual: num(rec.Hours, NaN),
  }));
  scored.sort((a, b) => a.dist - b.dist);
  const nearest = scored.slice(0, Math.max(1, args.neighbors));

  const flags = FLAG_NAMES.filter(f => inputRec[f] === "Yes");
  const dateStr = new Date().toLocaleDateString("en-CA");

  // ── Build report ──
  const lines = [];
  const W = 68;
  const hr = "═".repeat(W);
  const rule = "─".repeat(W);

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
  lines.push(`  Labourers:     ${args.labourers}  × $${LABOURER_WAGE}/hr`);
  lines.push(`  Foremen:       ${args.foremen}  × $${FOREMAN_WAGE}/hr`);
  lines.push(`  Total crew:    ${crewSize}`);
  lines.push(`  Billing rate:  ${fmtMoney(args.billingRate)}/hr per person`);
  lines.push(`  Drive (1-way): ${args.drive} hrs  (${oneWayKm.toFixed(0)} km)`);
  lines.push(`  Hotel needed:  ${needsHotel ? "Yes (drive > 1.5 hrs)" : "No"}`);
  lines.push("");

  lines.push("  BUILD ESTIMATE");
  lines.push("  " + rule.slice(2));
  lines.push(`  Predicted man-hours:  ${pad(predicted.toFixed(1), 8)} hrs`);
  lines.push(`  Estimated build days: ${pad(buildDays, 8)} days`);
  lines.push("");

  lines.push("  COST BREAKDOWN — CUSTOMER QUOTE");
  lines.push("  " + rule.slice(2));
  lines.push(`  Labor (${predicted.toFixed(0)} hrs × ${crewSize} crew × $${args.billingRate}/hr):  ${pad(fmtMoney(laborRevenue), 12)}`);
  if (needsHotel) {
    lines.push(`  Hotel (${hotelRooms} rooms × ${hotelNights} nights × $${args.hotelRate}):     ${pad(fmtMoney(hotelCost), 12)}`);
  }
  lines.push(`  Diesel (${totalKm.toFixed(0)} km × $${args.dieselRate}/km):             ${pad(fmtMoney(dieselCost), 12)}`);
  if (args.machine) {
    lines.push(`  Machine rental (${buildDays} days × $${args.machineRate}):          ${pad(fmtMoney(machineCost), 12)}`);
  }
  lines.push("  " + rule.slice(2));
  lines.push(`  TOTAL QUOTE:                               ${pad(fmtMoney(totalProjectCost), 12)}`);
  lines.push("");

  lines.push("  INTERNAL COST / MARGIN");
  lines.push("  " + rule.slice(2));
  lines.push(`  Crew wages (build):  ${pad(fmtMoney(internalLabor), 12)}`);
  lines.push(`  Crew wages (drive):  ${pad(fmtMoney(driveLaborCost), 12)}`);
  if (needsHotel) {
    lines.push(`  Hotel:               ${pad(fmtMoney(hotelCost), 12)}`);
  }
  lines.push(`  Diesel:              ${pad(fmtMoney(dieselCost), 12)}`);
  if (args.machine) {
    lines.push(`  Machine rental:      ${pad(fmtMoney(machineCost), 12)}`);
  }
  lines.push("  " + rule.slice(2));
  lines.push(`  Total internal cost: ${pad(fmtMoney(totalInternalCost), 12)}`);
  lines.push(`  Gross margin:        ${pad(fmtMoney(grossMargin), 12)}  (${marginPct.toFixed(1)}%)`);
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
