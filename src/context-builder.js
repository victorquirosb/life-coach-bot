const dayjs = require('dayjs');
const db = require('./database');

function buildTriggerContext(triggerType) {
  const now = dayjs();
  const config = db.getAllConfig();
  const pendingTasks = db.getPendingTasks();
  const todayLog = db.getTodayLog();
  const goals = db.getActiveGoals();

  const contexts = {
    // ---- MAÑANA ----
    morning: {
      type: 'morning_check',
      context: JSON.stringify({
        description: 'Check-in matutino. Revisar rutina del día, recordar objetivos, motivar.',
        pending_tasks: pendingTasks.map(t => t.description),
        todays_workouts: db.getRoutines().filter(r => {
          // Filtrar rutinas que corresponden a hoy
          const today = now.format('dddd').toLowerCase();
          return r.schedule.toLowerCase().includes(today);
        }).map(r => r.name + ': ' + r.details),
        logged_today: todayLog.length,
      }),
    },

    // ---- CHECK DE ALMUERZO ----
    lunch_check: {
      type: 'lunch_check',
      context: JSON.stringify({
        description: 'Preguntar si almorzó y qué comió. Validar contra la dieta.',
        meals_logged: todayLog.filter(l => l.type === 'almuerzo' || l.type === 'comida').length,
        has_eaten: todayLog.some(l => l.type === 'almuerzo' || l.type === 'comida'),
      }),
    },

    // ---- CHECK DE TARDE (TRABAJO) ----
    afternoon_work: {
      type: 'afternoon_work_check',
      context: JSON.stringify({
        description: 'Revisar productividad y facturación del día.',
        week_revenue: db.getWeekRevenue(),
        week_goal: config.week_revenue_goal,
        month_revenue: db.getMonthRevenue(),
        work_logs: todayLog.filter(l => l.pillar === 'trabajo').map(l => l.content),
      }),
    },

    // ---- CHECK DE CENA ----
    evening_check: {
      type: 'evening_check',
      context: JSON.stringify({
        description: 'Preguntar por cena, tareas pendientes del hogar, preparación para mañana.',
        pending_tasks: pendingTasks.map(t => `[${t.pillar}] ${t.description}`),
        dinner_logged: todayLog.some(l => l.type === 'cena'),
        workout_done: todayLog.some(l => l.pillar === 'cuerpo' && l.type.includes('workout')),
      }),
    },

    // ---- REVISIÓN NOCTURNA ----
    night_review: {
      type: 'night_review',
      context: JSON.stringify({
        description: 'Cierre del día. Resumen de logros, tareas incompletas, preparar mañana.',
        all_logs: todayLog.map(l => `[${l.pillar}] ${l.type}: ${l.content}`),
        completed_tasks: db.getTodayTasks().filter(t => t.status === 'done').length,
        pending_tasks: pendingTasks.length,
        goals_progress: goals.map(g => ({
          title: g.title,
          progress: `${g.current_value}/${g.target_value}`,
        })),
      }),
    },

    // ---- VIERNES NOCHE ----
    friday_prep: {
      type: 'friday_prep',
      context: JSON.stringify({
        description: 'Es viernes. Preguntar por planes de fin de semana, sugerir outfit y perfume.',
        inventory_perfumes: db.getInventory().filter(i => i.category === 'perfumes'),
        inventory_ropa: db.getInventory().filter(i => i.category === 'ropa'),
        week_summary: {
          revenue: db.getWeekRevenue(),
          workouts: todayLog.filter(l => l.pillar === 'cuerpo').length,
        },
      }),
    },

    // ---- DOMINGO REVISIÓN SEMANAL ----
    sunday_review: {
      type: 'sunday_review',
      context: JSON.stringify({
        description: 'Revisión semanal completa. Balance de los 3 pilares. Planificar semana.',
        week_revenue: db.getWeekRevenue(),
        goals: goals.map(g => ({
          pillar: g.pillar,
          title: g.title,
          progress: `${g.current_value}/${g.target_value} ${g.unit || ''}`,
        })),
      }),
    },

    // ---- INACTIVIDAD ----
    inactivity: {
      type: 'inactivity_nudge',
      context: JSON.stringify({
        description: 'El usuario lleva horas sin escribir. Mandar un empujón.',
        hours_silent: config.inactivity_threshold_hours,
        pending_tasks: pendingTasks.map(t => t.description),
      }),
    },

    // ---- SEGUIMIENTO DE TAREA ----
    task_follow_up: {
      type: 'task_follow_up',
      context: 'Se pasó el tiempo del follow-up de una tarea.',
    },
  };

  return contexts[triggerType] || {
    type: triggerType,
    context: JSON.stringify({ description: 'Trigger genérico' }),
  };
}

module.exports = { buildTriggerContext };
