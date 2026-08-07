const fs = require('fs');
const db = require('./db');

const CSV_PATH = '/Users/sonalnaidu/Downloads/Attendance Day pass tracker_July - 2026.csv';

const STATUS = 41, CATEGORY = 42, OP = 43, ADDITIONS = 44, DEDUCTIONS = 45, BALANCE = 46, EXCEPTION = 47, LOP = 48;
const EXPECTED_COLS = 49;

function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result.map(s => s.trim());
}

function parseNum(s) {
  if (s == null) return 0;
  const t = String(s).trim().replace(/[()]/g, '');
  if (!t || t === '-' || t.toLowerCase() === 'na') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function isProbation(opValue) {
  return String(opValue).trim().toLowerCase() === 'new joinee';
}

function isDataRow(fields) {
  const email = fields[1];
  if (!email || !email.includes('@')) return false;
  if (fields.slice(0, 4).every(f => !f || !f.trim())) return false;
  return true;
}

const raw = fs.readFileSync(CSV_PATH, 'utf8');
const lines = raw.split(/\r?\n/);

let imported = 0;
let skipped = 0;
const errors = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const fields = parseCsvLine(line);

  if (i === 0 && fields[0] && fields[0].toLowerCase().includes('employe')) continue;
  if (!isDataRow(fields)) continue;

  const padded = fields.slice(0, EXPECTED_COLS);
  while (padded.length < EXPECTED_COLS) padded.push('');

  const email = padded[1];
  const name = padded[3];

  const summary = {
    status: padded[STATUS],
    category: padded[CATEGORY],
    op: padded[OP],
    additions: padded[ADDITIONS],
    deductions: padded[DEDUCTIONS],
    balance: padded[BALANCE],
    exception: padded[EXCEPTION],
    lop: padded[LOP],
  };

  const employee = db.getEmployeeByEmail(email);
  if (!employee) {
    skipped++;
    errors.push(`Row ${i + 1} (${name}): employee not found in DB`);
    continue;
  }

  const probation = isProbation(summary.op);
  const opening = probation ? 0 : parseNum(summary.op);
  const additions = parseNum(summary.additions);
  const deductions = parseNum(summary.deductions);
  const balance = probation ? additions : parseNum(summary.balance);
  const lop = parseNum(summary.lop);

  const targetStatus = probation && employee.category === 'Employee' ? 'Probation' : (summary.status || 'Active');
  db.updateEmployeeStatus(employee.id, {
    status: targetStatus,
    category: summary.category || 'Employee',
  });

  db.upsertLeaveBalance(employee.id, {
    opening_balance: opening,
    additions,
    deductions,
    balance,
    lop,
    notes: summary.exception && summary.exception !== '-' ? summary.exception : null,
  });

  imported++;
  const flag = probation ? ' [PROBATION]' : '';
  console.log(`  + ${name.padEnd(24)} op=${opening} add=${additions} ded=${deductions} bal=${balance} LOP=${lop}${flag}`);
}

console.log(`\nDone. Imported: ${imported}, Skipped: ${skipped}`);
if (errors.length) {
  console.log('\nSkipped:');
  errors.forEach(e => console.log('  -', e));
}