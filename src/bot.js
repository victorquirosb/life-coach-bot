const { Bot } = require('grammy');
const { chat } = require('./claude');
const { processActions } = require('./action-handler');
const db = require('./database');

function createBot() {
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

  // ---- COMANDOS ----

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '💪 ¡Vamos allá!\n\n' +
      'Soy tu coach personal. Voy a empujarte a ser la mejor versión de ti mismo ' +
      'en tres pilares: CUERPO, HOGAR y TRABAJO.\n\n' +
      'Para empezar, cuéntame:\n' +
      '1. ¿Cuáles son tus objetivos principales?\n' +
      '2. ¿Cómo es tu rutina actual de gym?\n' +
      '3. ¿Cuánto quieres facturar al mes?\n' +
      '4. ¿Qué perfumes/productos tienes?\n\n' +
      'O simplemente háblame y vamos configurando sobre la marcha.'
    );
  });

  bot.command('status', async (ctx) => {
    const tasks = db.getTodayTasks();
    const todayLog = db.getTodayLog();
    const weekRevenue = db.getWeekRevenue();
    const goals = db.getActiveGoals();
    
    let status = '📊 **ESTADO DEL DÍA**\n\n';
    
    // Tareas
    const pending = tasks.filter(t => t.status === 'pending');
    const done = tasks.filter(t => t.status === 'done');
    status += `✅ Tareas completadas: ${done.length}\n`;
    status += `⏳ Tareas pendientes: ${pending.length}\n`;
    if (pending.length > 0) {
      status += pending.map(t => `   → ${t.description}`).join('\n') + '\n';
    }
    
    // Registro
    status += `\n📝 Registros hoy: ${todayLog.length}\n`;
    
    // Facturación
    status += `\n💰 Facturación semana: ${weekRevenue}€\n`;
    
    // Objetivos
    if (goals.length > 0) {
      status += '\n🎯 **OBJETIVOS**\n';
      goals.forEach(g => {
        const pct = g.target_value > 0 
          ? Math.round((g.current_value / g.target_value) * 100) 
          : 0;
        status += `   [${g.pillar.toUpperCase()}] ${g.title}: ${g.current_value}/${g.target_value} ${g.unit || ''} (${pct}%)\n`;
      });
    }
    
    await ctx.reply(status, { parse_mode: 'Markdown' });
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
      '⚙️ **CONFIGURACIÓN**\n\n' +
      'Dime qué quieres configurar:\n' +
      '• "Mi objetivo de facturación semanal es 2000€"\n' +
      '• "Voy al gym lunes, miércoles y viernes"\n' +
      '• "Mi dieta es: 2500 calorías, 180g proteína"\n' +
      '• "Tengo estos perfumes: Dior Sauvage, Bleu de Chanel"\n' +
      '• "Quiero que me despiertes a las 7:00"\n\n' +
      'Simplemente escríbeme y yo lo configuro.',
      { parse_mode: 'Markdown' }
    );
  });

  bot.command('intensidad', async (ctx) => {
    const text = ctx.message.text.replace('/intensidad', '').trim();
    const levels = ['low', 'medium', 'high', 'savage'];
    
    if (levels.includes(text)) {
      db.setConfig('intensity', text);
      const msgs = {
        low: '😊 Modo suave activado. Te sugeriré cosas sin presionar.',
        medium: '💪 Modo medio. Directo pero empático.',
        high: '🔥 Modo alto. Sin excusas, sin contemplaciones.',
        savage: '☠️ Modo SAVAGE activado. Prepárate para sufrir.',
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
    await ctx.reply('🔇 Modo silencio activado. No te enviaré mensajes proactivos hasta que pongas /activo');
  });

  bot.command('activo', async (ctx) => {
    db.setConfig('silent_mode', 'false');
    await ctx.reply('🔔 ¡De vuelta! Modo activo. Vamos a por ello.');
  });

  // ---- MENSAJES NORMALES ----
  bot.on('message:text', async (ctx) => {
    const userMessage = ctx.message.text;
    
    console.log(`📨 Mensaje recibido: ${userMessage.substring(0, 50)}...`);
    
    // Mostrar "escribiendo..."
    await ctx.replyWithChatAction('typing');
    
    // Enviar a Claude
    const response = await chat(userMessage);
    
    // Procesar acciones
    if (response.actions && response.actions.length > 0) {
      console.log(`⚡ Procesando ${response.actions.length} acciones...`);
      processActions(response.actions);
    }
    
    // Responder
    // Telegram tiene límite de 4096 caracteres, dividir si es necesario
    const message = response.message;
    if (message.length <= 4096) {
      await ctx.reply(message);
    } else {
      // Dividir en chunks
      for (let i = 0; i < message.length; i += 4096) {
        await ctx.reply(message.substring(i, i + 4096));
      }
    }
  });

  return bot;
}

module.exports = { createBot };
