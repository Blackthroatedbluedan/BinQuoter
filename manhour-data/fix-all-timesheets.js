/**
 * Run all Sheet1 repair passes on every .xlsx in this folder, then refresh CSV outputs.
 * Order: Sheet2 stub → Joel/Brad fill → partial cross-fill → sync Job# from Customer (for Sheet2)
 *        → process-timesheets → audit/counts.
 * For merged master CSV + remainder browse report, run: npm run assemble
 */
const { execSync } = require('child_process');
const path = require('path');

const dir = __dirname;
const run = (cmd) => {
  console.log(`\n--- ${cmd} ---\n`);
  execSync(cmd, { cwd: dir, stdio: 'inherit', shell: true });
};

run('node add-missing-sheet2.js');
run('node fix-sheet1-blanks.js');
run('node fix-sheet1-partial-crossfill.js');
run('node sync-sheet1-rollup-key.js');
run('node process-timesheets.js');
run('node audit-workbook-sheets.js');
run('node count-blanks.js');
