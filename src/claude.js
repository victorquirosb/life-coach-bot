const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt } = require('./prompts/system');
const db = require('./database');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function chat(userMessage, triggerContext = null) {
  // 1. Recopilar todo el contexto
  const profile = db.getProfile();
  const goals = db.getActiveGoals();
  const inventory = db.getInventory();
  const routines = db.getRoutines();
  const tasks = db.getTodayTasks();
  const todayLog = db.getTodayLog();
  const config = db.getAllConfig();
  
  const revenueData = {
    weekTotal: db.getWeekRevenue(),
    monthTotal: db.getMonthRevenue(),
    weekGoal: config.week_revenue_goal || null,
    monthGoal: config.month_revenue_goal || null,
  };

  // 2. Construir system prompt
  const systemPrompt = buildSystemPrompt(
    profile, goals, inventory, routines, tasks, todayLog, revenueData, config
  );

  // 3. Construir mensajes con historial
  const history = db.getRecentConversations(20);
  const messages = history.map(h => ({
    role: h.role,
    content: h.content,
  }));

  // Añadir contexto del trigger si es proactivo
  let fullMessage = userMessage;
  if (triggerContext) {
    fullMessage = `[CONTEXTO DEL SISTEMA - el bot está iniciando contacto proactivo]
Tipo de trigger: ${triggerContext.type}
Contexto: ${triggerContext.context}
[FIN CONTEXTO]

Genera un mensaje proactivo apropiado para este momento. NO digas que eres un bot ni 
que esto es automático. Escribe como si fueras un amigo que le escribe en ese momento.`;
  }

  messages.push({ role: 'user', content: fullMessage });

  // 4. Llamar a Claude
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages,
    });

    const responseText = response.content[0].text;

    // 5. Parsear respuesta JSON
    let parsed;
    try {
      // Intentar parsear directamente
      parsed = JSON.parse(responseText);
    } catch {
      // Si falla, intentar extraer JSON del texto
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        // Fallback: devolver el texto como mensaje
        parsed = { message: responseText, actions: [] };
      }
    }

    // 6. Guardar en historial
    db.addConversation('user', userMessage);
    db.addConversation('assistant', parsed.message);

    return parsed;

  } catch (error) {
    console.error('Error llamando a Claude:', error);
    return {
      message: 'Tengo un problema técnico ahora mismo. Dame un minuto y vuelve a intentarlo.',
      actions: [],
    };
  }
}

module.exports = { chat };
