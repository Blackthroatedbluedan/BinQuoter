/**
 * Company-app entry: load trained coefficients and predict total job hours for a New build.
 * Specialty add-ons (Sidedraw, Stirator, TopDry, DaySweep, HopperBin) must be passed explicitly.
 */
import fs from "fs";
import { predictNewBuildHours } from "./features_bin.mjs";

export function loadModel(modelJsonPath) {
  const raw = fs.readFileSync(modelJsonPath, "utf8");
  const model = JSON.parse(raw);
  if (
    (model.version !== 2 && model.version !== 3) ||
    model.scope !== "New_build_only"
  ) {
    console.warn(
      "bin_hours_api: model.json may be outdated; run: npm run train"
    );
  }
  if (!Array.isArray(model.beta)) throw new Error("model.json missing beta");
  return model;
}

/**
 * @param {number[]} beta — from model.json
 * @param {object} job — Drive_hrs, Diameter, Rings, Bushels_k, Guys, BinManufacturer,
 *   Sidedraw, Stirator, TopDry, DaySweep, HopperBin (Yes/No or truthy/falsy)
 */
export function predictBinJobHours(beta, job) {
  return predictNewBuildHours(beta, job);
}
