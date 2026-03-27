const db = require('./database');

/**
 * Process actions from Claude's response.
 * Enforces: max 1 follow-up (add_task with follow_up_minutes) per batch.
 */
function processActions(actions) {
  if (!actions || !Array.isArray(actions)) return;

  let followUpCreated = false;

  for (const action of actions) {
    try {
      switch (action.type) {

        case 'add_task': {
          const d = action.data || {};
          const pillar = d.pillar || 'general';
          const description = d.description || '';
          const priority = d.priority || 5;
          const dueDate = d.due_date || null;

          if (!description) {
            console.log('  ⚠️ add_task sin descripción, ignorada');
            break;
          }

          // Extract follow_up_minutes from various possible field names
          let followUp = d.follow_up_minutes || d.followUpMinutes || d.follow_up || null;

          // Enforce: only 1 follow-up per response batch
          if (followUp && followUpCreated) {
            console.log(`  ⚠️ Follow-up extra ignorado (ya se creó uno): "${description}"`);
            followUp = null;
          }

          // Enforce: don't create follow-ups if too many are pending
          if (followUp) {
            const pendingCount = db.countPendingTriggers();
            if (pendingCount >= 5) {
              console.log(`  ⚠️ Follow-up ignorado (${pendingCount} triggers pendientes): "${description}"`);
              followUp = null;
            }
          }

          // Enforce minimum follow-up time of 10 minutes
          if (followUp && followUp < 10) {
            followUp = 10;
          }

          db.addTask(pillar, description, followUp, dueDate, priority);

          if (followUp) followUpCreated = true;

          console.log(`  ✅ Tarea: "${description}"${followUp ? ` (follow-up ${followUp}min)` : ''}`);
          break;
        }

        case 'complete_task': {
          const taskId = action.data?.task_id;
          if (taskId) {
            db.completeTask(taskId);
            console.log(`  ✅ Tarea #${taskId} completada`);
          }
          break;
        }

        case 'add_inventory': {
          const { category, name, details } = action.data || {};
          if (category && name) {
            db.addInventory(category, name, details || '');
            console.log(`  ✅ Inventario: ${name} → ${category}`);
          }
          break;
        }

        case 'update_profile': {
          const { key, value, category } = action.data || {};
          if (key && value) {
            db.setProfile(key, value, category || 'general');
            console.log(`  ✅ Perfil: ${key} = ${value}`);
          }
          break;
        }

        case 'log_meal': {
          const d = action.data || {};
          if (d.content) {
            db.addLog('cuerpo', d.type || 'comida', d.content);
            console.log(`  ✅ Comida: ${d.content.substring(0, 50)}`);
          }
          break;
        }

        case 'log_workout': {
          const d = action.data || {};
          if (d.content || d.type) {
            db.addLog('cuerpo', `workout_${d.type || 'general'}`, d.content || d.type);
            console.log(`  ✅ Entreno: ${d.type || 'general'}`);
          }
          break;
        }

        case 'log_revenue': {
          const d = action.data || {};
          if (d.amount) {
            db.addRevenue(d.amount, d.description || '');
            console.log(`  ✅ Facturación: +${d.amount}€`);
          }
          break;
        }

        case 'update_goal': {
          const d = action.data || {};
          if (d.goal_id && d.current_value !== undefined) {
            db.updateGoalProgress(d.goal_id, d.current_value);
            console.log(`  ✅ Objetivo #${d.goal_id}: ${d.current_value}`);
          }
          break;
        }

        case 'add_goal': {
          const d = action.data || {};
          if (d.pillar && d.title && d.target_value) {
            db.addGoal(
              d.pillar, d.title, d.target_value,
              d.unit || '', d.frequency || 'weekly',
              d.description || '', d.horizon || 'short'
            );
            console.log(`  ✅ Objetivo creado: ${d.title}`);
          }
          break;
        }

        case 'set_config': {
          const d = action.data || {};
          if (d.key && d.value !== undefined) {
            db.setConfig(d.key, d.value);
            console.log(`  ✅ Config: ${d.key} = ${d.value}`);
          }
          break;
        }

        case 'add_routine': {
          const d = action.data || {};
          if (d.name && d.schedule) {
            db.addRoutine(d.pillar || 'general', d.name, d.schedule, d.details || '');
            console.log(`  ✅ Rutina: ${d.name}`);
          }
          break;
        }

        default:
          console.log(`  ⚠️ Acción desconocida: ${action.type}`);
      }
    } catch (error) {
      console.error(`  ❌ Error en acción ${action.type}:`, error.message);
    }
  }
}

module.exports = { processActions };
