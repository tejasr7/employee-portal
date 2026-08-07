const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'employees.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    dob TEXT NOT NULL,
    department TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

if (!columnExists('employees', 'email')) {
  db.exec('ALTER TABLE employees ADD COLUMN email TEXT');
}
if (!columnExists('employees', 'password_hash')) {
  db.exec('ALTER TABLE employees ADD COLUMN password_hash TEXT');
}
if (!columnExists('employees', 'status')) {
  db.exec("ALTER TABLE employees ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'");
}
if (!columnExists('employees', 'category')) {
  db.exec("ALTER TABLE employees ADD COLUMN category TEXT NOT NULL DEFAULT 'Employee'");
}
if (!columnExists('employees', 'joining_date')) {
  db.exec('ALTER TABLE employees ADD COLUMN joining_date TEXT');
}
if (!columnExists('employees', 'notice_period_end')) {
  db.exec('ALTER TABLE employees ADD COLUMN notice_period_end TEXT');
}
if (!columnExists('employees', 'internship_start')) {
  db.exec('ALTER TABLE employees ADD COLUMN internship_start TEXT');
}
if (!columnExists('employees', 'internship_end')) {
  db.exec('ALTER TABLE employees ADD COLUMN internship_end TEXT');
}
if (!columnExists('employees', 'date_of_resignation')) {
  db.exec('ALTER TABLE employees ADD COLUMN date_of_resignation TEXT');
}
if (!columnExists('employees', 'role')) {
  db.exec("ALTER TABLE employees ADD COLUMN role TEXT NOT NULL DEFAULT 'employee'");
}

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

db.exec(`CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance_records(employee_id, date)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS leave_balances (
    employee_id INTEGER PRIMARY KEY,
    opening_balance REAL NOT NULL DEFAULT 0,
    additions REAL NOT NULL DEFAULT 0,
    deductions REAL NOT NULL DEFAULT 0,
    balance REAL NOT NULL DEFAULT 0,
    lop REAL NOT NULL DEFAULT 0,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
  )
`);

db.prepare(
  "UPDATE employees SET department = 'Accounts & Finance' WHERE department = 'Finance'"
).run();

function getAllEmployees() {
  return db.prepare('SELECT * FROM employees ORDER BY name ASC').all();
}

function getEmployeeById(id) {
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
}

function getEmployeeByEmail(email) {
  if (!email?.trim()) return null;
  return db
    .prepare('SELECT * FROM employees WHERE lower(email) = lower(?)')
    .get(email.trim());
}

function createEmployee({ name, dob, department, email, passwordHash }) {
  const stmt = db.prepare(
    `INSERT INTO employees (name, dob, department, email, password_hash)
     VALUES (?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    name.trim(),
    dob,
    department.trim(),
    email.trim().toLowerCase(),
    passwordHash
  );
  return result.lastInsertRowid;
}

function updateEmployee(id, { name, dob, department }) {
  const stmt = db.prepare(
    'UPDATE employees SET name = ?, dob = ?, department = ? WHERE id = ?'
  );
  return stmt.run(name.trim(), dob, department.trim(), id);
}

function updateEmployeeStatus(id, { status, category, joining_date, notice_period_end, internship_start, internship_end, date_of_resignation, role }) {
  return db
    .prepare(
      `UPDATE employees
       SET status = COALESCE(?, status),
           category = COALESCE(?, category),
           joining_date = ?,
           notice_period_end = ?,
           internship_start = ?,
           internship_end = ?,
           date_of_resignation = ?,
           role = COALESCE(?, role)
       WHERE id = ?`
    )
    .run(
      status ?? null,
      category ?? null,
      joining_date || null,
      notice_period_end || null,
      internship_start || null,
      internship_end || null,
      date_of_resignation || null,
      role ?? null,
      id
    );
}

function deleteEmployee(id) {
  return db.prepare('DELETE FROM employees WHERE id = ?').run(id);
}

function getBirthdaysThisMonth(month) {
  const monthStr = String(month).padStart(2, '0');
  return db
    .prepare(
      `SELECT * FROM employees
       WHERE substr(dob, 6, 2) = ?
       ORDER BY substr(dob, 9, 2) ASC, name ASC`
    )
    .all(monthStr);
}

function getLeaveBalance(employeeId) {
  return db
    .prepare('SELECT * FROM leave_balances WHERE employee_id = ?')
    .get(employeeId);
}

function getAllLeaveBalances() {
  return db.prepare('SELECT * FROM leave_balances').all();
}

const ATTENDANCE_STATUSES = ['P', 'A', 'H', 'WFH', 'PH', 'AH'];

function isValidAttendanceStatus(s) {
  return ATTENDANCE_STATUSES.includes(s);
}

function getAttendance(employeeId, date) {
  return db
    .prepare('SELECT * FROM attendance_records WHERE employee_id = ? AND date = ?')
    .get(employeeId, date);
}

function getAttendanceForMonth(employeeId, yearMonth) {
  return db
    .prepare(
      `SELECT * FROM attendance_records
       WHERE employee_id = ? AND substr(date, 1, 7) = ?
       ORDER BY date ASC`
    )
    .all(employeeId, yearMonth);
}

function getAttendanceForEmployee(employeeId, limit = 100) {
  return db
    .prepare(
      `SELECT * FROM attendance_records
       WHERE employee_id = ?
       ORDER BY date DESC
       LIMIT ?`
    )
    .all(employeeId, limit);
}

function upsertAttendance({ employee_id, date, status, notes = null, marked_by = null }) {
  const existing = getAttendance(employee_id, date);
  if (existing) {
    return db
      .prepare(
        `UPDATE attendance_records
         SET status = ?, notes = ?, marked_by = ?, updated_at = datetime('now')
         WHERE employee_id = ? AND date = ?`
      )
      .run(status, notes, marked_by, employee_id, date);
  }
  return db
    .prepare(
      `INSERT INTO attendance_records (employee_id, date, status, notes, marked_by)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(employee_id, date, status, notes, marked_by);
}

function deleteAttendance(employeeId, date) {
  return db
    .prepare('DELETE FROM attendance_records WHERE employee_id = ? AND date = ?')
    .run(employeeId, date);
}

function upsertLeaveBalance(employeeId, { opening_balance = 0, additions = 0, deductions = 0, balance = 0, lop = 0, notes = null }) {
  const existing = getLeaveBalance(employeeId);
  if (existing) {
    return db
      .prepare(
        `UPDATE leave_balances
         SET opening_balance = ?, additions = ?, deductions = ?, balance = ?, lop = ?, notes = ?, updated_at = datetime('now')
         WHERE employee_id = ?`
      )
      .run(opening_balance, additions, deductions, balance, lop, notes, employeeId);
  }
  return db
    .prepare(
      `INSERT INTO leave_balances (employee_id, opening_balance, additions, deductions, balance, lop, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(employeeId, opening_balance, additions, deductions, balance, lop, notes);
}

module.exports = {
  getAllEmployees,
  getEmployeeById,
  getEmployeeByEmail,
  createEmployee,
  updateEmployee,
  updateEmployeeStatus,
  deleteEmployee,
  getBirthdaysThisMonth,
  getLeaveBalance,
  getAllLeaveBalances,
  upsertLeaveBalance,
  getAttendance,
  getAttendanceForMonth,
  getAttendanceForEmployee,
  upsertAttendance,
  deleteAttendance,
  isValidAttendanceStatus,
  ATTENDANCE_STATUSES,
};