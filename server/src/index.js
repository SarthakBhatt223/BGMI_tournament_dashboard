import os from 'node:os';
import { createApp } from './app.js';
import { assertSafeNetworkConfig, loadServerConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { migrate } from './db/migrate.js';
import { seedDemoData } from './db/seed.js';

const config = loadServerConfig();
assertSafeNetworkConfig(config);

const db = openDatabase(config.databasePath);
migrate(db);
if (config.seedDemoData) {
  const result = seedDemoData(db);
  if (result.seeded) console.log(`Seeded ${result.teams} placeholder teams (SEED_DEMO_DATA=true).`);
}

const { server } = createApp({ db, config });

server.listen(config.port, config.host, () => {
  console.log(`Database:  ${config.databasePath}`);
  console.log(`Admin:     http://localhost:${config.port}/admin`);
  console.log(`Display:   http://localhost:${config.port}/display`);
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    for (const address of listLanAddresses()) {
      console.log(`LAN:       http://${address}:${config.port}/display   (admin: /admin, secret required)`);
    }
  }
  console.log('Note: the pages above are served by this process only after `npm run build`.');
  console.log('During development open the Vite address instead (http://localhost:5173/admin).');
});

function listLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

function shutDown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
