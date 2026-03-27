/**
 * One-shot report: timesheet sheet usage, invoice merge, enrich parse sources,
 * and cross-reference of job hours vs 2025 measured bins (same diameter × rings).
 *
 * Usage: node tools/verify-bin-extraction-report.js
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "output");
const COMBINED = path.join(OUT, "bin_jobs_clean_2023_2024_combined.csv");
const AUDIT = path.join(OUT, "workbook_sheet_audit.csv");
const DATA_2025 = path.join(ROOT, "2025 Man Hour Data - 2025 Bin Hours.csv");

/** Normalize (d,r) so Euclidean distance is not dominated by diameter in ft vs ring count. */
function binDistanceNorm(d1, r1, d2, r2) {
  const dd = (d1 - d2) / 72;
  const dr = (r1 - r2) / 30;
  return Math.sqrt(dd * dd + dr * dr);
}

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

function parseCsv(text) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.split("\n").filter((ln) => ln.length > 0).map(parseCsvLine);
}

function load2025Builds() {
  const raw = fs.readFileSync(DATA_2025, "utf8");
  const lines = raw.split(/\r?\n/);
  const builds = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^,+$/.test(line.replace(/,/g, ""))) continue;
    if (/total bin hours/i.test(line)) break;
    const p = parseCsvLine(line);
    if (p.length < 8) continue;
    const yearCol = p.length >= 15 ? parseInt(String(p[14] ?? "").trim(), 10) : NaN;
    if (Number.isFinite(yearCol) && yearCol !== 2025) continue;
    const hours = parseFloat(p[7]);
    const diameter = parseFloat(p[4]);
    const rings = parseFloat(p[5]);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    if (!Number.isFinite(diameter) || diameter <= 0) continue;
    builds.push({
      customer: String(p[0] || "").trim(),
      hours,
      diameter,
      rings: Number.isFinite(rings) ? rings : 0,
    });
  }
  return builds;
}

