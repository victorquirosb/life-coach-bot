const cron = require('node-cron');
const dayjs = require('dayjs');
const db = require('./database');
const { chat } = require('./claude');
const { buildTriggerContext } = require('./context-builder');
const { processActions } = require('./action-handler');

let sendMessageFn = null;

function setSendMessage(fn) {
  sendMessageFn = fn;
}

/**
 * Check if silent mode is active (persistent in DB).
 */
function isSilent() {
  return db.getConfig('silent_mode') === 'true';
}

/**
 * User requested silence — persist in DB.
 */
function userRequestedSilence() {
  db.setConfig('silent_mode', 'true');
  console.log('🔇 Modo silencio activado (persistente)');
}

/**
 * User resumed — clear silence mode.
 */
function userResumed() {
  if (db.getConfig('silent_mode') === 'true') {
    db.setConfig('silent_mode', 'false');
    console.log('🔊 Modo silencio desactivado');
  }
}

/**
 * Determine if we can send a proactive message right now.
 * All checks are persistent (survive redeploys).
 */
function canSendProactive() {
  // 1. Silent mode
  if (isSilent()) {
    console.log('🔇 Bloqueado: modo silencio');
    return false;
  }

  // 2. Time window — only send between 7:00 and 23:30 user time
  const now = db.getNow();
  const hour = now.hour();
  const minute = now.minute();
  if (hour < 7 || (hour === 23 && minute > 30) || hour >= 24) {
    console.log('🌙 Bloqueado: fuera de horario (7:00-23:30)');
    return false;
  }

  // 3. Minimum interval between proactive messages
  const minInterval = parseInt(db.getConfig('min_interval_minutes') || '45');
  const lastTime = db.getLastProactiveTime();
  if (lastTime) {
    const diffMinutes = now.diff(lastTime, 'minute');
    if (diffMinutes < minInterval) {
      console.log(`⏳ Bloqueado: ${minInterval - diffMinutes} min restantes para próximo mensaje`);
      return false;
    }
  }

  // 4. Daily limit
  const maxPerDay = parseInt(db.getConfig('max_proactive_per_day') || '8');
  const todayCount = db.getProactiveCountToday();
  if (todayCount >= maxPerDay) {
    console.log(`🚫 Bloqueado: límite diario alcanzado (${todayCount}/${maxPerDay})`);
    return false;
  }

  // 5. Don't spam if user hasn't responded to last 2 proactive messages
  const unanswered = db.getUnansweredProactiveCount();
  if (unanswered >= 2) {
    console.log(`🤐 Bloqueado: ${unanswered} mensajes proactivos sin respuesta`);
    return false;
  }

  return true;
}

/**
 * Send a proactive message.
 */
async function executeProactiveTrigger(triggerType, extraContext = null) {
  if (!canSendProactive()) return;
  if (!sendMessageFn) return;

  console.log(`🔔 Ejecutando trigger: ${triggerType}`);

  const context = extraContext || buildTriggerContext(triggerType);

  try {
    const response = await chat('', context);

    if (response.actions && response.actions.length > 0) {
      processActions(response.actions);
    }

    if (response.message && response.message.trim()) {
      await sendMessageFn(response.message);
      db.logProactiveMessage(triggerType);
      const count = db.getProactiveCountToday();
      const max = parseInt(db.getConfig('max_proactive_per_day') || '8');
      console.log(`📊 Proactivos hoy: ${count}/${max}`);
    }
  } catch (error) {
    console.error(`❌ Error en trigger ${triggerType}:`, error.message);
  }
}

/**
 * Start all scheduled jobs.
 * All cron times are in the user's timezone (Atlantic/Canary).
 */
