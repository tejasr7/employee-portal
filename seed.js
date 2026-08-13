const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'employees.db');
const seedPath = path.join(__dirname, 'seed-employees.json');

if (!fs.existsSync(seedPath)) {
  console.log('[seed] no seed file, skipping');
  process.exit(0);
}

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
for (const col of ['email','password_hash','status','category','joining_date','notice_period_end','internship_start','internship_end','date_of_resignation','role','totp_secret','totp_enabled']) {
  const exists = db.prepare(`SELECT 1 FROM pragma_table_info('employees') WHERE name=?`).get(col);
  if (!exists) db.exec(`ALTER TABLE employees ADD COLUMN ${col} ${col === 'totp_enabled' ? 'INTEGER' : 'TEXT'}`);
}

const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const dupes = db.prepare(`
  DELETE FROM employees
  WHERE id NOT IN (
    SELECT MIN(id) FROM employees WHERE email IS NOT NULL GROUP BY email
  ) AND email IS NOT NULL
`).run();
if (dupes.changes > 0) console.log(`[seed] deduped ${dupes.changes} duplicate rows`);

const existingEmails = new Set(db.prepare('SELECT email FROM employees WHERE email IS NOT NULL').all().map(r => r.email));
const toInsert = seed.filter(r => !r.email || !existingEmails.has(r.email));

if (toInsert.length === 0) {
  console.log(`[seed] ${existingEmails.size} employees present, nothing to add`);
  process.exit(0);
}

const insert = db.prepare(`
  INSERT INTO employees
    (name, dob, department, email, password_hash, status, category, joining_date, notice_period_end, internship_start, internship_end, date_of_resignation, role)
  VALUES (@name, @dob, @department, @email, @password_hash, @status, @category, @joining_date, @notice_period_end, @internship_start, @internship_end, @date_of_resignation, @role)
`);

const tx = db.transaction((rows) => {
  for (const r of rows) insert.run(r);
});
tx(toInsert);
console.log(`[seed] ${toInsert.length} added, ${existingEmails.size} already present`);