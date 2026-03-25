const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'coach.db');

let db = null;

async function initDatabase() {
  const SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  
  db.run('PRAGMA journal_mode = WAL');
  
  db.run(`CREATE TABLE IF NOT EXISTS profile (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pillar TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    target_value REAL,
    current_value REAL DEFAULT 0,
    unit TEXT,
    frequency TEXT DEFAULT 'weekly',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    details TEXT,
    status TEXT DEFAULT 'owned',
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pillar TEXT NOT NULL,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    details TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pillar TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    due_date TEXT,
    follow_up_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS daily_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    pillar TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS dynamic_triggers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_at DATETIME NOT NULL,
    type TEXT NOT NULL,
    context TEXT NOT NULL,
    executed INTEGER DEFAULT 0,
    task_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS revenue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    description TEXT,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  
  const defaults = {
    intensity: 'high',
    silent_mode: 'false',
    morning_time: '07:30',
    lunch_check: '13:30',
    afternoon_check: '17:00',
    evening_check: '20:30',
    night_review: '23:00',
    friday_prep: '18:00',
    sunday_review: '20:00',
    follow_up_delay_minutes: '30',
    inactivity_threshold_hours: '3',
  };
  
  for (const [key, value] of Object.entries(defaults)) {
    db.run('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)', [key, value]);
  }
  
  saveDatabase();
  console.log('✅ Base de datos inicializada');
  return db;
}

function saveDatabase() {
  if (!db) return;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (e) {
    console.error('DB query error:', e.message);
    return [];
  }
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    saveDatabase();
    return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] };
  } catch (e) {
    console.error('DB run error:', e.message);
    return { lastInsertRowid: null };
  }
}

const getProfile = () => query('SELECT * FROM profile');
const setProfile = (key, value, category = 'general') => {
  run('INSERT OR REPLACE INTO profile (key, value, category, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', [key, value, category]);
};

const getActiveGoals = () => query('SELECT * FROM goals WHERE active = 1');
const addGoal = (pillar, title, targetValue, unit, frequency = 'weekly', description = '') => {
  return run('INSERT INTO goals (pillar, title, target_value, unit, frequency, description) VALUES (?, ?, ?, ?, ?, ?)', [pillar, title, targetValue, unit, frequency, description]);
};
const updateGoalProgress = (goalId, currentValue) => {
  run('UPDATE goals SET current_value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [currentValue, goalId]);
};

const getInventory = () => query('SELECT * FROM inventory');
const addInventory = (category, name, details = '') => {
  return run('INSERT INTO inventory (category, name, details) VALUES (?, ?, ?)', [category, name, details]);
};

const getRoutines = () => query('SELECT * FROM routines WHERE active = 1');
const addRoutine = (pillar, name, schedule, details = '') => {
  return run('INSERT INTO routines (pillar, name, schedule, details) VALUES (?, ?, ?, ?)', [pillar, name, schedule, details]);
};

const getPendingTasks = () => {
  return query("SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at DESC");
};
const getTodayTasks = () => {
  const today = dayjs().format('YYYY-MM-DD');
  return query("SELECT * FROM tasks WHERE (date(created_at) = ? OR due_date = ?) AND status IN ('pending', 'done') ORDER BY created_at DESC", [today, today]);
};
const addTask = (pillar, description, followUpMinutes = null, dueDate = null) => {
  const result = run('INSERT INTO tasks (pillar, description, due_date) VALUES (?, ?, ?)', [pillar, description, dueDate]);
  if (followUpMinutes && result.lastInsertRowid) {
    const triggerAt = dayjs().add(followUpMinutes, 'minute').format('YYYY-MM-DD HH:mm:ss');
    run('INSERT INTO dynamic_triggers (trigger_at, type, context, task_id) VALUES (?, ?, ?, ?)', [triggerAt, 'task_follow_up', JSON.stringify({ description }), result.lastInsertRowid]);
  }
  return result;
};
const completeTask = (taskId) => {
  run("UPDATE tasks SET status = 'done', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [taskId]);
};

const getTodayLog = () => {
  const today = dayjs().format('YYYY-MM-DD');
  return query('SELECT * FROM daily_log WHERE date = ? ORDER BY created_at', [today]);
};
const addLog = (pillar, type, content) => {
  const today = dayjs().format('YYYY-MM-DD');
  return run('INSERT INTO daily_log (date, pillar, type, content) VALUES (?, ?, ?, ?)', [today, pillar, type, content]);
};

const getWeekRevenue = () => {
  const startOfWeek = dayjs().startOf('week').format('YYYY-MM-DD');
  const result = query('SELECT COALESCE(SUM(amount), 0) as total FROM revenue WHERE date >= ?', [startOfWeek]);
  return result[0]?.total || 0;
};
const getMonthRevenue = () => {
  const startOfMonth = dayjs().startOf('month').format('YYYY-MM-DD');
  const result = query('SELECT COALESCE(SUM(amount), 0) as total FROM revenue WHERE date >= ?', [startOfMonth]);
  return result[0]?.total || 0;
};
const addRevenue = (amount, description) => {
  const today = dayjs().format('YYYY-MM-DD');
  return run('INSERT INTO revenue (amount, description, date) VALUES (?, ?, ?)', [amount, description, today]);
};

const getRecentConversations = (limit = 20) => {
  return query('SELECT role, content, created_at FROM conversations ORDER BY created_at DESC LIMIT ?', [limit]).reverse();
};
const addConversation = (role, content) => {
  run('INSERT INTO conversations (role, content) VALUES (?, ?)', [role, content]);
  run('DELETE FROM conversations WHERE id NOT IN (SELECT id FROM conversations ORDER BY created_at DESC LIMIT 100)');
};

const getPendingTriggers = () => {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  return query("SELECT dt.*, t.description as task_description, t.status as task_status FROM dynamic_triggers dt LEFT JOIN tasks t ON dt.task_id = t.id WHERE dt.trigger_at <= ? AND dt.executed = 0 ORDER BY dt.trigger_at", [now]);
};
const markTriggerExecuted = (triggerId) => {
  run('UPDATE dynamic_triggers SET executed = 1 WHERE id = ?', [triggerId]);
};
const addDynamicTrigger = (triggerAt, type, context, taskId = null) => {
  return run('INSERT INTO dynamic_triggers (trigger_at, type, context, task_id) VALUES (?, ?, ?, ?)', [triggerAt, type, context, taskId]);
};

const getConfig = (key) => {
  const rows = query('SELECT value FROM config WHERE key = ?', [key]);
  return rows[0]?.value || null;
};
const getAllConfig = () => {
  const rows = query('SELECT * FROM config');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
};
const setConfig = (key, value) => {
  run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [key, value]);
};

module.exports = {
  initDatabase,
  getProfile, setProfile,
  getActiveGoals, addGoal, updateGoalProgress,
  getInventory, addInventory,
  getRoutines, addRoutine,
  getPendingTasks, getTodayTasks, addTask, completeTask,
  getTodayLog, addLog,
  getWeekRevenue, getMonthRevenue, addRevenue,
  getRecentConversations, addConversation,
  getPendingTriggers, markTriggerExecuted, addDynamicTrigger,
  getConfig, getAllConfig, setConfig,
};