function startScheduler() {
  const config = db.getAllConfig();
  const tz = db.TZ;

  // --- Fixed daily triggers ---

  const scheduleDaily = (configKey, defaultTime, triggerType) => {
    const [h, m] = (config[configKey] || defaultTime).split(':');
    cron.schedule(`${m} ${h} * * *`, () => executeProactiveTrigger(triggerType), { timezone: tz });
  };

  scheduleDaily('morning_time', '07:30', 'morning');
  scheduleDaily('lunch_check', '13:30', 'lunch_check');
  scheduleDaily('afternoon_check', '17:00', 'afternoon_work');
  scheduleDaily('evening_check', '20:30', 'evening_check');
  scheduleDaily('night_review', '23:00', 'night_review');

  // Friday prep
  const [friH, friM] = (config.friday_prep || '18:00').split(':');
  cron.schedule(`${friM} ${friH} * * 5`, () => executeProactiveTrigger('friday_prep'), { timezone: tz });

  // Sunday review
  const [sunH, sunM] = (config.sunday_review || '20:00').split(':');
  cron.schedule(`${sunM} ${sunH} * * 0`, () => executeProactiveTrigger('sunday_review'), { timezone: tz });

  // --- Dynamic trigger processor (every 2 minutes) ---
  cron.schedule('*/2 * * * *', async () => {
    if (isSilent()) return;

    const triggers = db.getPendingTriggers();
    if (triggers.length === 0) return;

    // Process at most 1 trigger per cycle
    for (const trigger of triggers) {
      db.markTriggerExecuted(trigger.id);

      // Skip completed task follow-ups
      if (trigger.type === 'task_follow_up' && trigger.task_status === 'done') {
        console.log(`⏭️ Follow-up de tarea #${trigger.task_id} omitido (completada)`);
        continue;
      }

      if (!canSendProactive()) {
        console.log(`⏭️ Trigger ${trigger.id} bloqueado por control de frecuencia`);
        continue;
      }

      // Build context with task info
      let contextStr = trigger.context || '';
      if (trigger.task_description) {
        contextStr += `\nTarea: "${trigger.task_description}"`;
      }
      if (trigger.task_escalation !== undefined && trigger.task_escalation !== null) {
        contextStr += `\nVeces recordada: ${trigger.task_escalation}`;
        // Escalate the task
        if (trigger.task_id) db.escalateTask(trigger.task_id);
      }

      const context = { type: trigger.type, context: contextStr };
      await executeProactiveTrigger(trigger.type, context);

      // Only process one per cycle
      break;
    }
  }, { timezone: tz });

  // --- Inactivity detector (every hour) ---
  cron.schedule('0 * * * *', () => {
    if (isSilent()) return;

    const thresholdHours = parseInt(config.inactivity_threshold_hours || '3');
    const recent = db.getRecentConversations(1);
    const lastMsg = recent[recent.length - 1]; // most recent

    if (!lastMsg) return;

    const now = db.getNow();
    const lastTime = dayjs.tz(lastMsg.created_at, db.TZ);
    const hoursSince = now.diff(lastTime, 'hour');
    const currentHour = now.hour();

    // Only during waking hours, and only if enough time has passed
    if (hoursSince >= thresholdHours && currentHour >= 8 && currentHour <= 22) {
      executeProactiveTrigger('inactivity');
    }
  }, { timezone: tz });

  // --- Log schedule ---
  console.log('⏰ Scheduler iniciado (zona: Atlantic/Canary):');
  console.log(`   🌅 Buenos días: ${config.morning_time || '07:30'}`);
  console.log(`   🍽️  Almuerzo: ${config.lunch_check || '13:30'}`);
  console.log(`   💼 Trabajo: ${config.afternoon_check || '17:00'}`);
  console.log(`   🌙 Noche: ${config.evening_check || '20:30'}`);
  console.log(`   📊 Cierre: ${config.night_review || '23:00'}`);
  console.log(`   🎉 Viernes: ${config.friday_prep || '18:00'}`);
  console.log(`   📋 Domingo: ${config.sunday_review || '20:00'}`);
  console.log(`   🔄 Triggers dinámicos: cada 2 min (max 1 por ciclo)`);
  console.log(`   ⚡ Límites: ${config.max_proactive_per_day || 8} msgs/día, ${config.min_interval_minutes || 45} min entre msgs`);
}

module.exports = { startScheduler, setSendMessage, userResumed, userRequestedSilence };
