require('dotenv').config();

const { createBot } = require('./bot');
const { startScheduler, setSendMessage } = require('./scheduler');

async function main() {
  console.log('🚀 Iniciando Life Coach Bot...\n');

  // 1. Crear el bot
  const bot = createBot();

  // 2. Configurar la función de envío de mensajes para el scheduler
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!chatId) {
    console.warn('⚠️ TELEGRAM_CHAT_ID no configurado.');
    console.warn('   Inicia el bot, envía /start, y luego configura el Chat ID.');
    console.warn('   Los mensajes proactivos no funcionarán hasta entonces.\n');
  }

  setSendMessage(async (message) => {
    if (!chatId) {
      console.warn('⚠️ No se puede enviar mensaje proactivo: CHAT_ID no configurado');
      return;
    }
    try {
      // Dividir si es muy largo
      if (message.length <= 4096) {
        await bot.api.sendMessage(chatId, message);
      } else {
        for (let i = 0; i < message.length; i += 4096) {
          await bot.api.sendMessage(chatId, message.substring(i, i + 4096));
        }
      }
    } catch (error) {
      console.error('❌ Error enviando mensaje proactivo:', error.message);
    }
  });

  // 3. Iniciar scheduler
  startScheduler();

  // 4. Iniciar bot
  console.log('\n🤖 Bot de Telegram iniciado. Esperando mensajes...\n');
  bot.start({
    onStart: () => console.log('✅ Bot conectado a Telegram'),
  });
}

main().catch(console.error);
