import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
const envFile = new URL('./.env', import.meta.url);
if (fs.existsSync(envFile)) {
  console.error('.env already exists. Rename it yourself if you want to reset credentials.');
  process.exit(1);
}
const rl = readline.createInterface({ input, output });
const username = (await rl.question('Admin username [admin]: ')).trim() || 'admin';
const password = await rl.question('Admin password (12+ characters): ');
const origin = (await rl.question('Public relay HTTPS URL (blank for localhost testing): ')).trim();
const githubOrigin = (await rl.question('GitHub Pages origin (e.g. https://rustinplays.github.io, blank to skip): ')).trim();
rl.close();
if (!/^[A-Za-z0-9_.-]{3,40}$/.test(username) || password.length < 12 || (origin && !/^https:\/\/[^\s/]+\/?$/.test(origin)) || (githubOrigin && !/^https:\/\/[^\s/]+\/?$/.test(githubOrigin))) {
  console.error('Invalid username, password too short, or invalid HTTPS URL.');
  process.exit(1);
}
const salt = crypto.randomBytes(24).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
const secret = crypto.randomBytes(32).toString('hex');
const esc = s => JSON.stringify(s);
const content = `PORT=8787\nPUBLIC_ORIGIN=${esc(origin.replace(/\/$/, ''))}\nWEB_ORIGINS=${esc(githubOrigin.replace(/\/$/, ''))}\nADMIN_USERNAME=${esc(username)}\nADMIN_PASSWORD_SALT=${salt}\nADMIN_PASSWORD_HASH=${hash}\nSESSION_SECRET=${secret}\n`;
fs.writeFileSync(envFile, content, { mode: 0o600, flag: 'wx' });
console.log('Saved .env. Your password is not stored as plain text. Run: npm start');
