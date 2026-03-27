const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt } = require('./prompts/system');
const db = require('./database');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Build clean message history for the API.
 * Rules:
 *  - No empty messages
 *  - No consecutive same-role messages (merge them)
 *  - No exact duplicate content in a row
 *  - Must start with 'user' role
 *  - Trim to reasonable token budget
 */
function buildMessageHistory(limit = 20) {
  const raw = db.getRecentConversations(limit);
  const messages = [];

  for (const h of raw) {
    const content = (h.content || '').trim();
    if (!content) continue;

    // Skip if exact same content as previous message
    if (messages.length > 0 && messages[messages.length - 1].content === content) continue;

    if (messages.length > 0 && messages[messages.length - 1].role === h.role) {
      // Merge consecutive same-role messages
      messages[messages.length - 1].content += '\n\n' + content;
    } else {
      messages.push({ role: h.role, content });
    }
  }

  // Ensure first message is from 'user' (API requirement)
  while (messages.length > 0 && messages[0].role !== 'user') {
    messages.shift();
  }

  return messages;
}

/**
 * Gather all context data for the system prompt.
 */
function gatherContext() {
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
  return { profile, goals, inventory, routines, tasks, todayLog, revenueData, config };
}

/**
 * Parse Claude's response — tries JSON, then fenced JSON, then plain text fallback.
 */
function parseResponse(text) {
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(text);
    if (parsed.message) return parsed;
  } catch (_) {}

  // Try fenced JSON block
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.message) return parsed;
    } catch (_) {}
  }

  // Try to find JSON object in text
  const braceMatch = text.match(/\{[\s\S]*"message"\s*:\s*"[\s\S]*?\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (parsed.message) return parsed;
    } catch (_) {}
  }

  // Fallback: treat entire text as message
  return { message: text, actions: [] };
}

/**
 * Main chat function.
 * @param {string} userMessage - User's message (empty string for proactive triggers)
 * @param {object|null} triggerContext - Context for proactive messages
 * @returns {object} { message, actions }
 */
async function chat(userMessage, triggerContext = null) {
  const ctx = gatherContext();
  const isProactive = !!triggerContext;
  const now = db.getNow();

  // Build extra context string for proactive triggers
  let extraContext = null;
  if (triggerContext) {
    extraContext = `Tipo: ${triggerContext.type}\n${triggerContext.context}\nHORA EXACTA: ${now.format('HH:mm')} — FECHA: ${now.format('DD/MM/YYYY')}`;
  }

  const systemPrompt = buildSystemPrompt(
    ctx.profile, ctx.goals, ctx.inventory, ctx.routines,
    ctx.tasks, ctx.todayLog, ctx.revenueData, ctx.config,
    extraContext
  );

  // Build message array
  const history = buildMessageHistory(20);

  // Add current message
  if (isProactive) {
    // For proactive: add a system-style user message that tells Claude this is a trigger
    const triggerMsg = `[TRIGGER PROACTIVO — ${triggerContext.type}]\n`
      + `El sistema te pide que generes un mensaje proactivo. Escribe como si le escribieras tú al usuario por iniciativa propia. No menciones que es un trigger automático.\n`
      + `Contexto: ${triggerContext.context}`;
    history.push({ role: 'user', content: triggerMsg });
  } else if (userMessage && userMessage.trim()) {
    history.push({ role: 'user', content: userMessage.trim() });
  } else {
    // Safety: never send empty user message
    history.push({ role: 'user', content: '(el usuario envió un mensaje vacío)' });
  }

  // Final cleanup: ensure alternation
  const cleanMessages = [];
  for (const msg of history) {
    if (!msg.content || !msg.content.trim()) continue;
    if (cleanMessages.length > 0 && cleanMessages[cleanMessages.length - 1].role === msg.role) {
      cleanMessages[cleanMessages.length - 1].content += '\n\n' + msg.content;
    } else {
      cleanMessages.push({ ...msg });
    }
  }

  // Ensure starts with user
  while (cleanMessages.length > 0 && cleanMessages[0].role !== 'user') {
    cleanMessages.shift();
  }

  // Must have at least one message
  if (cleanMessages.length === 0) {
    cleanMessages.push({ role: 'user', content: 'Hola' });
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: cleanMessages,
    });

    const responseText = response.content[0].text;
    const parsed = parseResponse(responseText);

    // Ensure actions is always an array
    if (!Array.isArray(parsed.actions)) parsed.actions = [];

    // Save to conversation history
    if (!isProactive && userMessage && userMessage.trim()) {
      db.addConversation('user', userMessage.trim(), false);
    }
    if (parsed.message && parsed.message.trim()) {
      db.addConversation('assistant', parsed.message.trim(), isProactive);
    }

    return parsed;

  } catch (error) {
    console.error('❌ Error llamando a Claude:', error.message);

    // If it's a content error, log more detail
    if (error.status === 400) {
      console.error('   Request had', cleanMessages.length, 'messages');
      console.error('   First role:', cleanMessages[0]?.role);
      console.error('   Last role:', cleanMessages[cleanMessages.length - 1]?.role);
    }

    return {
      message: 'Problema técnico. Dame un momento.',
      actions: [],
    };
  }
}

module.exports = { chat };
