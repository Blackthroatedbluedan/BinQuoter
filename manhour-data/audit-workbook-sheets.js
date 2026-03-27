/**
 * List every .xlsx in the workspace and report Sheet1/Sheet2 presence.
 * Sheet2 rollup is formula-driven from Sheet1; workbooks without Sheet2 are noted in process output.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx') && !f.startsWith('~')).sort();

const rows = [['file', 'sheet_count', 'sheet_names', 'has_sheet1_name', 'has_sheet2_name']];

for (const f of files) {
  const fp = path.join(dir, f);
  const wb = XLSX.readFile(fp, { cellDates: false });
  const names = wb.SheetNames || [];
  const has1 = names.some((n) => /^sheet1$/i.test(n));
  const has2 = names.some((n) => /^sheet2$/i.test(n));
  rows.push([
    f,
    String(names.length),
    names.join(' | '),
    has1 ? 'yes' : 'no',
    has2 ? 'yes' : 'no',
  ]);
}

const outDir = path.join(dir, 'output');
fs.mkdirSync(outDir, { recursive: true });
const p = path.join(outDir, 'workbook_sheet_audit.csv');
const lines = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
fs.writeFileSync(p, lines.join('\n'), 'utf8');

const noSheet2 = rows.slice(1).filter((r) => r[4] === 'no').map((r) => r[0]);
console.log(JSON.stringify({ files: files.length, workbookSheetAuditCsv: p, noSheet2 }, null, 2));
