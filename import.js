const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');

const CSV_PATH = '/Users/sonalnaidu/Downloads/Employee Date of Birth List_June 2026 1.csv';
const DEFAULT_PASSWORD = 'Welcome@123';

const DEPT_MAP = {
  'ACCOUNTS': 'Accounts & Finance',
  'HR': 'Human Resources',
  'HUMAN RESOURCES': 'Human Resources',
  'TECH SUPPORT': 'Tech Support',
  'TECH': 'Tech Support',
  'SALES': 'Sales',
  'MARKETING': 'Marketing',
  'ENGINEERING': 'Engineering',
  'OPERATIONS': 'Operations',
  'OTHER': 'Other',
};

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function parseDate(s) {
  if (!s) return null;
  const trimmed = String(s).trim();
  if (!trimmed) return null;
  const parts = trimmed.split('-');
  if (parts.length !== 3) return null;
  const [day, mon, year] = parts.map(p => p.trim());
  if (!MONTHS[mon] || !day || !year || year.length !== 4) return null;
  return `${year}-${MONTHS[mon]}-${day.padStart(2, '0')}`;
}

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

function normalizeDept(s) {
  if (!s) return null;
  const key = String(s).trim().toUpperCase().replace(/\s+/g, ' ');
  return DEPT_MAP[key] || null;
}

function isRowEmpty(fields) {
  return fields.every(f => !f || !String(f).trim());
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

  if (isRowEmpty(fields)) continue;

  if (i === 0 && fields[0] && fields[0].toLowerCase().includes('employe')) continue;

  const empId = fields[0];
  const email = fields[1];
  const dobRaw = fields[2];
  const name = fields[3];
  const deptRaw = fields[4];

  const dob = parseDate(dobRaw);
  const department = normalizeDept(deptRaw);

  if (!name) { skipped++; errors.push(`Row ${i + 1}: missing name`); continue; }
  if (!email || !email.includes('@')) { skipped++; errors.push(`Row ${i + 1} (${name}): missing/invalid email`); continue; }
  if (!dob) { skipped++; errors.push(`Row ${i + 1} (${name}): missing/invalid DOB "${dobRaw}"`); continue; }
  if (!department) { skipped++; errors.push(`Row ${i + 1} (${name}): unknown department "${deptRaw}"`); continue; }

  if (db.getEmployeeByEmail(email)) {
    skipped++;
    errors.push(`Row ${i + 1} (${name}): email already exists`);
    continue;
  }

  db.createEmployee({
    name,
    dob,
    department,
    email,
    passwordHash: auth.hashPassword(DEFAULT_PASSWORD),
  });
  imported++;
  console.log(`  + [${empId || '----'}] ${name} <${email}> ${dob} ${department}`);
}

console.log(`\nDone. Imported: ${imported}, Skipped: ${skipped}`);
if (errors.length) {
  console.log('\nSkipped rows:');
  errors.forEach(e => console.log('  -', e));
}
console.log(`\nDefault password for all imported employees: ${DEFAULT_PASSWORD}`);