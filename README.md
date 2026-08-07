# Employee Portal

A small web application for employee registration, monthly birthday listings, admin management of employee records, and a leave-balance tracker.

## Features

- **Employee Registration** — New employees register with name, email, date of birth, department, and password.
- **Employee Sign-In** — Employees access their profile at `/employee` after password verification.
- **Birthdays** — Public page showing all employees with birthdays in the current calendar month.
- **Admin Dashboard** — Authenticated admins can view, edit, and delete employee records.
- **Leave Tracker**
  - Employee dashboard (`/employee/leave`) shows opening balance, additions, deductions, effective balance, and LOP.
  - Admin can edit per-employee leave balance (`/admin/employees/:id/leave`).
  - Admin can set employee **status** (Active / Probation / Notice Period / Resigned), **category** (Employee / Intern), **joining date**, and **last working day** (`/admin/employees/:id/status`).

## Leave Logic

| Status            | Behavior                                                                                                       |
|-------------------|----------------------------------------------------------------------------------------------------------------|
| Active            | Standard balance = Opening + Additions − Deductions                                                          |
| Probation (New Joinee) | First 3 months from joining date — balance is hidden (treated as 0). After 3 months: 1.5 leaves/month accumulate |
| Notice Period     | Before LWD: balance shown. After LWD: balance is 0 and any further leaves are LOP                              |
| Resigned          | Balance hidden                                                                                                 |

A negative stored balance flows into the LOP field automatically.

## Tech Stack

- **Node.js** + **Express** — Web server
- **SQLite** (via `better-sqlite3`) — Persistent storage
- **EJS** — Server-side templates
- **Custom CSS** — Clean, responsive UI

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later

## Setup

```bash
cd employee-portal
npm install
cp .env.example .env   # optional — defaults work out of the box
npm start
```

The app runs at **http://localhost:3000**

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `SESSION_SECRET` | `employee-portal-secret` | Session cookie signing secret |
| `ADMIN_PASSWORD` | `admin123` | Admin password |

Set these in `.env` for production. See `.env.example` for the template.

## Bulk Import Scripts

| Script | What it does |
|--------|--------------|
| `node import.js` | Import employees from `Employee Date of Birth List_June 2026 1.csv`. Assigns default password `Welcome@123`. Idempotent (skips by email). |
| `node import_leaves.js` | Import leave balances from `Attendance Day pass tracker_July - 2026.csv`. Updates status (Active / Probation), category (Employee / Intern), and leave balance fields. Idempotent via `upsertLeaveBalance`. |

## Departments

- Engineering
- Marketing
- Sales
- Human Resources
- Accounts & Finance
- Tech Support
- Operations
- Other

Existing records with department "Finance" are migrated automatically to "Accounts & Finance" on startup.

## Routes

| Route | Description |
|-------|-------------|
| `/` | Home page with navigation |
| `/register` | Employee registration form |
| `/login` | Employee sign-in (password) |
| `/employee` | Employee profile (requires sign-in) |
| `/employee/leave` | Employee leave-balance dashboard |
| `/birthdays` | This month's birthdays (public) |
| `/admin/login` | Admin sign-in (password) |
| `/admin` | Admin dashboard (requires admin sign-in) |
| `/admin/employees/:id/edit` | Edit an employee (name, DOB, department) |
| `/admin/employees/:id/status` | Edit employee status / category / dates |
| `/admin/employees/:id/leave` | Edit employee leave balance |

## Default Passwords

Employees imported via the bulk scripts use `Welcome@123`. The admin password is `admin123` by default. Change these in production via `.env`.

## Project Structure

```
employee-portal/
├── server.js          # Express app & routes
├── db.js              # SQLite helpers & schema
├── auth.js            # Password hashing helpers
├── constants.js       # Shared constants (departments)
├── import.js          # Employee CSV import script
├── import_leaves.js   # Leave-balance CSV import script
├── public/css/        # Stylesheets
├── views/             # EJS templates
├── employees.db       # SQLite database (created at runtime)
├── .env.example       # Environment variable template
└── README.md
```