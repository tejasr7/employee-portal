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
const insert = db.prepare(`
  INSERT OR IGNORE INTO employees
    (name, dob, department, email, password_hash, status, category, joining_date, notice_period_end, internship_start, internship_end, date_of_resignation, role)
  VALUES (@name, @dob, @department, @email, @password_hash, @status, @category, @joining_date, @notice_period_end, @internship_start, @internship_end, @date_of_resignation, @role)
`);

const tx = db.transaction((rows) => {
  let added = 0;
  for (const r of rows) {
    const info = insert.run(r);
    if (info.changes > 0) added++;
  }
  return added;
});
const added = tx(seed);
console.log(`[seed] ${added} added, ${seed.length - added} already present`);