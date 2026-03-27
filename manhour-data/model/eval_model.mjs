/**
 * Evaluate ridge bin-hours model: in-sample fit on training CSV + a few synthetic rows.
 *
 *   node model/eval_model.mjs (from manhour-data/)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { rmse } from "./matrix.mjs";
import { loadBinTrainingRecords, predictNewBuildHours, num } from "./features_bin.mjs";
import { loadModel } from "./bin_hours_api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function mae(yTrue, yPred) {
  let s = 0;
  for (let i = 0; i < yTrue.length; i++) s += Math.abs(yTrue[i] - yPred[i]);
  return s / yTrue.length;
}

function meanPctAbsError(yTrue, yPred) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (yTrue[i] <= 0) continue;
    s += Math.abs((yPred[i] - yTrue[i]) / yTrue[i]) * 100;
    n++;
  }
  return n ? s / n : 0;
}

function r2score(yTrue, yPred) {
  const mean = yTrue.reduce((a, b) => a + b, 0) / yTrue.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < yTrue.length; i++) {
    ssRes += (yTrue[i] - yPred[i]) ** 2;
    ssTot += (yTrue[i] - mean) ** 2;
  }
  return ssTot > 0 ? 1 - ssRes / ssTot : 0;
}

const SYNTHETIC = [
  {
    label: "Small Brock hopper",
    rec: {
      Drive_hrs: "1",
      Build: "New",
      BinManufacturer: "Brock",
      Diameter: "18",
      Rings: "7",
      Bushels_k: "4.5",
      Guys: "5",
      Sidedraw: "No",
      Stirator: "No",
      TopDry: "No",
      DaySweep: "No",
      HopperBin: "Yes",
      year: "2025",
    },
  },
  {
    label: "Mid site-built, stir",
    rec: {
      Drive_hrs: "1.5",
      Build: "New",
      BinManufacturer: "Brock",
      Diameter: "36",
      Rings: "17",
      Bushels_k: "55",
      Guys: "6",
      Sidedraw: "No",
      Stirator: "Yes",
      TopDry: "No",
      DaySweep: "No",
      HopperBin: "No",
      year: "2025",
    },
  },
  {
    label: "Large Westeel + sidedraw + day sweep",
    rec: {
      Drive_hrs: "2",
      Build: "New",
      BinManufacturer: "Westeel",
      Diameter: "72",
      Rings: "25",
      Bushels_k: "350",
      Guys: "8",
      Sidedraw: "Yes",
      Stirator: "No",
      TopDry: "No",
      DaySweep: "Yes",
      HopperBin: "No",
      year: "2025",
    },
  },
];

function main() {
  const modelPath = path.join(ROOT, "artifacts", "model.json");
  const csvPath = path.join(ROOT, "bin_hours_parsed.csv");
  const model = loadModel(modelPath);
  const beta = model.beta;
  const records = loadBinTrainingRecords(csvPath, {
    yearFilter: null,
    buildNewOnly: true,
    defaultGuys: 6,
  });

  const yTrue = [];
  const yPred = [];
  const rows = [];
  for (const rec of records) {
    const actual = num(rec.Hours, NaN);
    const pred = predictNewBuildHours(beta, rec);
    yTrue.push(actual);
    yPred.push(pred);
    rows.push({ rec, actual, pred, err: pred - actual });
  }

  rows.sort((a, b) => Math.abs(b.err) - Math.abs(a.err));

  console.log("=== Training data (New-build rows in bin_hours_parsed.csv) ===\n");
  console.log(`Rows: ${records.length}`);
  console.log(`RMSE:  ${rmse(yTrue, yPred).toFixed(2)} h  (matches train in-sample when λ matches training)`);
  console.log(`MAE:   ${mae(yTrue, yPred).toFixed(2)} h`);
  console.log(`Mean |% error|: ${meanPctAbsError(yTrue, yPred).toFixed(1)}%`);
  console.log(`R²:    ${r2score(yTrue, yPred).toFixed(4)}`);
  if (model.looRmseHours != null) {
    console.log(`(model.json LOO RMSE: ${Number(model.looRmseHours).toFixed(1)} h — better generalization estimate)\n`);
  } else {
    console.log("");
  }

  console.log("Largest absolute errors (pred − actual):");
  console.log(
    "  " +
      ["Customer".padEnd(22), "year", "Actual", "Pred", "Err"].join("  ")
  );
  for (const { rec, actual, pred, err } of rows.slice(0, 12)) {
    const name = String(rec.Customer ?? "").slice(0, 22).padEnd(22);
    console.log(
      `  ${name}  ${String(rec.year).padEnd(4)}  ${actual.toFixed(1).padStart(7)}  ${pred.toFixed(1).padStart(7)}  ${err >= 0 ? "+" : ""}${err.toFixed(1)}`
    );
  }

  console.log("\n=== Synthetic scenarios (no ground truth) ===\n");
  for (const { label, rec } of SYNTHETIC) {
    const p = predictNewBuildHours(beta, rec);
    console.log(`${label}`);
    console.log(`  Predicted hours: ${p.toFixed(1)} h`);
  }
}

main();
