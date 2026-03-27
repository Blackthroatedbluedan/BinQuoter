/**
 * Parse 4-digit bin codes from job text (DDrr = diameter ft × ring count),
 * assume Brock / 6 guys / Drive 1h unless overridden; compare ridge model vs human & old model.
 *
 *   node model/eval_future_jobs.mjs (from manhour-data/)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { predictNewBuildHours, num } from "./features_bin.mjs";
import { loadModel } from "./bin_hours_api.mjs";
import { bushelsCornThousands } from "./bushels_brock.mjs";
import { writeCsv } from "./csv_utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

/** 4-digit codes: 4224 → 42' × 24 rings */
function parseBinCodesFromJob(job) {
  const s = String(job ?? "");
  const matches = s.match(/\b(\d{4})\b/g);
  if (!matches) return [];
  return matches.map((m) => {
    const code = m;
    const d = parseInt(code.slice(0, 2), 10);
    const r = parseInt(code.slice(2, 4), 10);
    return { code, diameter: d, rings: r };
  });
}

function baseRecord(overrides) {
  return {
    Build: "New",
    BinManufacturer: "Brock",
    Guys: "6",
    Drive_hrs: "1",
    Sidedraw: "No",
    Stirator: "No",
    TopDry: "No",
    DaySweep: "No",
    HopperBin: "No",
    year: "2026",
    ...overrides,
  };
}

function recordForBin(bin, flags = {}) {
  const { diameter, rings } = bin;
  const mfr = flags.BinManufacturer ?? "Brock";
  const bushels_k = bushelsCornThousands(diameter, rings, mfr);
  return baseRecord({
    Customer: "synthetic",
    Diameter: String(diameter),
    Rings: String(rings),
    Bushels_k: String(bushels_k),
    BinManufacturer: mfr,
    Hours: "0",
    ...flags,
  });
}

/**
 * Table from user (future / validation jobs). old_model_estim = prior estimator.
 * flags: optional per-row overrides (Hopper, TopDry, …).
 * manufacturer: "Brock" | "Westeel" (default Brock) — affects bushels + Mfg_Westeel feature.
 */
const JOBS = [
  { job: "4224 Grain Bin", customer: "Forty Creek Farms", bins: 1, human: 565, old: 482.5 },
  { job: "3613, 1809, Grain Handling", customer: "Thursthill Farms", bins: 2, human: 430, old: 406.6 },
  { job: "4213 Grain Bin", customer: "Vander Zaag Farms Ltd", bins: 1, human: 346, old: 287 },
  {
    job: "4212 Bin, 3012 Bin, Grain Handling",
    customer: "Lenberg Farms",
    bins: 2,
    human: 600,
    old: 500.6,
  },
  { job: "4224 Bin, Spout and Reclaim Auger", customer: "Masters Farms", bins: 1, human: 550, old: 1146.1 },
  { job: "3611 Grain Bin", customer: "Bradley's", bins: 1, human: 320, old: 232.8 },
  {
    job: "Build 8420 bin Patron Grains",
    customer: "Embro Farm Systems",
    bins: 1,
    human: 1800,
    old: 1138.1,
    manufacturer: "Westeel",
  },
  { job: "5425 Grain Bin", customer: "Henry Voskamp", bins: 1, human: 800, old: 521.8 },
  {
    job: "1818 Hopper And Dry Leg",
    customer: "White Feather Farms",
    bins: 1,
    human: 176,
    old: 225.9,
    /** Hopper in name; "Dry Leg" is not the same as TopDry feature — leave TopDry off unless you label it. */
    flags: { HopperBin: "Yes" },
  },
  { job: "4222 Grain Bin", customer: "Dan Baker", bins: 1, human: 550, old: 363.7 },
  { job: "3012 Grain Bin, Replace 24' Unload", customer: "Don Rickards", bins: 1, human: 280, old: 211.8 },
  { job: "2407 Grain Bin", customer: "Van Darling", bins: 1, human: 150, old: 173.2 },
];

