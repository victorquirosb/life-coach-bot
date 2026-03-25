const cron = require('node-cron');
const dayjs = require('dayjs');
const db = require('./database');
const { chat } = require('./claude');
const { buildTriggerContext } = require('./context-builder');
const { processActions } = require('./action-handler');

let sendMessageFn = null; // Se inyecta desde index.js

function setSendMessage(fn) {
  sendMessageFn = fn;
}

async function executeProactiveTrigger(triggerType, extraContext = null) {
  // Verificar modo silencio
  if (db.getConfig('silent_mode') === 'true') {
    console.log(`🔇 Trigger ${triggerType} suprimido (modo silencio)`);
    return;
  }

  console.log(`🔔 Ejecutando trigger: ${triggerType}`);
  
  const context = extraContext || buildTriggerContext(triggerType);
  
  try {
    const response = await chat('', context);
    
    // Procesar acciones
    if (response.actions && response.actions.length > 0) {
      processActions(response.actions);
    }
    
    // Enviar mensaje al usuario
    if (sendMessageFn && response.message) {
      await sendMessageFn(response.message);
    }
  } catch (error) {
    console.error(`❌ Error en trigger ${triggerType}:`, error);
  }
}

function startScheduler() {
  const config = db.getAllConfig();

  // ================================
  // TRIGGERS FIJOS (CRON JOBS)
  // ================================

  // Mensaje de buenos días
  const [morningH, morningM] = (config.morning_time || '07:30').split(':');
  cron.schedule(`${morningM} ${morningH} * * *`, () => {
    executeProactiveTrigger('morning');
  });

  // Check de almuerzo
  const [lunchH, lunchM] = (config.lunch_check || '13:30').split(':');
  cron.schedule(`${lunchM} ${lunchH} * * *`, () => {
    executeProactiveTrigger('lunch_check');
  });

  // Check de trabajo (tarde)
  const [afterH, afterM] = (config.afternoon_check || '17:00').split(':');
  cron.schedule(`${afterM} ${afterH} * * *`, () => {
    executeProactiveTrigger('afternoon_work');
  });

  // Check de cena
  const [evenH, evenM] = (config.evening_check || '20:30').split(':');
  cron.schedule(`${evenM} ${evenH} * * *`, () => {
    executeProactiveTrigger('evening_check');
  });

  // Revisión nocturna
  const [nightH, nightM] = (config.night_review || '23:00').split(':');
  cron.schedule(`${nightM} ${nightH} * * *`, () => {
    executeProactiveTrigger('night_review');
  });

  // Viernes prep (solo viernes)
  const [friH, friM] = (config.friday_prep || '18:00').split(':');
  cron.schedule(`${friM} ${friH} * * 5`, () => {
    executeProactiveTrigger('friday_prep');
  });

  // Domingo review (solo domingos)
  const [sunH, sunM] = (config.sunday_review || '20:00').split(':');
  cron.schedule(`${sunM} ${sunH} * * 0`, () => {
    executeProactiveTrigger('sunday_review');
  });

  // ================================
  // VERIFICADOR DE TRIGGERS DINÁMICOS
  // (cada 2 minutos revisa si hay algo pendiente)
  // ================================
  cron.schedule('*/2 * * * *', async () => {
    const triggers = db.getPendingTriggers();
    
    for (const trigger of triggers) {
      // Marcar como ejecutado primero (evitar duplicados)
      db.markTriggerExecuted(trigger.id);
      
      // Si es follow-up de tarea y la tarea ya está completada, skip
      if (trigger.type === 'task_follow_up' && trigger.task_status === 'done') {
        console.log(`⏭️ Follow-up de tarea #${trigger.task_id} omitido (ya completada)`);
        continue;
      }

      const context = {
        type: trigger.type,
        context: trigger.context + (trigger.task_description 
          ? `\nTarea: "${trigger.task_description}"` 
          : ''),
      };

      await executeProactiveTrigger(trigger.type, context);
    }
  });

  // ================================
  // DETECTOR DE INACTIVIDAD
  // (cada 30 minutos revisa si el usuario está inactivo)
  // ================================
  cron.schedule('*/30 * * * *', () => {
    const thresholdHours = parseInt(config.inactivity_threshold_hours || '3');
    const lastMessage = db.getRecentConversations(1)[0];
    
    if (lastMessage) {
      const lastTime = dayjs(lastMessage.created_at);
      const hoursSince = dayjs().diff(lastTime, 'hour');
      
      // Solo entre las 8:00 y las 22:00, y si han pasado suficientes horas
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
  console.log(`   🔄 Triggers dinámicos: cada 2 min`);
  console.log(`   👀 Detector inactividad: cada 30 min`);
}

module.exports = { startScheduler, setSendMessage };
