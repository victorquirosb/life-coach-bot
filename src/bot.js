const { Bot } = require('grammy');
const { chat } = require('./claude');
const { processActions } = require('./action-handler');
const { userResumed, userRequestedSilence } = require('./scheduler');
const db = require('./database');

function createBot() {
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '💪 ¡Vamos allá!\n\n' +
      'Soy tu coach personal. Voy a empujarte a ser la mejor versión de ti mismo ' +
      'en tres pilares: CUERPO, HOGAR y TRABAJO.\n\n' +
      'Para empezar, cuéntame sobre ti: objetivos, rutinas, inventario.\n' +
      'O simplemente háblame y vamos configurando sobre la marcha.'
    );
  });

  bot.command('status', async (ctx) => {
    const tasks = db.getTodayTasks();
    const todayLog = db.getTodayLog();
    const weekRevenue = db.getWeekRevenue();
    const goals = db.getActiveGoals();
    
    let status = '📊 ESTADO DEL DÍA\n\n';
    
    const pending = tasks.filter(t => t.status === 'pending');
    const done = tasks.filter(t => t.status === 'done');
    status += `Tareas completadas: ${done.length}\n`;
    status += `Tareas pendientes: ${pending.length}\n`;
    if (pending.length > 0) {
      status += pending.map(t => `  → ${t.description}`).join('\n') + '\n';
    }
    
    status += `\nRegistros hoy: ${todayLog.length}\n`;
    status += `\nFacturación semana: ${weekRevenue}€\n`;
    
    if (goals.length > 0) {
      status += '\nOBJETIVOS\n';
      goals.forEach(g => {
        const pct = g.target_value > 0 
          ? Math.round((g.current_value / g.target_value) * 100) 
          : 0;
        status += `  [${g.pillar.toUpperCase()}] ${g.title}: ${g.current_value}/${g.target_value} ${g.unit || ''} (${pct}%)\n`;
      });
    }
    
    await ctx.reply(status);
  });

  bot.command('semana', async (ctx) => {
    const response = await chat(
      'Dame un resumen completo de mi semana: logros, fallos, y qué tengo que mejorar.'
    );
    processActions(response.actions);
    await ctx.reply(response.message);
  });

  bot.command('config', async (ctx) => {
    await ctx.reply(
      'Dime qué quieres configurar:\n' +
      '• "Mi objetivo de facturación semanal es 2000€"\n' +
      '• "Voy al gym lunes, miércoles y viernes"\n' +
      '• "Mi dieta es: 2500 calorías, 180g proteína"\n' +
      '• "Tengo estos perfumes: Dior Sauvage, Bleu de Chanel"\n\n' +
      'Simplemente escríbeme y yo lo configuro.'
    );
  });

  bot.command('intensidad', async (ctx) => {
    const text = ctx.message.text.replace('/intensidad', '').trim();
    const levels = ['low', 'medium', 'high', 'savage'];
    
    if (levels.includes(text)) {
      db.setConfig('intensity', text);
      const msgs = {
        low: 'Modo suave activado. Te sugeriré cosas sin presionar.',
        medium: 'Modo medio. Directo pero empático.',
        high: 'Modo alto. Sin excusas, sin contemplaciones.',
        savage: 'Modo SAVAGE activado. Prepárate.',
      };
      await ctx.reply(msgs[text]);
    } else {
      await ctx.reply(
        'Elige tu nivel de intensidad:\n\n' +
        '/intensidad low → Suave\n' +
        '/intensidad medium → Directo\n' +
        '/intensidad high → Sin excusas\n' +
        '/intensidad savage → Drill sergeant'
      );
    }
  });

  bot.command('silencio', async (ctx) => {
    db.setConfig('silent_mode', 'true');
    userRequestedSilence();
    await ctx.reply('Modo silencio activado. No te enviaré mensajes hasta que pongas /activo');
  });

  bot.command('activo', async (ctx) => {
    db.setConfig('silent_mode', 'false');
    userResumed();
    await ctx.reply('De vuelta. Modo activo.');
  });

  // ---- FOTOS ----
  bot.on('message:photo', async (ctx) => {
    console.log('📸 Foto recibida');
    await ctx.replyWithChatAction('typing');
    
    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.api.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      
      const caption = ctx.message.caption || 'El usuario te envía esta foto. Si es un look/outfit, evalúalo del 1 al 10 y da feedback específico. Si es comida, estima macros. Si es otra cosa, comenta lo que veas relevante.';
      
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
            { type: 'text', text: caption }
          ]
        }],
      });
      
      const responseText = result.content[0].text;
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
      
      if (parsed.actions && parsed.actions.length > 0) {
        processActions(parsed.actions);
      }
      
      const message = parsed.message;
      if (message.length <= 4096) {
        await ctx.reply(message);
      } else {
        for (let i = 0; i < message.length; i += 4096) {
          await ctx.reply(message.substring(i, i + 4096));
        }
      }
      
      db.addConversation('user', '[FOTO] ' + caption);
      db.addConversation('assistant', parsed.message);
      
    } catch (error) {
      console.error('Error procesando foto:', error);
      await ctx.reply('No pude procesar la foto. Inténtalo de nuevo.');
    }
  });

  // ---- MENSAJES NORMALES ----
  bot.on('message:text', async (ctx) => {
    const userMessage = ctx.message.text;
    
    console.log(`📨 Mensaje recibido: ${userMessage.substring(0, 50)}...`);
    
    // Detectar si el usuario pide silencio o retoma
    const lower = userMessage.toLowerCase();
    if (lower.includes('para ya') || lower.includes('deja de') || lower.includes('no me escribas') || lower.includes('cállate') || lower.includes('silencio') || lower.includes('no me mandes')) {
      userRequestedSilence();
    } else {
      userResumed();
    }
    
    await ctx.replyWithChatAction('typing');
    
    const response = await chat(userMessage);
    
    if (response.actions && response.actions.length > 0) {
      console.log(`⚡ Procesando ${response.actions.length} acciones...`);
      processActions(response.actions);
    }
    
    const message = response.message;
    if (message.length <= 4096) {
      await ctx.reply(message);
    } else {
      for (let i = 0; i < message.length; i += 4096) {
        await ctx.reply(message.substring(i, i + 4096));
      }
    }
  });

  return bot;
}

module.exports = { createBot };