function combinedMultiBinHours(beta, bins, extraFlags = {}) {
  const driveHrs = 1;
  let sum = 0;
  for (const bin of bins) {
    const rec = recordForBin(bin, { ...extraFlags, Drive_hrs: "0" });
    sum += predictNewBuildHours(beta, rec);
  }
  const b0 = beta[0];
  const bDrive = beta[1];
  return sum - (bins.length - 1) * b0 + bDrive * driveHrs;
}

function main() {
  const modelPath = path.join(ROOT, "artifacts", "model.json");
  const model = loadModel(modelPath);
  const beta = model.beta;

  const rows = [];
  console.log("Ridge model coefficient focus (β × feature, New-build):\n");
  console.log(
    "  Strong positive: DaySweep (~+345 h), TopDry (~+135 h), Sidedraw (~+107 h), Stirator (~+32 h),"
  );
  console.log(
    "    HopperBin (~+69 h), log1p(bushels) negative (~−107) offset by diameter/rings geometry."
  );
  console.log(
    "  Drive_hrs ~+8.5 h per hour of drive; Guys ~+20 h per crew member (with interaction term)."
  );
  console.log(
    "  Westeel ~+74 h vs Brock ref. Intercept ~−209 h anchors the linear surface.\n"
  );
  console.log(
    "Defaults: Brock, 6 guys, Drive 1 h, no extras unless job text implies (Hopper/Dry Leg). Per-job manufacturer in JOBS (e.g. Embro 8420 = Westeel).\n"
  );
  console.log(
    "job".padEnd(42) +
      "parsed".padEnd(14) +
      "ridge_h".padStart(9) +
      "human".padStart(8) +
      "old_mdl".padStart(9) +
      "Δ ridge−human".padStart(14)
  );
  console.log("-".repeat(95));

  for (const j of JOBS) {
    const codes = parseBinCodesFromJob(j.job);
    const mfr = j.manufacturer ?? "Brock";
    const flags = { ...(j.flags ?? {}), BinManufacturer: mfr };
    let pred;
    let parsedStr;
    if (codes.length === 0) {
      pred = NaN;
      parsedStr = "(no 4-digit code)";
    } else if (codes.length === 1) {
      const rec = recordForBin(codes[0], { ...flags, Drive_hrs: "1" });
      pred = predictNewBuildHours(beta, rec);
      parsedStr = `${codes[0].diameter}×${codes[0].rings}`;
    } else {
      pred = combinedMultiBinHours(beta, codes, flags);
      parsedStr = codes.map((c) => `${c.diameter}×${c.rings}`).join("+");
    }

    const human = j.human;
    const old = j.old;
    const delta = pred - human;
    const line =
      j.job.slice(0, 40).padEnd(42) +
      parsedStr.slice(0, 12).padEnd(14) +
      (Number.isFinite(pred) ? pred.toFixed(0) : "—").padStart(9) +
      String(human).padStart(8) +
      old.toFixed(1).padStart(9) +
      (Number.isFinite(pred) ? (delta >= 0 ? "+" : "") + delta.toFixed(0) : "—").padStart(14);
    console.log(line);

    rows.push({
      job: j.job,
      customer: j.customer,
      bins_per_job: j.bins,
      parsed_bins: parsedStr,
      drive_hrs_assumed: 1,
      guys_assumed: 6,
      manufacturer: mfr,
      ridge_predicted_h: Number.isFinite(pred) ? pred.toFixed(2) : "",
      human_time: human,
      old_model_estim: old,
      error_ridge_minus_human: Number.isFinite(pred) ? (pred - human).toFixed(1) : "",
    });
  }

  const outPath = path.join(ROOT, "artifacts", "future_bins_model_comparison.csv");
  const headers = [
    "job",
    "customer",
    "bins_per_job",
    "parsed_bins",
    "drive_hrs_assumed",
    "guys_assumed",
    "manufacturer",
    "ridge_predicted_h",
    "human_time",
    "old_model_estim",
    "error_ridge_minus_human",
  ];
  writeCsv(outPath, headers, rows.map((r) => Object.fromEntries(headers.map((h) => [h, r[h] ?? ""]))));
  console.log(`\nWrote ${outPath}`);
}

main();
