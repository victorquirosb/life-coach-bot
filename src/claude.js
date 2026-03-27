const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt } = require('./prompts/system');
const db = require('./database');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function chat(userMessage, triggerContext = null) {
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

  const systemPrompt = buildSystemPrompt(
    profile, goals, inventory, routines, tasks, todayLog, revenueData, config
  );

  // Construir mensajes con historial (filtrar vacíos y duplicados)
  const history = db.getRecentConversations(20);
  const messages = [];
  let lastRole = null;
  let lastContent = null;
  
  for (const h of history) {
    if (!h.content || h.content.trim() === '') continue;
    if (h.content === lastContent) continue;
    if (h.role === lastRole && messages.length > 0) {
      messages[messages.length - 1].content += '\n' + h.content;
      lastContent = h.content;
      continue;
    }
    messages.push({ role: h.role, content: h.content });
    lastRole = h.role;
    lastContent = h.content;
  }

  let fullMessage = userMessage;
  if (triggerContext) {
    fullMessage = `[CONTEXTO DEL SISTEMA - el bot está iniciando contacto proactivo]
Tipo de trigger: ${triggerContext.type}
Contexto: ${triggerContext.context}
HORA REAL ACTUAL: ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
[FIN CONTEXTO]

Genera un mensaje proactivo apropiado para este momento. NO digas que eres un bot ni 
que esto es automático. Escribe como si fueras un amigo que le escribe en ese momento.`;
  }

  if (fullMessage && fullMessage.trim() !== '') {
    messages.push({ role: 'user', content: fullMessage });
  } else {
    messages.push({ role: 'user', content: 'Genera un mensaje proactivo basado en el contexto actual del usuario.' });
  }

  // Asegurar que los mensajes alternan correctamente
  const cleanMessages = [];
  for (let i = 0; i < messages.length; i++) {
    if (i === 0 && messages[i].role === 'assistant') continue;
    if (cleanMessages.length > 0 && cleanMessages[cleanMessages.length - 1].role === messages[i].role) {
      cleanMessages[cleanMessages.length - 1].content += '\n' + messages[i].content;
    } else {
      cleanMessages.push({ ...messages[i] });
    }
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: cleanMessages,
    });

    const responseText = response.content[0].text;

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = { message: responseText, actions: [] };
      }
    }

    if (userMessage && userMessage.trim() !== '') {
      db.addConversation('user', userMessage);
    }
    db.addConversation('assistant', parsed.message);

    return parsed;

  } catch (error) {
    console.error('Error llamando a Claude:', error.message);
    return {
      message: 'Tengo un problema técnico ahora mismo. Dame un minuto y vuelve a intentarlo.',
      actions: [],
    };
  }
}

module.exports = { chat };