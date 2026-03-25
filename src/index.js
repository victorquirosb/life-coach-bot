require('dotenv').config();

const { createBot } = require('./bot');
const { startScheduler, setSendMessage } = require('./scheduler');
const { initDatabase } = require('./database');

async function main() {
  console.log('🚀 Iniciando Life Coach Bot...\n');

  await initDatabase();

  const bot = createBot();

  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!chatId) {
    console.warn('⚠️ TELEGRAM_CHAT_ID no configurado.\n');
  }

  setSendMessage(async (message) => {
    if (!chatId) return;
    try {
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

  startScheduler();

  console.log('\n🤖 Bot de Telegram iniciado. Esperando mensajes...\n');
  bot.start({
    onStart: () => console.log('✅ Bot conectado a Telegram'),
  });
}

main().catch(console.error);
