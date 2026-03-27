const cron = require('node-cron');
const dayjs = require('dayjs');
const db = require('./database');
const { chat } = require('./claude');
const { buildTriggerContext } = require('./context-builder');
const { processActions } = require('./action-handler');

let sendMessageFn = null;
let lastProactiveMessage = 0;
let proactiveCountToday = 0;
let lastProactiveDate = '';
let userSaidStop = false;

function setSendMessage(fn) {
  sendMessageFn = fn;
}

function userResumed() {
  userSaidStop = false;
}

function userRequestedSilence() {
  userSaidStop = true;
}

const MIN_INTERVAL_MS = 45 * 60 * 1000;
const MAX_PROACTIVE_PER_DAY = 8;

function canSendProactive() {
  const now = Date.now();
  const today = dayjs().format('YYYY-MM-DD');
  
  if (today !== lastProactiveDate) {
    proactiveCountToday = 0;
    lastProactiveDate = today;
  }
  
  if (userSaidStop) {
    console.log('🔇 Bloqueado: usuario pidió silencio');
    return false;
  }
  
  if (db.getConfig('silent_mode') === 'true') {
    console.log('🔇 Bloqueado: modo silencio activado');
    return false;
  }
  
  if (now - lastProactiveMessage < MIN_INTERVAL_MS) {
    const minutesLeft = Math.round((MIN_INTERVAL_MS - (now - lastProactiveMessage)) / 60000);
    console.log(`⏳ Bloqueado: faltan ${minutesLeft} min para poder enviar otro mensaje`);
    return false;
  }
  
  if (proactiveCountToday >= MAX_PROACTIVE_PER_DAY) {
    console.log('🚫 Bloqueado: límite diario alcanzado');
    return false;
  }
  
  return true;
}

function markProactiveSent() {
  lastProactiveMessage = Date.now();
  proactiveCountToday++;
  console.log(`📊 Mensajes proactivos hoy: ${proactiveCountToday}/${MAX_PROACTIVE_PER_DAY}`);
}

async function executeProactiveTrigger(triggerType, extraContext = null) {
  if (!canSendProactive()) return;

  console.log(`🔔 Ejecutando trigger: ${triggerType}`);
  
  const context = extraContext || buildTriggerContext(triggerType);
  
  const realTime = dayjs().format('HH:mm');
  const realDate = dayjs().format('DD/MM/YYYY');
  if (context && typeof context.context === 'string') {
    context.context = context.context + `\nHORA REAL ACTUAL: ${realTime}. FECHA: ${realDate}. USA ESTA HORA, NO INVENTES OTRA.`;
  }
  
  try {
    const response = await chat('', context);
    
    if (response.actions && response.actions.length > 0) {
      processActions(response.actions);
    }
    
    if (sendMessageFn && response.message) {
      await sendMessageFn(response.message);
      markProactiveSent();
    }
  } catch (error) {
    console.error(`❌ Error en trigger ${triggerType}:`, error.message);
  }
}

function startScheduler() {
  const config = db.getAllConfig();

  const [morningH, morningM] = (config.morning_time || '07:30').split(':');
  cron.schedule(`${morningM} ${morningH} * * *`, () => {
    executeProactiveTrigger('morning');
  });

  const [lunchH, lunchM] = (config.lunch_check || '13:30').split(':');
  cron.schedule(`${lunchM} ${lunchH} * * *`, () => {
    executeProactiveTrigger('lunch_check');
  });

  const [afterH, afterM] = (config.afternoon_check || '17:00').split(':');
  cron.schedule(`${afterM} ${afterH} * * *`, () => {
    executeProactiveTrigger('afternoon_work');
  });

  const [evenH, evenM] = (config.evening_check || '20:30').split(':');
  cron.schedule(`${evenM} ${evenH} * * *`, () => {
    executeProactiveTrigger('evening_check');
  });

  const [nightH, nightM] = (config.night_review || '23:00').split(':');
  cron.schedule(`${nightM} ${nightH} * * *`, () => {
    executeProactiveTrigger('night_review');
  });

  const [friH, friM] = (config.friday_prep || '18:00').split(':');
  cron.schedule(`${friM} ${friH} * * 5`, () => {
    executeProactiveTrigger('friday_prep');
  });

  const [sunH, sunM] = (config.sunday_review || '20:00').split(':');
  cron.schedule(`${sunM} ${sunH} * * 0`, () => {
    executeProactiveTrigger('sunday_review');
  });

  cron.schedule('* * * * *', async () => {
    const triggers = db.getPendingTriggers();
    
    for (const trigger of triggers) {
      db.markTriggerExecuted(trigger.id);
      
      if (trigger.type === 'task_follow_up' && trigger.task_status === 'done') {
        console.log(`⏭️ Follow-up de tarea #${trigger.task_id} omitido (ya completada)`);
        continue;
      }

      if (!canSendProactive()) {
        console.log(`⏭️ Trigger ${trigger.id} bloqueado por control de frecuencia`);
        continue;
      }

      const context = {
        type: trigger.type,
        context: trigger.context + (trigger.task_description 
          ? `\nTarea: "${trigger.task_description}"` 
          : ''),
      };

      await executeProactiveTrigger(trigger.type, context);
      break;
    }
  });

  cron.schedule('0 * * * *', () => {
    const thresholdHours = parseInt(config.inactivity_threshold_hours || '3');
    const lastMessage = db.getRecentConversations(1)[0];
    
    if (lastMessage) {
      const lastTime = dayjs(lastMessage.created_at);
      const hoursSince = dayjs().diff(lastTime, 'hour');
      
      const currentHour = dayjs().hour();
      if (hoursSince >= thresholdHours && currentHour >= 8 && currentHour <= 22) {
        executeProactiveTrigger('inactivity');
      }
    }
  });

  console.log('⏰ Scheduler iniciado con los siguientes horarios:');
  console.log(`   🌅 Buenos días: ${config.morning_time || '07:30'}`);
  console.log(`   🍽️  Almuerzo: ${config.lunch_check || '13:30'}`);
  console.log(`   💼 Trabajo: ${config.afternoon_check || '17:00'}`);
  console.log(`   🌙 Cena: ${config.evening_check || '20:30'}`);
  console.log(`   📊 Cierre: ${config.night_review || '23:00'}`);
  console.log(`   🎉 Viernes prep: ${config.friday_prep || '18:00'}`);
  console.log(`   📋 Domingo review: ${config.sunday_review || '20:00'}`);
  console.log(`   🔄 Triggers dinámicos: cada 1 min (max 1 por ciclo)`);
  console.log(`   👀 Detector inactividad: cada 1 hora`);
  console.log(`   ⚡ Límites: ${MAX_PROACTIVE_PER_DAY} msgs/día, ${MIN_INTERVAL_MS/60000} min entre msgs`);
}

module.exports = { startScheduler, setSendMessage, userResumed, userRequestedSilence };