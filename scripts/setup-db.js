const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'coach.db'));

// Activar WAL mode para mejor rendimiento
db.pragma('journal_mode = WAL');

// ============================================
// TABLA: perfil del usuario
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS profile (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// TABLA: objetivos
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pillar TEXT NOT NULL CHECK(pillar IN ('cuerpo', 'hogar', 'trabajo')),
    title TEXT NOT NULL,
    description TEXT,
    target_value REAL,
    current_value REAL DEFAULT 0,
    unit TEXT,
    frequency TEXT DEFAULT 'weekly',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// TABLA: inventario (perfumes, ropa, suplementos, etc.)
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    details TEXT,
    status TEXT DEFAULT 'owned',
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// TABLA: rutinas (gym, dieta, skincare, etc.)
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pillar TEXT NOT NULL,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    details TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// TABLA: tareas pendientes (dinámicas)
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pillar TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done', 'skipped', 'postponed')),
    due_date TEXT,
    follow_up_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  )
`);

// ============================================
// TABLA: registro diario (comidas, gym, trabajo, etc.)
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    pillar TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// TABLA: historial de conversaciones (contexto para Claude)
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// TABLA: triggers dinámicos (seguimientos programados)
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS dynamic_triggers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_at DATETIME NOT NULL,
    type TEXT NOT NULL,
    context TEXT NOT NULL,
    executed INTEGER DEFAULT 0,
    task_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  )
`);

// ============================================
// TABLA: facturación semanal/mensual
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS revenue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    description TEXT,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// TABLA: configuración del bot
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

// Valores por defecto de configuración
const defaults = {
  intensity: 'high',           // low, medium, high, savage
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

const insertConfig = db.prepare(
  'INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)'
);

for (const [key, value] of Object.entries(defaults)) {
  insertConfig.run(key, value);
}

console.log('✅ Base de datos creada correctamente en data/coach.db');
console.log('✅ Configuración por defecto insertada');

db.close();
