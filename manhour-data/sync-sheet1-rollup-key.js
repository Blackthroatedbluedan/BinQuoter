/**
 * Sheet2 formulas only sum rows where Sheet1 column C (Job#) matches — they ignore column D alone.
 * Node `process-timesheets.js` already rolls up using (Job# OR Customer) in `job_raw` in CSVs.
 *
 * This script copies Customer → Job# when Job# is blank and Customer is present on a work row,
 * after typo cleanup, so Excel Sheet2 includes those hours. Run after partial cross-fill.
 *
 * Usage: node sync-sheet1-rollup-key.js
 *        node sync-sheet1-rollup-key.js --dry-run
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const TS = require('./process-timesheets.js');
const A = require('./lib/aliases.js');

const { deriveYearFromFilename, denseRows, forEachSheet1DayRow } = TS;

function sheet1Name(wb) {
  return wb.SheetNames.find((n) => /^sheet1$/i.test(n)) || wb.SheetNames[0];
}

function setCell(sheet, r0, c0, value) {
  const addr = XLSX.utils.encode_cell({ r: r0, c: c0 });
  if (value == null || String(value) === '') {
    delete sheet[addr];
    return;
  }
  sheet[addr] = { t: 's', v: String(value) };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx') && !f.startsWith('~'));
  const backupDir = path.join(dir, 'backup_before_rollup_key_sync');
  const logPath = path.join(dir, 'output', 'sheet1_rollup_key_sync_log.csv');
  const lines = [
    'file,year,excel_row,date,customer_before,rollup_key_written',
  ];

  if (!dryRun) fs.mkdirSync(backupDir, { recursive: true });

  for (const f of files) {
    const y = deriveYearFromFilename(f);
    const fp = path.join(dir, f);
    const wb = XLSX.readFile(fp, { cellDates: false });
    const sname = sheet1Name(wb);
    const sheet = wb.Sheets[sname];
    if (!sheet || !sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const rows = denseRows(sheet);
    let n = 0;

    forEachSheet1DayRow(rows, y, (ctx) => {
      const hasJ = !!String(ctx.jobRaw || '').trim();
      const hasC = !!String(ctx.customer || '').trim();
      const work = (ctx.hours != null && ctx.hours > 0) || ctx.hasStart;
      if (!work || hasJ || !hasC) return;

      let v = String(ctx.customer).trim();
      v = A.maybeCorrectTypo(v, 'customer').value;
      v = A.maybeCorrectTypo(v, 'job').value;

      const absR = range.s.r + ctx.ri;
      lines.push(
        [
          f,
          y,
          absR + 1,
          ctx.dateKey,
          `"${String(ctx.customer).replace(/"/g, '""')}"`,
          `"${String(v).replace(/"/g, '""')}"`,
        ].join(',')
      );

      if (!dryRun) setCell(sheet, absR, ctx.jobCol, v);
      n++;
    });

    if (n > 0 && !dryRun) {
      fs.copyFileSync(fp, path.join(backupDir, f));
      XLSX.writeFile(wb, fp, { bookType: 'xlsx', compression: true });
      console.log(`${f}: wrote Job# from Customer on ${n} row(s)`);
    } else if (n > 0 && dryRun) {
      console.log(`[dry-run] ${f}: would sync ${n} row(s)`);
    }
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
  console.log(`\nLog: ${logPath}`);
  if (dryRun) console.log('Dry run — no files modified.');
  else console.log(`Backups: ${backupDir}`);
}

main();
