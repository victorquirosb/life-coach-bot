const { initDatabase } = require('../src/database');

async function setup() {
  await initDatabase();
  console.log('✅ Setup completado');
  process.exit(0);
}

setup().catch(console.error);
