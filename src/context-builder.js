const db = require('./database');

const dayNameMap = {
  0: ['domingo', 'dom', 'sunday', 'sun'],
  1: ['lunes', 'lun', 'monday', 'mon'],
  2: ['martes', 'mar', 'tuesday', 'tue'],
  3: ['miércoles', 'mié', 'miercoles', 'wednesday', 'wed'],
  4: ['jueves', 'jue', 'thursday', 'thu'],
  5: ['viernes', 'vie', 'friday', 'fri'],
  6: ['sábado', 'sáb', 'sabado', 'saturday', 'sat'],
};

function isTodayRoutine(schedule) {
  const today = db.getNow().day();
  const names = dayNameMap[today] || [];
  const lower = schedule.toLowerCase();

  // Check if "diario" or "todos los días"
  if (lower.includes('diario') || lower.includes('todos') || lower.includes('daily')) return true;

  // Check if any day name matches
  return names.some(n => lower.includes(n));
}

function buildTriggerContext(triggerType) {
  const now = db.getNow();
  const config = db.getAllConfig();
  const pendingTasks = db.getPendingTasks();
  const todayLog = db.getTodayLog();
  const goals = db.getActiveGoals();
  const routines = db.getRoutines();
  const allTodayTasks = db.getTodayTasks();

  const todayRoutines = routines.filter(r => isTodayRoutine(r.schedule));
  const completedToday = allTodayTasks.filter(t => t.status === 'done');
  const mealsToday = todayLog.filter(l => l.pillar === 'cuerpo' && ['desayuno', 'almuerzo', 'cena', 'snack', 'comida'].includes(l.type));
  const workoutsToday = todayLog.filter(l => l.type && l.type.startsWith('workout'));

  const base = {
    hora: now.format('HH:mm'),
    fecha: now.format('DD/MM/YYYY'),
    tareas_pendientes: pendingTasks.map(t => `#${t.id} [${t.pillar}] ${t.description}${t.escalation_count > 0 ? ` (${t.escalation_count}x recordada)` : ''}`),
    tareas_completadas_hoy: completedToday.length,
    registros_hoy: todayLog.length,
  };

  const contexts = {

    morning: {
      type: 'morning_check',
      context: JSON.stringify({
        ...base,
        instruccion: 'Es la mañana. Saluda brevemente, recuérdale qué tiene hoy (rutinas, tareas pendientes). No hagas un listado enorme, solo lo más relevante.',
        rutinas_de_hoy: todayRoutines.map(r => `${r.name}: ${r.details || r.schedule}`),
        objetivos_activos: goals.map(g => `[${g.pillar}] ${g.title}: ${g.current_value}/${g.target_value}`),
      }),
    },

    lunch_check: {
      type: 'lunch_check',
      context: JSON.stringify({
        ...base,
        instruccion: 'Mediodía. Pregúntale si ya comió y qué comió. Si ya registró comida hoy, coméntalo. Sé breve.',
        comidas_registradas: mealsToday.map(m => m.content),
        ha_comido: mealsToday.length > 0,
      }),
    },

    afternoon_work: {
      type: 'afternoon_work_check',
      context: JSON.stringify({
        ...base,
        instruccion: 'Tarde. Pregúntale cómo va el trabajo/productividad. Mira la facturación de la semana. Sé breve.',
        facturacion_semana: db.getWeekRevenue(),
        objetivo_semana: config.week_revenue_goal,
        logs_trabajo: todayLog.filter(l => l.pillar === 'trabajo').map(l => l.content),
      }),
    },

    evening_check: {
      type: 'evening_check',
      context: JSON.stringify({
        ...base,
        instruccion: 'Noche. Pregúntale por la cena, tareas del hogar pendientes. Si no entrenó hoy y tocaba, menciónalo. Breve.',
        cena_registrada: todayLog.some(l => l.type === 'cena'),
        entreno_hoy: workoutsToday.length > 0,
        rutinas_hoy_que_tocaban: todayRoutines.map(r => r.name),
      }),
    },

    night_review: {
      type: 'night_review',
      context: JSON.stringify({
        ...base,
        instruccion: 'Cierre del día. Haz un mini resumen: qué hizo bien, qué quedó pendiente. Recuerda skincare si tiene esa rutina. No te enrolles.',
        todo_el_registro: todayLog.map(l => `[${l.pillar}] ${l.type}: ${l.content}`),
        completadas: completedToday.map(t => t.description),
        pendientes: pendingTasks.map(t => t.description),
      }),
    },

    friday_prep: {
      type: 'friday_prep',
      context: JSON.stringify({
        ...base,
        instruccion: 'Es viernes. Pregúntale qué planes tiene para el finde. Si tiene cita o salida, sugiere outfit y perfume de su inventario. Tono relajado.',
        perfumes: db.getInventory().filter(i => i.category === 'perfumes').map(i => i.name),
        ropa: db.getInventory().filter(i => i.category === 'ropa').map(i => `${i.name}${i.details ? ': ' + i.details : ''}`),
        facturacion_semana: db.getWeekRevenue(),
      }),
    },

    sunday_review: {
      type: 'sunday_review',
      context: JSON.stringify({
        ...base,
        instruccion: 'Domingo. Revisión semanal de los 3 pilares. Haz un balance breve y ayúdale a planificar la semana. No seas abrumador.',
        facturacion_semana: db.getWeekRevenue(),
        facturacion_mes: db.getMonthRevenue(),
        objetivos: goals.map(g => ({
          pilar: g.pillar, titulo: g.title,
          progreso: `${g.current_value}/${g.target_value} ${g.unit || ''}`,
          horizonte: g.horizon,
        })),
      }),
    },

    inactivity: {
      type: 'inactivity_nudge',
      context: JSON.stringify({
        ...base,
        instruccion: 'El usuario lleva horas sin escribir. Mándale un mensaje casual, breve. No seas dramático ni le eches la culpa. Solo un toque de "ey, qué tal".',
        horas_sin_hablar: config.inactivity_threshold_hours,
      }),
    },

    task_follow_up: {
      type: 'task_follow_up',
      context: JSON.stringify({
        ...base,
        instruccion: 'Seguimiento de una tarea. Pregunta si la hizo. Si ya la recordaste antes, sé más directo pero sin drama.',
      }),
    },
  };

  return contexts[triggerType] || {
    type: triggerType,
    context: JSON.stringify({
      ...base,
      instruccion: 'Genera un mensaje relevante para el momento actual.',
    }),
  };
}

module.exports = { buildTriggerContext };
