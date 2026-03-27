const fs = require('fs');
const p = require('path');
const csv = fs.readFileSync(p.join(__dirname, '..', 'output', 'partial_crossfill_unresolved.csv'), 'utf8');
const lines = csv.trim().split(/\r?\n/);
const counts = {};
for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  const li = line.lastIndexOf(',');
  const reason = li >= 0 ? line.slice(li + 1) : line;
  counts[reason] = (counts[reason] || 0) + 1;
}
console.log(JSON.stringify(counts, null, 2));
console.log('total', lines.length - 1);
