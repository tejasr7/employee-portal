require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');
const auth = require('./auth');
const { DEPARTMENTS } = require('./constants');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'employee-portal-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  })
);

app.use((req, res, next) => {
  res.locals.isAdmin = !!req.session.isAdmin;
  res.locals.isEmployee = !!req.session.employeeId;
  res.locals.isAccounts = !!req.session.accountsId;
  res.locals.currentPath = req.path;
  res.locals.departments = DEPARTMENTS;
  res.locals.attendanceStatuses = db.ATTENDANCE_STATUSES;
  next();
});

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.redirect('/admin/login');
  }
  next();
}

function requireEmployee(req, res, next) {
  if (!req.session.employeeId) {
    return res.redirect('/login');
  }
  next();
}

function requireAccounts(req, res, next) {
  if (!req.session.accountsId) {
    return res.redirect('/accounts/login');
  }
  next();
}

function isValidDepartment(department) {
  return DEPARTMENTS.includes(department?.trim());
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDob(dob) {
  const [year, month, day] = dob.split('-');
  const monthName = MONTH_NAMES[parseInt(month, 10) - 1];
  return `${monthName} ${parseInt(day, 10)}, ${year}`;
}

function formatBirthday(dob) {
  const [, month, day] = dob.split('-');
  const monthName = MONTH_NAMES[parseInt(month, 10) - 1];
  return `${monthName} ${parseInt(day, 10)}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${parseInt(day, 10)} ${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function probationEndDate(joiningDate) {
  if (!joiningDate) return null;
  const [y, m, d] = joiningDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + 3);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function leaveSummary(employee, balance) {
  const status = employee.status || 'Active';
  const category = employee.category || 'Employee';
  const isEmployee = category === 'Employee';
  const today = todayISO();
  const probEnd = probationEndDate(employee.joining_date);
  const inProbation = isEmployee && status === 'Probation';
  const postProbation = isEmployee && probEnd && probEnd <= today && status !== 'Probation';
  const isNoticePeriod = status === 'Notice Period';
  const postNotice = isNoticePeriod && employee.notice_period_end && employee.notice_period_end <= today;
  const isResigned = status === 'Resigned';

  const safeBalance = balance || { opening_balance: 0, additions: 0, deductions: 0, balance: 0, lop: 0, notes: null };

  let effectiveBalance = safeBalance.balance;
  let effectiveLop = safeBalance.lop;
  let banner = null;

  if (inProbation) {
    effectiveBalance = 0;
    banner = {
      type: 'warning',
      message: `On Probation. No leave balance for the first 3 months from employment start date (${formatDate(employee.joining_date) || 'not set'}).`,
    };
  } else if (isResigned) {
    effectiveBalance = 0;
    banner = { type: 'muted', message: 'Employee has resigned.' };
  } else if (postNotice) {
    effectiveBalance = 0;
    banner = {
      type: 'danger',
      message: `Notice period ended on ${formatDate(employee.notice_period_end)}. All further leaves are treated as Loss of Pay (LOP).`,
    };
  } else if (isNoticePeriod) {
    banner = {
      type: 'warning',
      message: `Notice Period in progress. Last working day: ${formatDate(employee.notice_period_end) || 'not set'}. Any leaves after that date will be LOP.`,
    };
  } else if (postProbation) {
    banner = {
      type: 'success',
      message: `Probation completed on ${formatDate(probEnd)}. Leave balance now accumulates at 1.5 leaves/month.`,
    };
  }

  return {
    opening: safeBalance.opening_balance,
    additions: safeBalance.additions,
    deductions: safeBalance.deductions,
    balance: effectiveBalance,
    rawBalance: safeBalance.balance,
    lop: effectiveLop,
    notes: safeBalance.notes,
    banner,
    probationEnd: probEnd,
    status,
    category,
  };
}

function isValidStatus(s) {
  return ['Active', 'Probation', 'Notice Period', 'Resigned'].includes(s);
}

function isValidCategory(c) {
  return ['Employee', 'Intern'].includes(c);
}

function isValidRole(r) {
  return ['employee', 'accounts', 'admin'].includes(r);
}

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/register', (req, res) => {
  res.render('register', { error: null, values: {} });
});

app.post('/register', (req, res) => {
  const { name, dob, department, email, password, confirmPassword } = req.body;
  const values = { name, dob, department, email };

  if (!name?.trim() || !dob || !department?.trim() || !email?.trim() || !password) {
    return res.render('register', { error: 'All fields are required.', values });
  }

  if (!isValidDepartment(department)) {
    return res.render('register', { error: 'Please select a valid department.', values });
  }

  if (password.length < 8) {
    return res.render('register', { error: 'Password must be at least 8 characters.', values });
  }

  if (password !== confirmPassword) {
    return res.render('register', { error: 'Passwords do not match.', values });
  }

  if (Number.isNaN(new Date(dob).getTime())) {
    return res.render('register', { error: 'Please enter a valid date of birth.', values });
  }

  if (db.getEmployeeByEmail(email)) {
    return res.render('register', { error: 'An account with this email already exists.', values });
  }

  db.createEmployee({
    name,
    dob,
    department,
    email,
    passwordHash: auth.hashPassword(password),
  });
  res.redirect('/login?registered=1');
});

app.get('/login', (req, res) => {
  if (req.session.employeeId) {
    return res.redirect('/employee');
  }
  res.render('employee-login', {
    error: null,
    registered: req.query.registered === '1',
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const employee = db.getEmployeeByEmail(email);

  if (!employee || !auth.verifyPassword(password, employee.password_hash)) {
    return res.render('employee-login', {
      error: 'Invalid email or password.',
      registered: false,
    });
  }

  req.session.employeeId = employee.id;
  if (employee.role === 'accounts') {
    req.session.accountsId = employee.id;
    return res.redirect('/accounts');
  }
  if (employee.role === 'admin') {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.redirect('/employee');
});

app.post('/logout', (req, res) => {
  delete req.session.employeeId;
  delete req.session.accountsId;
  res.redirect('/');
});

app.get('/employee', requireEmployee, (req, res) => {
  const employee = db.getEmployeeById(req.session.employeeId);
  if (!employee) {
    delete req.session.employeeId;
    return res.redirect('/login');
  }
  const balance = db.getLeaveBalance(employee.id);
  const summary = leaveSummary(employee, balance);
  res.render('employee-dashboard', { employee, summary, formatDob, formatDate });
});

app.get('/employee/leave', requireEmployee, (req, res) => {
  const employee = db.getEmployeeById(req.session.employeeId);
  if (!employee) {
    delete req.session.employeeId;
    return res.redirect('/login');
  }
  const balance = db.getLeaveBalance(employee.id);
  const summary = leaveSummary(employee, balance);
  res.render('employee-leave', { employee, summary, formatDate });
});

app.get('/accounts/login', (req, res) => {
  res.render('employee-login', { error: null, registered: false });
});

app.post('/accounts/login', (req, res) => {
  const { email, password } = req.body;
  const employee = db.getEmployeeByEmail(email);
  if (!employee || !auth.verifyPassword(password, employee.password_hash)) {
    return res.render('employee-login', { error: 'Invalid email or password.', registered: false });
  }
  if (employee.role !== 'accounts') {
    return res.render('employee-login', { error: 'This account does not have Accounts access. Use the regular sign-in.', registered: false });
  }
  req.session.employeeId = employee.id;
  req.session.accountsId = employee.id;
  res.redirect('/accounts');
});

app.post('/accounts/logout', requireAccounts, (req, res) => {
  delete req.session.accountsId;
  delete req.session.employeeId;
  res.redirect('/');
});

app.get('/accounts', requireAccounts, (req, res) => {
  const me = db.getEmployeeById(req.session.accountsId);
  if (!me) return res.redirect('/accounts/login');

  let employees = db.getAllEmployees().filter(e => e.role !== 'admin');
  const balances = db.getAllLeaveBalances();
  const leaveBalances = {};
  balances.forEach(b => { leaveBalances[b.employee_id] = b; });

  const q = (req.query.q || '').trim().toLowerCase();
  if (q) {
    employees = employees.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.email || '').toLowerCase().includes(q) ||
      (e.department || '').toLowerCase().includes(q)
    );
  }

  res.render('accounts-dashboard', {
    me,
    employees,
    leaveBalances,
    query: q,
    message: req.query.message || null,
    formatDob,
  });
});

app.get('/accounts/employees/:id', requireAccounts, (req, res) => {
  const employee = db.getEmployeeById(req.params.id);
  if (!employee) return res.redirect('/accounts?message=Employee+not+found');

  const month = (req.query.month || '').trim() || todayISO().slice(0, 7);
  const records = db.getAttendanceForMonth(employee.id, month);
  const byDate = {};
  records.forEach(r => { byDate[r.date] = r; });

  const [year, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ date: dateStr, day: d, record: byDate[dateStr] || null });
  }

  res.render('accounts-attendance', {
    me: db.getEmployeeById(req.session.accountsId),
    employee,
    month,
    days,
    message: req.query.message || null,
    error: null,
  });
});

app.post('/accounts/employees/:id/attendance', requireAccounts, (req, res) => {
  const employee = db.getEmployeeById(req.params.id);
  if (!employee) return res.redirect('/accounts?message=Employee+not+found');

  const { date, status, notes } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return renderAttendanceWithError(res, req, employee, 'Date is required (YYYY-MM-DD).');
  }
  if (!db.isValidAttendanceStatus(status)) {
    return renderAttendanceWithError(res, req, employee, `Status must be one of: ${db.ATTENDANCE_STATUSES.join(', ')}.`);
  }

  db.upsertAttendance({
    employee_id: employee.id,
    date,
    status,
    notes: notes?.trim() || null,
    marked_by: req.session.accountsId,
  });

  const month = date.slice(0, 7);
  res.redirect(`/accounts/employees/${employee.id}?month=${month}&message=Attendance+recorded`);
});

app.post('/accounts/employees/:id/attendance/:date/delete', requireAccounts, (req, res) => {
  const employee = db.getEmployeeById(req.params.id);
  if (!employee) return res.redirect('/accounts?message=Employee+not+found');
  const { date } = req.params;
  db.deleteAttendance(employee.id, date);
  res.redirect(`/accounts/employees/${employee.id}?month=${date.slice(0, 7)}&message=Attendance+removed`);
});

function renderAttendanceWithError(res, req, employee, errorMsg) {
  const month = (req.body.date || todayISO()).slice(0, 7);
  db.upsertAttendance.length; // no-op
  const records = db.getAttendanceForMonth(employee.id, month);
  const byDate = {};
  records.forEach(r => { byDate[r.date] = r; });
  const [year, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ date: dateStr, day: d, record: byDate[dateStr] || null });
  }
  res.render('accounts-attendance', {
    me: db.getEmployeeById(req.session.accountsId),
    employee,
    month,
    days,
    message: null,
    error: errorMsg,
  });
}

app.get('/birthdays', (req, res) => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const employees = db.getBirthdaysThisMonth(month);

  res.render('birthdays', {
    employees,
    monthName: MONTH_NAMES[month - 1],
    formatBirthday,
  });
});

app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) {
    return res.redirect('/admin');
  }
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.render('admin-login', { error: 'Invalid password. Please try again.' });
  }

  req.session.isAdmin = true;
  res.redirect('/admin');
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/admin', requireAdmin, (req, res) => {
  let employees = db.getAllEmployees();
  const balances = db.getAllLeaveBalances();
  const leaveBalances = {};
  balances.forEach(b => { leaveBalances[b.employee_id] = b; });

  const tab = (req.query.tab || 'all').trim();
  if (tab === 'accounts') {
    employees = employees.filter(e => e.role === 'accounts');
  } else if (tab === 'admins') {
    employees = employees.filter(e => e.role === 'admin');
  }

  const q = (req.query.q || '').trim().toLowerCase();
  if (q) {
    employees = employees.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.email || '').toLowerCase().includes(q)
    );
  }

  res.render('admin-dashboard', {
    employees,
    leaveBalances,
    formatDob,
    message: req.query.message || null,
    query: q,
    tab,
    totalCount: db.getAllEmployees().length,
    accountsCount: db.getAllEmployees().filter(e => e.role === 'accounts').length,
    adminsCount: db.getAllEmployees().filter(e => e.role === 'admin').length,
  });
});

app.get('/admin/employees/:id/edit', requireAdmin, (req, res) => {
  const employee = db.getEmployeeById(req.params.id);
  if (!employee) {
    return res.redirect('/admin?message=Employee+not+found');
  }
  res.render('admin-edit', { employee, error: null });
});

app.post('/admin/employees/:id/edit', requireAdmin, (req, res) => {
  const { name, dob, department } = req.body;
  const employee = db.getEmployeeById(req.params.id);

  if (!employee) {
    return res.redirect('/admin?message=Employee+not+found');
  }

  if (!name?.trim() || !dob || !department?.trim()) {
    return res.render('admin-edit', {
      employee: { ...employee, name, dob, department },
      error: 'All fields are required.',
    });
  }

  if (!isValidDepartment(department)) {
    return res.render('admin-edit', {
      employee: { ...employee, name, dob, department },
      error: 'Please select a valid department.',
    });
  }

  db.updateEmployee(req.params.id, { name, dob, department });
  res.redirect('/admin?message=Employee+updated+successfully');
});

app.post('/admin/employees/:id/delete', requireAdmin, (req, res) => {
  db.deleteEmployee(req.params.id);
  res.redirect('/admin?message=Employee+deleted+successfully');
});

app.get('/admin/employees/:id/status', requireAdmin, (req, res) => {
  const employee = db.getEmployeeById(req.params.id);
  if (!employee) {
    return res.redirect('/admin?message=Employee+not+found');
  }
  const summary = leaveSummary(employee, db.getLeaveBalance(employee.id));
  res.render('admin-status', {
    employee,
    summary,
    error: null,
    message: req.query.message || null,
    formatDate,
  });
});

app.post('/admin/employees/:id/status', requireAdmin, (req, res) => {
  const employee = db.getEmployeeById(req.params.id);
  if (!employee) {
    return res.redirect('/admin?message=Employee+not+found');
  }
  const { status, category, joining_date, notice_period_end, internship_start, internship_end, date_of_resignation, role } = req.body;
  const merge = {
    ...employee,
    status: status?.trim() || employee.status,
    category: category?.trim() || employee.category,
    joining_date: joining_date?.trim() || null,
    notice_period_end: notice_period_end?.trim() || null,
    internship_start: internship_start?.trim() || null,
    internship_end: internship_end?.trim() || null,
    date_of_resignation: date_of_resignation?.trim() || null,
    role: role?.trim() || employee.role,
  };

  if (!isValidStatus(merge.status)) {
    return res.render('admin-status', {
      employee: merge,
      summary: leaveSummary(merge, db.getLeaveBalance(merge.id)),
      error: `Status must be one of: ${['Active', 'Probation', 'Notice Period', 'Resigned'].join(', ')}.`,
      message: null,
      formatDate,
    });
  }
  if (!isValidCategory(merge.category)) {
    return res.render('admin-status', {
      employee: merge,
      summary: leaveSummary(merge, db.getLeaveBalance(merge.id)),
      error: 'Category must be Employee or Intern.',
      message: null,
      formatDate,
    });
  }
  if (!isValidRole(merge.role)) {
    return res.render('admin-status', {
      employee: merge,
      summary: leaveSummary(merge, db.getLeaveBalance(merge.id)),
      error: 'Role must be employee, accounts, or admin.',
      message: null,
      formatDate,
    });
  }
  for (const [field, label] of [
    ['notice_period_end', 'Notice period end date'],
    ['joining_date', 'Employment start date'],
    ['internship_start', 'Internship start date'],
    ['internship_end', 'Internship end date'],
    ['date_of_resignation', 'Date of resignation'],
  ]) {
    if (merge[field] && Number.isNaN(new Date(merge[field]).getTime())) {
      return res.render('admin-status', {
        employee: merge,
        summary: leaveSummary(merge, db.getLeaveBalance(merge.id)),
        error: `${label} is invalid.`,
        message: null,
        formatDate,
      });
    }
  }

  if (merge.status === 'Notice Period' && (!merge.date_of_resignation || !merge.notice_period_end)) {
    return res.render('admin-status', {
      employee: merge,
      summary: leaveSummary(merge, db.getLeaveBalance(merge.id)),
      error: 'Notice Period requires both Date of Resignation and Last Working Day.',
      message: null,
      formatDate,
    });
  }

  if (merge.date_of_resignation && merge.notice_period_end && merge.date_of_resignation > merge.notice_period_end) {
    return res.render('admin-status', {
      employee: merge,
      summary: leaveSummary(merge, db.getLeaveBalance(merge.id)),
      error: 'Date of Resignation must be on or before the Last Working Day.',
      message: null,
      formatDate,
    });
  }

  db.updateEmployeeStatus(req.params.id, {
    status: merge.status,
    category: merge.category,
    joining_date: merge.joining_date,
    notice_period_end: merge.notice_period_end,
    internship_start: merge.internship_start,
    internship_end: merge.internship_end,
    date_of_resignation: merge.date_of_resignation,
    role: merge.role,
  });
  res.redirect(`/admin/employees/${req.params.id}/status?message=Status+updated`);
});



app.get('/admin/employees/:id/leave', requireAdmin, (req, res) => {
  const employee = db.getEmployeeById(req.params.id);
  if (!employee) {
    return res.redirect('/admin?message=Employee+not+found');
  }
  const balance = db.getLeaveBalance(employee.id) || {
    opening_balance: 0,
    additions: 0,
    deductions: 0,
    balance: 0,
    lop: 0,
    notes: '',
  };
  const summary = leaveSummary(employee, balance);
  res.render('admin-leave', {
    employee,
    balance,
    summary,
    error: null,
    message: req.query.message || null,
  });
});

app.post('/admin/employees/:id/leave', requireAdmin, (req, res) => {
  const employee = db.getEmployeeById(req.params.id);
  if (!employee) {
    return res.redirect('/admin?message=Employee+not+found');
  }
  const opening = parseFloat(req.body.opening_balance);
  const additions = parseFloat(req.body.additions);
  const deductions = parseFloat(req.body.deductions);
  const lop = parseFloat(req.body.lop);
  const notes = (req.body.notes || '').trim() || null;

  if ([opening, additions, deductions, lop].some(v => !Number.isFinite(v))) {
    const current = db.getLeaveBalance(employee.id) || {
      opening_balance: 0, additions: 0, deductions: 0, balance: 0, lop: 0, notes: '',
    };
    return res.render('admin-leave', {
      employee,
      balance: { ...current, opening_balance: req.body.opening_balance, additions: req.body.additions, deductions: req.body.deductions, lop: req.body.lop, notes: req.body.notes },
      summary: leaveSummary(employee, current),
      error: 'All leave values must be numeric.',
      message: null,
    });
  }

  const balance = opening + additions - deductions;
  db.upsertLeaveBalance(employee.id, {
    opening_balance: opening,
    additions,
    deductions,
    balance,
    lop,
    notes,
  });
  res.redirect(`/admin/employees/${req.params.id}/leave?message=Leave+balance+updated`);
});

app.listen(PORT, () => {
  console.log(`Employee Portal running at http://localhost:${PORT}`);
});
