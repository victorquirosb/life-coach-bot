const Database = require('better-sqlite3');
const path = require('path');
const dayjs = require('dayjs');

const db = new Database(path.join(__dirname, '..', 'data', 'coach.db'));
db.pragma('journal_mode = WAL');

// ---- PERFIL ----
const getProfile = () => db.prepare('SELECT * FROM profile').all();
const setProfile = (key, value, category = 'general') => {
  db.prepare(`
    INSERT INTO profile (key, value, category, updated_at) 
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = ?, category = ?, updated_at = CURRENT_TIMESTAMP
  `).run(key, value, category, value, category);
};

// ---- OBJETIVOS ----
const getActiveGoals = () => db.prepare('SELECT * FROM goals WHERE active = 1').all();
const addGoal = (pillar, title, targetValue, unit, frequency = 'weekly', description = '') => {
  return db.prepare(`
    INSERT INTO goals (pillar, title, target_value, unit, frequency, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(pillar, title, targetValue, unit, frequency, description);
};
const updateGoalProgress = (goalId, currentValue) => {
  db.prepare('UPDATE goals SET current_value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(currentValue, goalId);
};

// ---- INVENTARIO ----
const getInventory = () => db.prepare('SELECT * FROM inventory').all();
const addInventory = (category, name, details = '') => {
  return db.prepare('INSERT INTO inventory (category, name, details) VALUES (?, ?, ?)')
    .run(category, name, details);
};

// ---- RUTINAS ----
const getRoutines = () => db.prepare('SELECT * FROM routines WHERE active = 1').all();
const addRoutine = (pillar, name, schedule, details = '') => {
  return db.prepare('INSERT INTO routines (pillar, name, schedule, details) VALUES (?, ?, ?, ?)')
    .run(pillar, name, schedule, details);
};

// ---- TAREAS ----
const getPendingTasks = () => {
  return db.prepare(`
    SELECT * FROM tasks 
    WHERE status = 'pending' 
    ORDER BY created_at DESC
  `).all();
};
const getTodayTasks = () => {
  const today = dayjs().format('YYYY-MM-DD');
  return db.prepare(`
    SELECT * FROM tasks 
    WHERE (date(created_at) = ? OR due_date = ?) 
    AND status IN ('pending', 'done')
    ORDER BY created_at DESC
  `).all(today, today);
};
const addTask = (pillar, description, followUpMinutes = null, dueDate = null) => {
  const result = db.prepare(`
    INSERT INTO tasks (pillar, description, due_date) VALUES (?, ?, ?)
  `).run(pillar, description, dueDate);
  
  // Si hay follow-up, crear trigger dinámico
  if (followUpMinutes && result.lastInsertRowid) {
    const triggerAt = dayjs().add(followUpMinutes, 'minute').format('YYYY-MM-DD HH:mm:ss');
    db.prepare(`
      INSERT INTO dynamic_triggers (trigger_at, type, context, task_id)
      VALUES (?, 'task_follow_up', ?, ?)
    `).run(triggerAt, JSON.stringify({ description }), result.lastInsertRowid);
  }
  
  return result;
};
const completeTask = (taskId) => {
  db.prepare(`
    UPDATE tasks SET status = 'done', completed_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(taskId);
};

// ---- REGISTRO DIARIO ----
const getTodayLog = () => {
  const today = dayjs().format('YYYY-MM-DD');
  return db.prepare('SELECT * FROM daily_log WHERE date = ? ORDER BY created_at').all(today);
};
const addLog = (pillar, type, content) => {
  const today = dayjs().format('YYYY-MM-DD');
  return db.prepare('INSERT INTO daily_log (date, pillar, type, content) VALUES (?, ?, ?, ?)')
    .run(today, pillar, type, content);
};

// ---- FACTURACIÓN ----
const getWeekRevenue = () => {
  const startOfWeek = dayjs().startOf('week').format('YYYY-MM-DD');
  const result = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM revenue WHERE date >= ?
  `).get(startOfWeek);
  return result.total;
};
const getMonthRevenue = () => {
  const startOfMonth = dayjs().startOf('month').format('YYYY-MM-DD');
  const result = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM revenue WHERE date >= ?
  `).get(startOfMonth);
  return result.total;
};
const addRevenue = (amount, description) => {
  const today = dayjs().format('YYYY-MM-DD');
  return db.prepare('INSERT INTO revenue (amount, description, date) VALUES (?, ?, ?)')
    .run(amount, description, today);
};

// ---- CONVERSACIONES (contexto para Claude) ----
const getRecentConversations = (limit = 20) => {
  return db.prepare(`
    SELECT role, content, created_at FROM conversations 
    ORDER BY created_at DESC LIMIT ?
  `).all(limit).reverse();
};
const addConversation = (role, content) => {
  db.prepare('INSERT INTO conversations (role, content) VALUES (?, ?)').run(role, content);
  // Limpiar conversaciones antiguas (mantener últimas 100)
  db.prepare(`
    DELETE FROM conversations WHERE id NOT IN (
      SELECT id FROM conversations ORDER BY created_at DESC LIMIT 100
    )
  `).run();
};

// ---- TRIGGERS DINÁMICOS ----
const getPendingTriggers = () => {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  return db.prepare(`
    SELECT dt.*, t.description as task_description, t.status as task_status
    FROM dynamic_triggers dt
    LEFT JOIN tasks t ON dt.task_id = t.id
    WHERE dt.trigger_at <= ? AND dt.executed = 0
    ORDER BY dt.trigger_at
  `).all(now);
};
const markTriggerExecuted = (triggerId) => {
  db.prepare('UPDATE dynamic_triggers SET executed = 1 WHERE id = ?').run(triggerId);
};
const addDynamicTrigger = (triggerAt, type, context, taskId = null) => {
  return db.prepare(`
    INSERT INTO dynamic_triggers (trigger_at, type, context, task_id)
    VALUES (?, ?, ?, ?)
  `).run(triggerAt, type, context, taskId);
};

// ---- CONFIGURACIÓN ----
const getConfig = (key) => {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
};
const getAllConfig = () => {
  const rows = db.prepare('SELECT * FROM config').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
};
const setConfig = (key, value) => {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);
};

module.exports = {
  db,
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
