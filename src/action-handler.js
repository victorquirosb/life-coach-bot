const db = require('./database');
const dayjs = require('dayjs');

function processActions(actions) {
  if (!actions || !Array.isArray(actions)) return;

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'add_task': {
          const { pillar, description, follow_up_minutes, due_date } = action.data;
          const minutes = follow_up_minutes || action.data.followUpMinutes || action.data.follow_up || null;
          db.addTask(pillar || 'general', description, minutes, due_date || null);
          console.log(`  ✅ Tarea creada: ${description}${minutes ? ` (follow-up en ${minutes} min)` : ''}`);
          break;
        }

        case 'complete_task': {
          db.completeTask(action.data.task_id);
          console.log(`  ✅ Tarea completada: #${action.data.task_id}`);
          break;
        }

        case 'add_inventory': {
          const { category, name, details } = action.data;
          db.addInventory(category, name, details || '');
          console.log(`  ✅ Inventario: ${name} añadido a ${category}`);
          break;
        }

        case 'update_profile': {
          const { key, value, category } = action.data;
          db.setProfile(key, value, category || 'general');
          console.log(`  ✅ Perfil actualizado: ${key} = ${value}`);
          break;
        }

        case 'log_meal': {
          db.addLog('cuerpo', action.data.type || 'comida', action.data.content);
          console.log(`  ✅ Comida registrada: ${action.data.content}`);
          break;
        }

        case 'log_workout': {
          db.addLog('cuerpo', `workout_${action.data.type || 'general'}`, action.data.content);
          console.log(`  ✅ Entrenamiento registrado: ${action.data.type}`);
          break;
        }

        case 'log_revenue': {
          db.addRevenue(action.data.amount, action.data.description || '');
          console.log(`  ✅ Facturación: +${action.data.amount}€`);
          break;
        }

        case 'update_goal': {
          db.updateGoalProgress(action.data.goal_id, action.data.current_value);
          console.log(`  ✅ Objetivo #${action.data.goal_id} actualizado: ${action.data.current_value}`);
          break;
        }

        case 'set_config': {
          db.setConfig(action.data.key, action.data.value);
          console.log(`  ✅ Config: ${action.data.key} = ${action.data.value}`);
          break;
        }

        case 'add_routine': {
          const { pillar, name, schedule, details } = action.data;
          db.addRoutine(pillar, name, schedule, details || '');
          console.log(`  ✅ Rutina creada: ${name}`);
          break;
        }

        default:
          console.log(`  ⚠️ Acción desconocida: ${action.type}`);
      }
    } catch (error) {
      console.error(`  ❌ Error procesando acción ${action.type}:`, error.message);
    }
  }
}

module.exports = { processActions };