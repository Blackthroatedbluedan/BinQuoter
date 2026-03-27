/**
 * Fill blank Job# / Customer on Sheet1 from Joel (preferred) or Bradley for the same calendar day.
 * Only rows whose date falls in building season (Apr 15 – Dec 10) are updated; off-season blanks are skipped.
 * Sheet2 uses formulas over Sheet1 column C + H — fixing Sheet1 updates Sheet2 on recalc in Excel.
 *
 * Usage: node fix-sheet1-blanks.js           # apply fixes + backups
 *        node fix-sheet1-blanks.js --dry-run
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const TS = require('./process-timesheets.js');

const {
  deriveYearFromFilename,
  denseRows,
  forEachSheet1DayRow,
  parseSheet1Daily,
  buildImputeMap,
  findJoelFileForYear,
  findBradFileForYear,
  isInBuildingSeason,
} = TS;

function sheet1Name(wb) {
  return wb.SheetNames.find((n) => /^sheet1$/i.test(n)) || wb.SheetNames[0];
}

function pickRef(dateKey, targetFile, joelF, bradF, joelByDate, bradByDate) {
  const has = (o) =>
    o && (String(o.jobRaw || '').trim() || String(o.customer || '').trim());

  if (targetFile === joelF) {
    const b = bradByDate[dateKey];
    if (has(b)) return { jobRaw: b.jobRaw || '', customer: b.customer || '', from: 'Brad' };
    return null;
  }
  if (targetFile === bradF) {
    const j = joelByDate[dateKey];
    if (has(j)) return { jobRaw: j.jobRaw || '', customer: j.customer || '', from: 'Joel' };
    return null;
  }
  const j = joelByDate[dateKey];
  if (has(j)) return { jobRaw: j.jobRaw || '', customer: j.customer || '', from: 'Joel' };
  const b = bradByDate[dateKey];
  if (has(b)) return { jobRaw: b.jobRaw || '', customer: b.customer || '', from: 'Brad' };
  return null;
}

function setCellString(sheet, r0, c0, value) {
  const addr = XLSX.utils.encode_cell({ r: r0, c: c0 });
  if (value === '' || value == null) {
    delete sheet[addr];
    return;
  }
  sheet[addr] = { t: 's', v: String(value) };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dir = __dirname;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.xlsx') && !f.startsWith('~'));

  const years = [...new Set(files.map((f) => deriveYearFromFilename(f)))].sort((a, b) => a - b);
  const backupDir = path.join(dir, 'backup_before_sheet1_job_fix');
  const logLines = [
    'file,year,excel_row,date,in_building_season,job_before,customer_before,job_after,customer_after,ref_from',
  ];

  if (!dryRun) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  for (const y of years) {
    const joelF = findJoelFileForYear(files, y);
    const bradF = findBradFileForYear(files, y);

    let joelByDate = {};
    let bradByDate = {};

    if (joelF) {
      const wb = XLSX.readFile(path.join(dir, joelF), { cellDates: false });
      const sh = wb.Sheets[sheet1Name(wb)];
      const rows = denseRows(sh);
      const { daily } = parseSheet1Daily(sh, rows, joelF, {
        year: y,
        employeeLabel: 'Joel',
        skipSecondPass: true,
        imputeMapDan: null,
        imputeMapJoel: null,
      });
      joelByDate = buildImputeMap(daily);
    }

    if (bradF) {
      const wb = XLSX.readFile(path.join(dir, bradF), { cellDates: false });
      const sh = wb.Sheets[sheet1Name(wb)];
      const rows = denseRows(sh);
      const { daily } = parseSheet1Daily(sh, rows, bradF, {
        year: y,
        employeeLabel: 'Brad',
        skipSecondPass: true,
        imputeMapDan: null,
        imputeMapJoel: null,
      });
      bradByDate = buildImputeMap(daily);
    }

    if (!joelF && !bradF) {
      console.warn(`Year ${y}: no Joel or Bradley file — skipping Sheet1 fixes for this year.`);
      continue;
    }

    for (const f of files) {
      if (deriveYearFromFilename(f) !== y) continue;

      const fp = path.join(dir, f);
      const wb = XLSX.readFile(fp, { cellDates: false });
      const sname = sheet1Name(wb);
      const sheet = wb.Sheets[sname];
      if (!sheet || !sheet['!ref']) continue;

      const range = XLSX.utils.decode_range(sheet['!ref']);
      const rows = denseRows(sheet);

      let fixCount = 0;

      forEachSheet1DayRow(rows, y, (ctx) => {
        const missing =
          !String(ctx.jobRaw || '').trim() && !String(ctx.customer || '').trim();
        if (!missing) return;

        const work =
          (ctx.hours != null && ctx.hours > 0) || ctx.hasStart;
        if (!work) return;

        if (!isInBuildingSeason(ctx.dateKey)) return;

        const ref = pickRef(ctx.dateKey, f, joelF, bradF, joelByDate, bradByDate);
        if (!ref) return;

        const absR = range.s.r + ctx.ri;
        const jobBefore = ctx.jobRaw;
        const custBefore = ctx.customer;

        logLines.push(
          [
            f,
            y,
            absR + 1,
            ctx.dateKey,
            'yes',
            `"${String(jobBefore).replace(/"/g, '""')}"`,
            `"${String(custBefore).replace(/"/g, '""')}"`,
            `"${String(ref.jobRaw).replace(/"/g, '""')}"`,
            `"${String(ref.customer).replace(/"/g, '""')}"`,
            ref.from,
          ].join(',')
        );

        if (!dryRun) {
          setCellString(sheet, absR, ctx.jobCol, ref.jobRaw);
          setCellString(sheet, absR, ctx.custCol, ref.customer);
        }
        fixCount++;
      });

      if (fixCount > 0 && !dryRun) {
        const bak = path.join(backupDir, f);
        fs.copyFileSync(fp, bak);
        XLSX.writeFile(wb, fp, { bookType: 'xlsx', compression: true });
        console.log(`Updated ${f} (${fixCount} cells)`);
      } else if (fixCount > 0 && dryRun) {
        console.log(`[dry-run] Would update ${f} (${fixCount} rows)`);
      }
    }
  }

  const logPath = path.join(dir, 'output', 'sheet1_job_fill_log.csv');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, logLines.join('\n'), 'utf8');
  console.log(`\nLog: ${logPath}`);
  if (dryRun) console.log('Dry run — no files modified. Run without --dry-run to apply.');
  else console.log(`Backups: ${backupDir}`);
}

main();
