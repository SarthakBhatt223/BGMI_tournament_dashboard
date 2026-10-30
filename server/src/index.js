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

const { server, io, scheduler } = createApp({ db, config });

server.listen(config.port, config.host, () => {
  scheduler.start(); // a fresh countdown from now; appearances missed while the server was down are not replayed
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

// Open browser tabs keep Socket.IO and HTTP connections alive, and server.close() waits for all
// of them, so a plain close would hang forever. Disconnect everyone, close the database cleanly
// (this also removes the -wal / -shm files), and force-exit if something still blocks.
let shuttingDown = false;
function shutDown() {
  if (shuttingDown) {
    process.exit(1); // second Ctrl+C: leave immediately
  }
  shuttingDown = true;
  console.log('Shutting down...');
  scheduler.stop();
  setTimeout(() => process.exit(1), 5000).unref();
  io.close(() => {
    server.close(() => {
      db.close();
      console.log('Stopped. Database closed.');
      process.exit(0);
    });
    server.closeAllConnections();
  });
}
process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
