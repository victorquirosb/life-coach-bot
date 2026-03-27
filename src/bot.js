const { Bot } = require('grammy');
const { chat } = require('./claude');
const { processActions } = require('./action-handler');
const { userResumed, userRequestedSilence } = require('./scheduler');
const db = require('./database');

const SILENCE_PATTERNS = [
  'para ya', 'deja de', 'no me escribas', 'cállate', 'callate',
  'silencio', 'no me mandes', 'no me hables', 'déjame', 'dejame',
  'basta', 'stop', 'para de escribir',
];

function detectsSilence(text) {
  const lower = text.toLowerCase();
  return SILENCE_PATTERNS.some(p => lower.includes(p));
}

function createBot() {
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

  // --- Commands ---

  bot.command('start', async (ctx) => {
    await ctx.reply(
      'Vamos allá. Soy tu coach personal — cuerpo, hogar y trabajo.\n\n' +
      'Cuéntame sobre ti, tus objetivos, tus rutinas. O simplemente háblame y vamos sobre la marcha.'
    );
  });

  bot.command('status', async (ctx) => {
    const tasks = db.getTodayTasks();
    const todayLog = db.getTodayLog();
    const weekRevenue = db.getWeekRevenue();
    const goals = db.getActiveGoals();

    const pending = tasks.filter(t => t.status === 'pending');
    const done = tasks.filter(t => t.status === 'done');

    let status = `Estado del día (${db.getNow().format('HH:mm')})\n\n`;
    status += `Completadas: ${done.length} | Pendientes: ${pending.length}\n`;
    if (pending.length > 0) {
      status += pending.map(t => `  → ${t.description}`).join('\n') + '\n';
    }
    status += `\nRegistros hoy: ${todayLog.length}\n`;
    status += `Facturación semana: ${weekRevenue}€\n`;

    if (goals.length > 0) {
      status += '\nObjetivos:\n';
      goals.forEach(g => {
        const pct = g.target_value > 0 ? Math.round((g.current_value / g.target_value) * 100) : 0;
        status += `  [${g.pillar}] ${g.title}: ${g.current_value}/${g.target_value} ${g.unit || ''} (${pct}%)\n`;
      });
    }

    await ctx.reply(status);
  });

  bot.command('semana', async (ctx) => {
    await ctx.replyWithChatAction('typing');
    const response = await chat('Dame un resumen completo de mi semana: logros, fallos, y qué mejorar.');
    processActions(response.actions);
    await sendLongMessage(ctx, response.message);
  });

  bot.command('silencio', async (ctx) => {
    userRequestedSilence();
    await ctx.reply('Modo silencio. No te escribo hasta que pongas /activo o me hables.');
  });

  bot.command('activo', async (ctx) => {
    userResumed();
    await ctx.reply('De vuelta. Modo activo.');
  });

  bot.command('intensidad', async (ctx) => {
    const text = ctx.message.text.replace('/intensidad', '').trim();
    const levels = { low: 'Suave', medium: 'Directo', high: 'Sin excusas', savage: 'Sin piedad' };

    if (levels[text]) {
      db.setConfig('intensity', text);
      await ctx.reply(`Intensidad: ${levels[text]}.`);
    } else {
      await ctx.reply(
        'Elige nivel:\n' +
        '/intensidad low — Suave\n' +
        '/intensidad medium — Directo\n' +
        '/intensidad high — Sin excusas\n' +
        '/intensidad savage — Sin piedad'
      );
    }
  });

  bot.command('config', async (ctx) => {
    await ctx.reply(
      'Dime qué quieres configurar. Ejemplo:\n' +
      '"Mi objetivo de facturación semanal es 2000€"\n' +
      '"Voy al gym lunes, miércoles y viernes"\n' +
      '"Mi dieta: 2500 cal, 180g proteína"\n' +
      '"Tengo estos perfumes: Dior Sauvage, Bleu de Chanel"'
    );
  });

  // --- Photos ---

  bot.on('message:photo', async (ctx) => {
    console.log('📸 Foto recibida');
    await ctx.replyWithChatAction('typing');

    // User is active — clear silence
    userResumed();

    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.api.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      const caption = ctx.message.caption ||
        'Te envío esta foto. Si es un look, evalúalo. Si es comida, estima macros. Si es otra cosa, comenta.';

      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const { buildSystemPrompt } = require('./prompts/system');

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

      const result = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: caption },
          ],
        }],
      });

      const responseText = result.content[0].text;
      let parsed;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (jsonMatch) {
          try { parsed = JSON.parse(jsonMatch[1]); } catch { parsed = null; }
        }
        if (!parsed) parsed = { message: responseText, actions: [] };
      }

      if (parsed.actions?.length > 0) processActions(parsed.actions);

      db.addConversation('user', '[FOTO] ' + caption);
      db.addConversation('assistant', parsed.message);

      await sendLongMessage(ctx, parsed.message);

    } catch (error) {
      console.error('❌ Error procesando foto:', error.message);
      await ctx.reply('No pude procesar la foto. Inténtalo de nuevo.');
    }
  });

  // --- Text Messages ---

  bot.on('message:text', async (ctx) => {
    const userMessage = ctx.message.text;
    console.log(`📨 ${userMessage.substring(0, 60)}${userMessage.length > 60 ? '...' : ''}`);

    // Silence detection
    if (detectsSilence(userMessage)) {
      userRequestedSilence();
      // Still let Claude respond to the message
    } else {
      // Any message from user clears silence mode
      userResumed();
    }

    await ctx.replyWithChatAction('typing');

    const response = await chat(userMessage);

    if (response.actions?.length > 0) {
      console.log(`⚡ ${response.actions.length} acciones`);
      processActions(response.actions);
    }

    await sendLongMessage(ctx, response.message);
  });

  return bot;
}

/**
 * Send a message, splitting if needed for Telegram's 4096 char limit.
 */
async function sendLongMessage(ctx, message) {
  if (!message) return;
  if (message.length <= 4096) {
    await ctx.reply(message);
  } else {
    // Split at paragraph boundaries when possible
    const chunks = [];
    let remaining = message;
    while (remaining.length > 0) {
      if (remaining.length <= 4096) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf('\n\n', 4096);
      if (splitAt < 200) splitAt = remaining.lastIndexOf('\n', 4096);
      if (splitAt < 200) splitAt = remaining.lastIndexOf(' ', 4096);
      if (splitAt < 200) splitAt = 4096;
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  }
}

module.exports = { createBot };
