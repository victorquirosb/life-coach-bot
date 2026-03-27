const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isoWeek = require('dayjs/plugin/isoWeek');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

const TZ = 'Atlantic/Canary';
const now = () => dayjs().tz(TZ);

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

  // --- Schema ---

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
    horizon TEXT DEFAULT 'short',
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
    priority INTEGER DEFAULT 5,
    escalation_count INTEGER DEFAULT 0,
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
    is_proactive INTEGER DEFAULT 0,
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

  // Track proactive messages per day for persistent limits
  db.run(`CREATE TABLE IF NOT EXISTS proactive_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sent_at DATETIME NOT NULL,
    trigger_type TEXT NOT NULL
  )`);

  // --- Safe column additions (ignore if exists) ---
  const safeAddColumn = (table, col, type, dflt) => {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type} DEFAULT ${dflt}`); } catch (_) {}
  };
  safeAddColumn('goals', 'horizon', "TEXT", "'short'");
  safeAddColumn('tasks', 'priority', 'INTEGER', '5');
  safeAddColumn('tasks', 'escalation_count', 'INTEGER', '0');
  safeAddColumn('conversations', 'is_proactive', 'INTEGER', '0');

  // --- Defaults ---
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
    max_proactive_per_day: '8',
    min_interval_minutes: '45',
  };

  for (const [key, value] of Object.entries(defaults)) {
    db.run('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)', [key, value]);
  }

  saveDatabase();
  console.log('✅ Base de datos inicializada');
  return db;
}

// --- Persistence ---

function saveDatabase() {
  if (!db) return;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// --- Low-level helpers ---

function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  } catch (e) {
    console.error('DB query error:', e.message, sql);
    return [];
  }
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    saveDatabase();
    const idResult = db.exec('SELECT last_insert_rowid()');
    const lastId = idResult[0]?.values[0]?.[0] ?? null;
    return { lastInsertRowid: lastId };
  } catch (e) {
    console.error('DB run error:', e.message, sql);
    return { lastInsertRowid: null };
  }
}

// --- Profile ---
const getProfile = () => query('SELECT * FROM profile');
const setProfile = (key, value, category = 'general') => {
  run('INSERT OR REPLACE INTO profile (key, value, category, updated_at) VALUES (?, ?, ?, ?)',
    [key, value, category, now().format('YYYY-MM-DD HH:mm:ss')]);
};

// --- Goals ---
const getActiveGoals = () => query('SELECT * FROM goals WHERE active = 1');
const addGoal = (pillar, title, targetValue, unit, frequency = 'weekly', description = '', horizon = 'short') => {
  return run('INSERT INTO goals (pillar, title, target_value, unit, frequency, description, horizon) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [pillar, title, targetValue, unit, frequency, description, horizon]);
};
const updateGoalProgress = (goalId, currentValue) => {
  run('UPDATE goals SET current_value = ?, updated_at = ? WHERE id = ?',
    [currentValue, now().format('YYYY-MM-DD HH:mm:ss'), goalId]);
};

// --- Inventory ---
const getInventory = () => query('SELECT * FROM inventory');
const addInventory = (category, name, details = '') => {
  return run('INSERT INTO inventory (category, name, details) VALUES (?, ?, ?)', [category, name, details]);
};

// --- Routines ---
const getRoutines = () => query('SELECT * FROM routines WHERE active = 1');
const addRoutine = (pillar, name, schedule, details = '') => {
  return run('INSERT INTO routines (pillar, name, schedule, details) VALUES (?, ?, ?, ?)', [pillar, name, schedule, details]);
};

// --- Tasks ---
const getPendingTasks = () => {
  return query("SELECT * FROM tasks WHERE status = 'pending' ORDER BY priority DESC, created_at ASC");
};

const getTodayTasks = () => {
  const today = now().format('YYYY-MM-DD');
  return query(
    "SELECT * FROM tasks WHERE (date(created_at) = ? OR due_date = ?) AND status IN ('pending', 'done') ORDER BY created_at DESC",
    [today, today]
  );
};

const addTask = (pillar, description, followUpMinutes = null, dueDate = null, priority = 5) => {
  const result = run(
    'INSERT INTO tasks (pillar, description, due_date, priority) VALUES (?, ?, ?, ?)',
    [pillar, description, dueDate, priority]
  );

  const taskId = result.lastInsertRowid;

  if (followUpMinutes && followUpMinutes > 0) {
    const triggerAt = now().add(followUpMinutes, 'minute').format('YYYY-MM-DD HH:mm:ss');
    run(
      'INSERT INTO dynamic_triggers (trigger_at, type, context, task_id) VALUES (?, ?, ?, ?)',
      [triggerAt, 'task_follow_up', JSON.stringify({ description, priority }), taskId]
    );
    console.log(`  ⏰ Follow-up para "${description}" → ${triggerAt}`);
  }

  return result;
};

const completeTask = (taskId) => {
  run("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?",
    [now().format('YYYY-MM-DD HH:mm:ss'), taskId]);
};

const escalateTask = (taskId) => {
  run('UPDATE tasks SET escalation_count = escalation_count + 1 WHERE id = ?', [taskId]);
};

const getTaskById = (taskId) => {
  const rows = query('SELECT * FROM tasks WHERE id = ?', [taskId]);
  return rows[0] || null;
};

// --- Daily Log ---
const getTodayLog = () => {
  const today = now().format('YYYY-MM-DD');
  return query('SELECT * FROM daily_log WHERE date = ? ORDER BY created_at', [today]);
};
const addLog = (pillar, type, content) => {
  const today = now().format('YYYY-MM-DD');
  return run('INSERT INTO daily_log (date, pillar, type, content) VALUES (?, ?, ?, ?)',
    [today, pillar, type, content]);
};

// --- Revenue ---
const getWeekRevenue = () => {
  const startOfWeek = now().startOf('isoWeek').format('YYYY-MM-DD');
  const result = query('SELECT COALESCE(SUM(amount), 0) as total FROM revenue WHERE date >= ?', [startOfWeek]);
  return result[0]?.total || 0;
};
const getMonthRevenue = () => {
  const startOfMonth = now().startOf('month').format('YYYY-MM-DD');
  const result = query('SELECT COALESCE(SUM(amount), 0) as total FROM revenue WHERE date >= ?', [startOfMonth]);
  return result[0]?.total || 0;
};
const addRevenue = (amount, description) => {
  const today = now().format('YYYY-MM-DD');
  return run('INSERT INTO revenue (amount, description, date) VALUES (?, ?, ?)', [amount, description, today]);
};

// --- Conversations ---

const getRecentConversations = (limit = 20) => {
  return query(
    'SELECT role, content, is_proactive, created_at FROM conversations ORDER BY id DESC LIMIT ?',
    [limit]
  ).reverse();
};

const addConversation = (role, content, isProactive = false) => {
  if (!content || content.trim() === '') return;
  run('INSERT INTO conversations (role, content, is_proactive, created_at) VALUES (?, ?, ?, ?)',
    [role, content.trim(), isProactive ? 1 : 0, now().format('YYYY-MM-DD HH:mm:ss')]);
  // Keep only last 200 messages
  run('DELETE FROM conversations WHERE id NOT IN (SELECT id FROM conversations ORDER BY id DESC LIMIT 200)');
};

// --- Dynamic Triggers ---

const getPendingTriggers = () => {
  const nowStr = now().format('YYYY-MM-DD HH:mm:ss');
  return query(
    `SELECT dt.*, t.description as task_description, t.status as task_status,
            t.escalation_count as task_escalation
     FROM dynamic_triggers dt
     LEFT JOIN tasks t ON dt.task_id = t.id
     WHERE dt.trigger_at <= ? AND dt.executed = 0
     ORDER BY dt.trigger_at ASC`,
    [nowStr]
  );
};

const markTriggerExecuted = (triggerId) => {
  run('UPDATE dynamic_triggers SET executed = 1 WHERE id = ?', [triggerId]);
};

const addDynamicTrigger = (triggerAt, type, context, taskId = null) => {
  return run('INSERT INTO dynamic_triggers (trigger_at, type, context, task_id) VALUES (?, ?, ?, ?)',
    [triggerAt, type, context, taskId]);
};

const countPendingTriggers = () => {
  const rows = query('SELECT COUNT(*) as cnt FROM dynamic_triggers WHERE executed = 0');
  return rows[0]?.cnt || 0;
};

// --- Config ---
const getConfig = (key) => {
  const rows = query('SELECT value FROM config WHERE key = ?', [key]);
  return rows[0]?.value || null;
};
const getAllConfig = () => {
  const rows = query('SELECT * FROM config');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
};
const setConfig = (key, value) => {
  run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [key, String(value)]);
};

// --- Proactive Message Tracking (persistent across redeploys) ---

const logProactiveMessage = (triggerType) => {
  run('INSERT INTO proactive_log (sent_at, trigger_type) VALUES (?, ?)',
    [now().format('YYYY-MM-DD HH:mm:ss'), triggerType]);
};

const getProactiveCountToday = () => {
  const today = now().format('YYYY-MM-DD');
  const rows = query("SELECT COUNT(*) as cnt FROM proactive_log WHERE date(sent_at) = ?", [today]);
  return rows[0]?.cnt || 0;
};

const getLastProactiveTime = () => {
  const rows = query('SELECT sent_at FROM proactive_log ORDER BY id DESC LIMIT 1');
  if (!rows[0]) return null;
  return dayjs.tz(rows[0].sent_at, TZ);
};

const getUnansweredProactiveCount = () => {
  // Count consecutive assistant (proactive) messages at the end of conversation with no user reply
  const recent = query(
    "SELECT role, is_proactive FROM conversations ORDER BY id DESC LIMIT 10"
  );
  let count = 0;
  for (const msg of recent) {
    if (msg.role === 'user') break;
    if (msg.role === 'assistant' && msg.is_proactive) count++;
  }
  return count;
};

// --- Utility ---
const getNow = () => now();

module.exports = {
  initDatabase, getNow, TZ,
  getProfile, setProfile,
  getActiveGoals, addGoal, updateGoalProgress,
  getInventory, addInventory,
  getRoutines, addRoutine,
  getPendingTasks, getTodayTasks, addTask, completeTask, escalateTask, getTaskById,
  getTodayLog, addLog,
  getWeekRevenue, getMonthRevenue, addRevenue,
  getRecentConversations, addConversation,
  getPendingTriggers, markTriggerExecuted, addDynamicTrigger, countPendingTriggers,
  getConfig, getAllConfig, setConfig,
  logProactiveMessage, getProactiveCountToday, getLastProactiveTime, getUnansweredProactiveCount,
};
