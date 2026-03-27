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
    console.warn('⚠️ TELEGRAM_CHAT_ID no configurado — mensajes proactivos desactivados.');
  }

  setSendMessage(async (message) => {
    if (!chatId || !message) return;
    try {
      if (message.length <= 4096) {
        await bot.api.sendMessage(chatId, message);
      } else {
        // Split long messages
        for (let i = 0; i < message.length; i += 4096) {
          await bot.api.sendMessage(chatId, message.substring(i, i + 4096));
        }
      }
    } catch (error) {
      console.error('❌ Error enviando mensaje proactivo:', error.message);
    }
  });

  startScheduler();

  console.log('\n🤖 Bot listo. Esperando mensajes...\n');
  bot.start({
    onStart: () => console.log('✅ Conectado a Telegram'),
  });
}

main().catch((err) => {
  console.error('💀 Error fatal al iniciar:', err);
  process.exit(1);
});
