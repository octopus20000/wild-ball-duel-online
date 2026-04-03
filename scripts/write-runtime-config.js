const fs = require('fs');
const path = require('path');

const serverUrl = process.env.APP_SERVER_URL || 'http://localhost:3000';
const output = {
  serverUrl,
  generatedAt: new Date().toISOString()
};
const outPath = path.join(__dirname, '..', 'electron', 'runtime-config.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log('Wrote runtime config to', outPath, 'with serverUrl =', serverUrl);
