// `npm run db:reset` - deletes the development database file so the next start is fresh.
// Refuses to run without --yes. Export a backup from /admin first if the data matters.
import fs from 'node:fs';
import { loadServerConfig } from '../config.js';

const config = loadServerConfig();

if (!process.argv.includes('--yes')) {
  console.error(`This permanently deletes ${config.databasePath}.`);
  console.error('Run again as: npm run db:reset -- --yes');
  process.exit(1);
}

for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(`${config.databasePath}${suffix}`, { force: true });
}
console.log(`Deleted ${config.databasePath}. It is recreated on the next server start.`);
