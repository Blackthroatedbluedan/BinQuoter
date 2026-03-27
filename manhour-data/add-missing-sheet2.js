/**
 * Add a Sheet2 job rollup (formulas referencing Sheet1) to single-sheet 2023 workbooks.
 * Uses the same SUMPRODUCT+time pattern as Dan M Time Sheet 2024.xlsx Column C.
 * Targets: Bradley, Elijah, Troy 2023 (must have a tab named Sheet1).
 *
 * Usage: node add-missing-sheet2.js
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const TS = require('./process-timesheets.js');

const TARGETS = new Set([
  'Bradley Time Sheet 2023.xlsx',
  'Elijah Time Sheet 2023.xlsx',
  'Troy Time Sheet 2023.xlsx',
]);

function sheet1Name(wb) {
  return wb.SheetNames.find((n) => /^sheet1$/i.test(n)) || wb.SheetNames[0];
}

function sortJobsLikeExcel(keys) {
  return [...keys].sort((a, b) => {
    const sa = String(a).trim();
    const sb = String(b).trim();
    const na = parseFloat(sa);
    const nb = parseFloat(sb);
    const aNum = !Number.isNaN(na) && String(na) === sa;
    const bNum = !Number.isNaN(nb) && String(nb) === sb;
    if (aNum && bNum) return na - nb;
    if (aNum !== bNum) return aNum ? -1 : 1;
    return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function buildJobHours(rows, year) {
  const hoursByJob = {};
  TS.forEachSheet1DayRow(rows, year, (ctx) => {
    const key = String(ctx.jobRaw || '').trim() || String(ctx.customer || '').trim();
    if (!key) return;
    const h = ctx.hours != null ? ctx.hours : 0;
    hoursByJob[key] = (hoursByJob[key] || 0) + h;
  });
  const keys = sortJobsLikeExcel(Object.keys(hoursByJob));
  return { keys, hoursByJob };
}

function hoursFormula(excelRow) {
  return `SUMPRODUCT((Sheet1!C:C=A${excelRow})*(IF(ISNUMBER(Sheet1!H:H),HOUR(Sheet1!H:H)+MINUTE(Sheet1!H:H)/60,0)))`;
}

function cellJob(jobStr) {
  const s = String(jobStr).trim();
  const n = parseFloat(s);
  if (!Number.isNaN(n) && String(n) === s) return { t: 'n', v: n };
  return { t: 's', v: s };
}

function main() {
  const dir = __dirname;
  const backupDir = path.join(dir, 'backup_before_add_sheet2');
  fs.mkdirSync(backupDir, { recursive: true });

  for (const fname of TARGETS) {
    const fp = path.join(dir, fname);
    if (!fs.existsSync(fp)) {
      console.warn(`Skip (file missing): ${fname}`);
      continue;
    }
    const wb = XLSX.readFile(fp, { cellDates: false });
    if (wb.SheetNames.some((n) => /^sheet2$/i.test(n))) {
      console.log(`Skip (already has Sheet2): ${fname}`);
      continue;
    }
    const s1 = sheet1Name(wb);
    if (!/^sheet1$/i.test(s1)) {
      console.warn(`Skip (first sheet is not named Sheet1 — fix name first): ${fname} → ${s1}`);
      continue;
    }

    const year = TS.deriveYearFromFilename(fname);
    const rows = TS.denseRows(wb.Sheets[s1]);
    const { keys, hoursByJob } = buildJobHours(rows, year);

    const sheet = {};
    sheet.A1 = { t: 's', v: 'Job number' };
    sheet.B1 = { t: 's', v: 'Job' };
    sheet.C1 = { t: 's', v: 'Hours' };

    let maxR = 0;
    keys.forEach((job, idx) => {
      const excelRow = 2 + idx;
      const r = excelRow - 1;
      const addrA = XLSX.utils.encode_cell({ r, c: 0 });
      const addrC = XLSX.utils.encode_cell({ r, c: 2 });
      const h = hoursByJob[job] || 0;
      const rounded = Math.round(h * 10000) / 10000;
      sheet[addrA] = cellJob(job);
      sheet[addrC] = { f: hoursFormula(excelRow), t: 'n', v: rounded };
      maxR = r;
    });

    if (keys.length === 0) {
      sheet.A2 = {
        t: 's',
        v: 'No Job# values found on Sheet1 — add hours with Job# then refresh formulas.',
      };
      maxR = 1;
    }

    sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(maxR, 1), c: 2 } });

    wb.SheetNames.push('Sheet2');
    wb.Sheets.Sheet2 = sheet;

    fs.copyFileSync(fp, path.join(backupDir, fname));
    XLSX.writeFile(wb, fp, { bookType: 'xlsx', compression: true });
    console.log(`Added Sheet2 → ${fname} (${keys.length} job row(s))`);
  }
}

main();