/** Median hours per (d,r) for 2025 reference */
function medianByBinKey(builds) {
  const m = new Map();
  for (const b of builds) {
    const k = `${Math.round(b.diameter)}|${Math.round(b.rings)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(b.hours);
  }
  const med = new Map();
  for (const [k, arr] of m) {
    arr.sort((a, b) => a - b);
    med.set(k, arr[Math.floor(arr.length / 2)]);
  }
  return med;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function findInvoicePath() {
  const env = process.env.INVOICES_XLSX;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    path.join(ROOT, "invoices", "Invoices_2023_2024.xlsx"),
    path.join(ROOT, "invoices", "2024 Invoices.xlsx"),
    path.join(ROOT, "..", "2024 Invoices.xlsx"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Pick nearest 2025 build by normalized distance; tie-break by smallest hour delta to job hours. */
function nearest2025Build(d, r, th, builds2025) {
  let best = null;
  let bestDist = Infinity;
  const candidates = [];
  for (const b of builds2025) {
    const dist = binDistanceNorm(d, r, b.diameter, b.rings);
    if (dist < bestDist - 1e-9) {
      bestDist = dist;
      candidates.length = 0;
      candidates.push(b);
    } else if (Math.abs(dist - bestDist) < 1e-9) {
      candidates.push(b);
    }
  }
  if (!candidates.length) return { build: null, distNorm: Infinity };
  if (candidates.length === 1) {
    return { build: candidates[0], distNorm: bestDist };
  }
  candidates.sort((a, b) => Math.abs(a.hours - th) - Math.abs(b.hours - th));
  return { build: candidates[0], distNorm: bestDist };
}

function main() {
  const report = [];
  const iso = new Date().toISOString();

  report.push("=== Bin pipeline verification ===");
  report.push(`Generated: ${iso}`);
  report.push("");

  report.push("1) TIMESHEETS (process-timesheets.js)");
  report.push(
    "   • Sheet1 daily hours: read from the FIRST worksheet in each workbook (wb.SheetNames[0]), not strictly the name 'Sheet1'."
  );
  report.push(
    "   • Sheet2 job rollup: worksheet named Sheet2 (or index [1] fallback in parseSheet2)."
  );
  report.push(
    "   • Extra sheets (e.g. Pete 2023 Sheet3/Sheet4) are ignored by the pipeline — only Sheet1+Sheet2 drive job CSVs."
  );
  if (fs.existsSync(AUDIT)) {
    const lines = fs.readFileSync(AUDIT, "utf8").trim().split(/\r?\n/);
    report.push(`   • Audited workbooks: ${lines.length - 1} files → ${AUDIT}`);
    const noName = lines
      .slice(1)
      .filter((ln) => ln.includes('"no"') && ln.includes("has_sheet1_name"));
    if (noName.length) {
      report.push(
        `   • Files without a tab literally named Sheet1 (first sheet still used): ${noName.length} (see audit CSV column has_sheet1_name).`
      );
    }
  }
  report.push("");

  report.push("2) MERGED CLEAN JOB SHEET (merge-jobs-with-trust.js)");
  report.push(
    "   • Columns: source_year, canonical_job_id, total_hours_sheet1, contributors, trusted — all from Sheet1 rollups per year."
  );
  report.push("");

  report.push("3) INVOICES (attach-invoice-descriptions.js)");
  const invPath = findInvoicePath();
  if (invPath) {
    const wb = XLSX.readFile(invPath, { cellDates: true });
    report.push(`   • File: ${invPath}`);
    report.push(`   • Sheets read (all scanned for Order + Description/Ship-to columns): ${wb.SheetNames.join(" | ")}`);
  } else {
    report.push("   • No invoice workbook found for sheet listing.");
  }
  report.push("");

  report.push("4) BIN SIZE + bin_hours_for_bin_model (enrich-bin-jobs-csv.js + lib/parseBinSizeFromInvoice.js)");
  report.push(
    "   • Hours are NOT parsed from invoice text. total_hours_sheet1 comes from timesheets; description only drives:"
  );
  report.push("     – parsed_diameter_ft / parsed_rings (regex + 4-digit job encoding)");
  report.push("     – bin_exclude_concrete / bin_hours_for_bin_model (0 if 'concrete' in description, else same as Sheet1 hours)");
  report.push("");

  if (!fs.existsSync(COMBINED)) {
    report.push("Missing combined CSV — run merge + attach + enrich first.");
    console.log(report.join("\n"));
    process.exit(1);
  }

  const table = parseCsv(fs.readFileSync(COMBINED, "utf8"));
  const h = table[0].map((x) => String(x).trim());
  const hi = (name) => h.indexOf(name);

  const idx = {
    job: hi("canonical_job_id"),
    hrs: hi("total_hours_sheet1"),
    inv: hi("invoice_description"),
    match: hi("invoice_match"),
    pd: hi("parsed_diameter_ft"),
    pr: hi("parsed_rings"),
    src: hi("bin_size_parse_source"),
    conc: hi("bin_exclude_concrete"),
    bh: hi("bin_hours_for_bin_model"),
    sy: hi("source_year"),
  };

  const rows = [];
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const o = {};
    for (const [k, i] of Object.entries(idx)) {
      o[k] = i >= 0 ? row[i] : "";
    }
    rows.push(o);
  }

  const matchYes = rows.filter((x) => String(x.match).toLowerCase() === "yes");
  const withParse = rows.filter((x) => String(x.pd).trim() && String(x.pr).trim());
  const concreteYes = rows.filter((x) => String(x.conc).toLowerCase() === "yes");
  const matchNoParse = matchYes.filter((x) => !String(x.pd).trim() || !String(x.pr).trim());

  let binHourMismatches = 0;
  for (const x of rows) {
    const th = parseFloat(String(x.hrs).replace(/,/g, ""));
    const bh = parseFloat(String(x.bh).replace(/,/g, ""));
    const isConc = String(x.conc).toLowerCase() === "yes";
    if (isConc) {
      if (Number.isFinite(bh) && bh !== 0) binHourMismatches++;
    } else {
      if (Number.isFinite(th) && Number.isFinite(bh) && Math.abs(th - bh) > 0.02) binHourMismatches++;
    }
  }

  report.push(`   • Combined rows: ${rows.length}`);
  report.push(`   • invoice_match=yes: ${matchYes.length}`);
  report.push(`   • Rows with parsed diameter+rings: ${withParse.length}`);
  report.push(
    `   • invoice_match=yes but no parsed bin size (review job id / description): ${matchNoParse.length}`
  );
  if (matchNoParse.length && matchNoParse.length <= 15) {
    matchNoParse.forEach((x) =>
      report.push(`       – ${x.sy} ${x.job} (${String(x.inv).slice(0, 70)}${String(x.inv).length > 70 ? "…" : ""})`)
    );
  } else if (matchNoParse.length) {
    matchNoParse.slice(0, 8).forEach((x) =>
      report.push(`       – ${x.sy} ${x.job}`)
    );
    report.push(`       … and ${matchNoParse.length - 8} more`);
  }
  report.push(`   • bin_exclude_concrete=yes: ${concreteYes.length}`);
  report.push(
    `   • bin_hours_for_bin_model vs Sheet1 consistency check: ${binHourMismatches === 0 ? "OK (0 mismatches)" : binHourMismatches + " row(s) unexpected"}`
  );
  report.push("");

  const bySource = new Map();
  for (const x of withParse) {
    const s = String(x.src || "unknown");
    bySource.set(s, (bySource.get(s) || 0) + 1);
  }
  report.push("   • bin_size_parse_source counts (rows with both d and r):");
  [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, n]) => report.push(`       ${s}: ${n}`));

  report.push("");

  report.push("5) CROSS-REFERENCE: Sheet1 hours vs 2025 measured hours");
  const builds2025 = load2025Builds();
  const med2025 = medianByBinKey(builds2025);
  report.push(`   • 2025 reference builds (year=2025): ${builds2025.length} rows; unique (d,r) keys: ${med2025.size}`);
  report.push(
    "   • Normalized distance for 'nearest' compares: Δd/72 ft and Δr/30 rings (so rings and diameter contribute similarly)."
  );

  const ratios = [];
  const matched = [];

  for (const x of rows) {
    if (x.job === "__UNALLOCATED__") continue;
    const d = parseFloat(x.pd);
    const r = parseFloat(x.pr);
    if (!Number.isFinite(d) || !Number.isFinite(r)) continue;
    const th = parseFloat(String(x.hrs).replace(/,/g, ""));
    if (!Number.isFinite(th) || th <= 0) continue;
    const k = `${Math.round(d)}|${Math.round(r)}`;
    const ref = med2025.get(k);
    if (ref == null) continue;
    const ratio = th / ref;
    ratios.push(ratio);
    matched.push({
      job: x.job,
      year: x.sy,
      k,
      sheet1_h: th,
      ref2025_h: ref,
      ratio,
      parse_src: x.src,
      inv: String(x.inv).slice(0, 60),
    });
  }

  ratios.sort((a, b) => a - b);
  const pct = (p) =>
    ratios.length
      ? ratios[Math.min(Math.floor((p / 100) * (ratios.length - 1)), ratios.length - 1)]
      : NaN;

  report.push(`   • Exact (d,r) key match to 2025: ${matched.length} jobs`);
  report.push(`   • Parsed jobs with no 2025 row for that (d,r): ${withParse.length - matched.length}`);

  if (ratios.length >= 5) {
    report.push(
      `   • Ratio Sheet1/2025 median (exact key): min ${ratios[0].toFixed(2)}, p25 ${pct(25).toFixed(2)}, median ${pct(50).toFixed(2)}, p75 ${pct(75).toFixed(2)}, max ${ratios[ratios.length - 1].toFixed(2)}`
    );
  } else if (ratios.length) {
    report.push(
      `   • Ratio Sheet1/2025 (exact key, n=${ratios.length} — small sample): ${ratios.map((x) => x.toFixed(2)).join(", ")}`
    );
  }
  report.push(
    "   • Interpretation: ratios ≠ 1 are common (partial timesheet allocation, pads, extensions, different year crew)."
  );

  report.push("");
  report.push("   Exact-key samples — highest Sheet1 / 2025 median:");
  const high = matched.filter((m) => m.ratio > 1.4).sort((a, b) => b.ratio - a.ratio).slice(0, 8);
  if (high.length) {
    high.forEach((m) => {
      report.push(
        `       ${m.year} ${m.job} ${m.k}: ${m.sheet1_h.toFixed(1)} h vs 2025 ${m.ref2025_h.toFixed(1)} h (×${m.ratio.toFixed(2)}) [${m.parse_src}]`
      );
    });
  } else {
    report.push("       (none above 1.4×)");
  }

  report.push("");
  report.push("   Exact-key samples — lowest Sheet1 / 2025 median:");
  const low = matched.filter((m) => m.ratio < 0.6).sort((a, b) => a.ratio - b.ratio).slice(0, 8);
  if (low.length) {
    low.forEach((m) => {
      report.push(
        `       ${m.year} ${m.job} ${m.k}: ${m.sheet1_h.toFixed(1)} h vs 2025 ${m.ref2025_h.toFixed(1)} h (×${m.ratio.toFixed(2)}) [${m.parse_src}]`
      );
    });
  } else {
    report.push("       (none below 0.6×)");
  }

  report.push("");
  report.push(
    "   Nearest 2025 build (normalized distance; ties broken by closest 2025 hours to job Sheet1 total):"
  );

  const nnAll = [];
  for (const x of rows) {
    if (x.job === "__UNALLOCATED__") continue;
    const d = parseFloat(x.pd);
    const r = parseFloat(x.pr);
    if (!Number.isFinite(d) || !Number.isFinite(r)) continue;
    const th = parseFloat(String(x.hrs).replace(/,/g, ""));
    if (!Number.isFinite(th) || th <= 0) continue;
    const { build, distNorm } = nearest2025Build(d, r, th, builds2025);
    if (!build) continue;
    nnAll.push({
      job: x.job,
      year: x.sy,
      th,
      ref: build.hours,
      distNorm,
      near: build,
      ratio: th / build.hours,
      parsed: `${Math.round(d)}×${Math.round(r)}`,
    });
  }

  const THRESH_COMPARABLE = 0.12;
  const comparable = nnAll.filter((n) => n.distNorm <= THRESH_COMPARABLE);
  const ratiosComp = comparable.map((n) => n.ratio).filter((x) => Number.isFinite(x));
  const medR = median(ratiosComp);

  report.push(
    `   • Comparable bin (normalized distance ≤ ${THRESH_COMPARABLE} ≈ same class of build): ${comparable.length} jobs`
  );
  if (ratiosComp.length) {
    report.push(
      `   • Median Sheet1 / nearest-2025 hours for that subset: ${medR != null ? medR.toFixed(2) : "—"} (1.0 = similar scale to closest 2025 row)`
    );
  }

  report.push("   • Closest matches (smallest distNorm), up to 12 lines:");
  [...nnAll].sort((a, b) => a.distNorm - b.distNorm).slice(0, 12).forEach((n) => {
    report.push(
      `       ${n.year} ${n.job} parsed ${n.parsed} → ${n.near.customer} ${n.near.diameter}×${n.near.rings} (${n.ref.toFixed(1)} h) | dist=${n.distNorm.toFixed(3)} ×${n.ratio.toFixed(2)}`
    );
  });

  report.push("");
  report.push("   Comparable-only samples (distNorm ≤ " + THRESH_COMPARABLE + "), sorted by ratio:");
  const compSort = [...comparable].sort((a, b) => a.ratio - b.ratio);
  compSort.slice(0, 6).forEach((n) => {
    report.push(
      `       low ×${n.ratio.toFixed(2)}: ${n.year} ${n.job} ${n.th.toFixed(1)} h vs ${n.near.customer} ${n.near.diameter}×${n.near.rings} (${n.ref.toFixed(1)} h) dist=${n.distNorm.toFixed(3)}`
    );
  });
  compSort
    .slice(-6)
    .reverse()
    .forEach((n) => {
      report.push(
        `       high ×${n.ratio.toFixed(2)}: ${n.year} ${n.job} ${n.th.toFixed(1)} h vs ${n.near.customer} ${n.near.diameter}×${n.near.rings} (${n.ref.toFixed(1)} h) dist=${n.distNorm.toFixed(3)}`
      );
    });

  report.push("");
  report.push("--- QUICK SUMMARY ---");
  report.push(`   invoice_match: ${matchYes.length} | parsed (d,r): ${withParse.length} | matched invoice, no size: ${matchNoParse.length}`);
  report.push(`   concrete flags: ${concreteYes.length} | bin_hours vs Sheet1 check: ${binHourMismatches === 0 ? "pass" : "fail (" + binHourMismatches + ")"}`);
  report.push(
    `   2025 exact-key jobs: ${matched.length} | nearest-neighbor comparable (dist≤${THRESH_COMPARABLE}): ${comparable.length}` +
      (medR != null ? ` | median ratio: ${medR.toFixed(2)}` : "")
  );

  const outPath = path.join(OUT, "bin_extraction_verification_report.txt");
  fs.writeFileSync(outPath, report.join("\n"), "utf8");
  console.log(report.join("\n"));
  console.log(`\nWrote ${outPath}`);
}

main();
