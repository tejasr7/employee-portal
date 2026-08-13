const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

const dbPath = process.env.DB_PATH || path.join(__dirname, 'employees.db');
const csvPath = process.env.ATTENDANCE_CSV || path.join(__dirname, 'attendance-aug-2026.csv');

if (!fs.existsSync(csvPath)) {
  console.log(`[attendance] no CSV at ${csvPath}, skipping`);
  process.exit(0);
}

const filenameMatch = csvPath.match(/(\d{4})-(\d{2})/);
const fallbackMatch = csvPath.match(/([A-Za-z]{3})-(\d{4})/);
let year, month;
if (filenameMatch) {
  year = filenameMatch[1];
  month = filenameMatch[2];
} else if (fallbackMatch) {
  year = fallbackMatch[2];
  month = MONTHS[fallbackMatch[1][0].toUpperCase() + fallbackMatch[1].slice(1).toLowerCase()];
} else {
  console.error('[attendance] cannot detect year/month from filename', csvPath);
  process.exit(1);
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (const c of line) {
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

const raw = fs.readFileSync(csvPath, 'utf8');
const lines = raw.split(/\r?\n/);

const header = parseCsvLine(lines[0]);
const dayCols = [];
header.forEach((h, idx) => {
  const m = String(h).match(/^(\d{2})-([A-Za-z]{3})$/);
  if (m) dayCols.push({ idx, day: m[1], monShort: m[2] });
});

const STATUS = header.indexOf('Status');
const CATEGORY = header.indexOf('Category');
const OP = header.indexOf('Op. leave bal.');
const ADDITIONS = header.indexOf('Additions');
const DEDUCTIONS = header.indexOf('Deductions');
const BALANCE = header.indexOf('Balance');
const EXCEPTION = header.indexOf('Exception');
const LOP = header.indexOf('LOP');

const VALID = new Set(['P', 'A', 'H', 'WFH', 'PH', 'AH']);

function parseNum(s) {
  if (s == null) return 0;
  const t = String(s).trim().replace(/[()]/g, '');
  if (!t || t === '-' || t.toLowerCase() === 'na') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    notes TEXT,
    marked_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(employee_id, date),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS leave_balances (
    employee_id INTEGER PRIMARY KEY,
    opening_balance REAL NOT NULL DEFAULT 0,
    additions REAL NOT NULL DEFAULT 0,
    deductions REAL NOT NULL DEFAULT 0,
    balance REAL NOT NULL DEFAULT 0,
    lop REAL NOT NULL DEFAULT 0,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const findEmployee = db.prepare('SELECT id FROM employees WHERE email = ?');
const getAttendance = db.prepare('SELECT id FROM attendance_records WHERE employee_id = ? AND date = ?');
const insertAttendance = db.prepare(`INSERT INTO attendance_records (employee_id, date, status, marked_by) VALUES (?, ?, ?, ?)`);
const updateAttendance = db.prepare(`UPDATE attendance_records SET status = ?, marked_by = ?, updated_at = datetime('now') WHERE employee_id = ? AND date = ?`);
const upsertLeave = db.prepare(`INSERT INTO leave_balances (employee_id, opening_balance, additions, deductions, balance, lop, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(employee_id) DO UPDATE SET opening_balance=excluded.opening_balance, additions=excluded.additions, deductions=excluded.deductions, balance=excluded.balance, lop=excluded.lop, notes=excluded.notes, updated_at=datetime('now')`);
const updateStatus = db.prepare(`UPDATE employees SET status = COALESCE(NULLIF(?, ''), status), category = COALESCE(NULLIF(?, ''), category) WHERE id = ?`);

let attendanceImported = 0, attendanceSkipped = 0, balanceImported = 0, employeesNotFound = 0;

const tx = db.transaction(() => {
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const f = parseCsvLine(line);
    const email = f[1];
    if (!email || !email.includes('@')) continue;

    const employee = findEmployee.get(email);
    if (!employee) {
      employeesNotFound++;
      console.log(`  ! ${email} not found in employees`);
      continue;
    }

    for (const dc of dayCols) {
      const cell = f[dc.idx];
      if (!cell || !cell.trim()) continue;
      const status = cell.trim().toUpperCase();
      if (!VALID.has(status)) continue;
      const date = `${year}-${MONTHS[dc.monShort]}-${dc.day}`;
      const existing = getAttendance.get(employee.id, date);
      if (existing) {
        updateAttendance.run(status, null, employee.id, date);
      } else {
        insertAttendance.run(employee.id, date, status, null);
      }
      attendanceImported++;
    }

    const opening = OP >= 0 ? parseNum(f[OP]) : 0;
    const additions = ADDITIONS >= 0 ? parseNum(f[ADDITIONS]) : 0;
    const deductions = DEDUCTIONS >= 0 ? parseNum(f[DEDUCTIONS]) : 0;
    const balance = BALANCE >= 0 ? parseNum(f[BALANCE]) : 0;
    const lop = LOP >= 0 ? parseNum(f[LOP]) : 0;
    const notes = EXCEPTION >= 0 && f[EXCEPTION] && f[EXCEPTION] !== '-' ? f[EXCEPTION] : null;

    if (opening || additions || deductions || balance || lop || notes) {
      upsertLeave.run(employee.id, opening, additions, deductions, balance, lop, notes);
      balanceImported++;
    }

    if (STATUS >= 0 || CATEGORY >= 0) {
      const status = STATUS >= 0 ? f[STATUS] : '';
      const category = CATEGORY >= 0 ? f[CATEGORY] : '';
      if (status || category) updateStatus.run(status, category, employee.id);
    }
  }
});
tx();

console.log(`[attendance] ${attendanceImported} attendance rows upserted, ${balanceImported} leave balances, ${employeesNotFound} unknown emails skipped`);