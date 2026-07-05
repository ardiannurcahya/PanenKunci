// multi_loop_fireworks.js — Runs multiple Fireworks workers concurrently
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURATION
// ==========================================
const CONCURRENT_WORKERS = 1;

// List proxy untuk rotasi (opsional). Kosongkan array jika tidak pakai proxy.
const PROXIES = [
  // 'http://user:pass@ip:port',
  // 'http://user:pass@ip:port',
];

function getProxy(workerIndex) {
  if (PROXIES.length === 0) return '';
  return PROXIES[workerIndex % PROXIES.length];
}

// Load and split emails across workers
function loadAndSplitEmails() {
  const configPath = path.join(__dirname, '../../../data/config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const emails = raw.emails
    .split(',')
    .map(e => e.trim())
    .filter(e => e.length > 0);
  if (emails.length === 0) {
    console.error('No emails found in config.json');
    process.exit(1);
  }

  // Split emails into N chunks
  const chunks = Array.from({ length: CONCURRENT_WORKERS }, () => []);
  for (let i = 0; i < emails.length; i++) {
    chunks[i % CONCURRENT_WORKERS].push(emails[i]);
  }
  return { emails, chunks };
}

const { emails, chunks } = loadAndSplitEmails();

console.log(`=== FIREWORKS MULTI WORKER RUNNER ===`);
console.log(`Total emails: ${emails.length}`);
console.log(`Workers: ${CONCURRENT_WORKERS}`);
chunks.forEach((c, i) => console.log(`  Worker #${i}: ${c.length} emails`));
console.log('');

function startWorker(index) {
  const workerEmails = chunks[index];
  if (workerEmails.length === 0) {
    console.log(`[Worker #${index}] No emails assigned, skipping.`);
    return;
  }

  const proxy = getProxy(index);
  const proxyText = proxy ? ` (Proxy: ${proxy.split('@').pop()})` : ' (No Proxy)';
  const outputFile = path.join(__dirname, `../../../output/fireworks_worker_${index}.csv`);

  console.log(`[Worker #${index}] Spawning with ${workerEmails.length} emails${proxyText}...`);

  const env = {
    ...process.env,
    WORKER_ID: String(index),
    WORKER_EMAILS: workerEmails.join(','),
    WORKER_OUTPUT_FILE: outputFile,
  };
  if (proxy) env.PROXY = proxy;

  const child = spawn('node', ['register.js'], {
    stdio: 'inherit',
    cwd: __dirname,
    env,
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`\n[Worker #${index}] Completed successfully.`);
    } else {
      console.log(`\n[Worker #${index}] Terminated or failed (Exit code: ${code}).`);
    }

    const restartDelay = 5000 + Math.floor(Math.random() * 5000);
    console.log(`[Worker #${index}] Restarting in ${Math.round(restartDelay / 1000)}s...\n`);
    setTimeout(() => startWorker(index), restartDelay);
  });
}

// Menjalankan semua worker dengan stagger delay
for (let i = 0; i < CONCURRENT_WORKERS; i++) {
  const spawnDelay = i * 4000; // jeda 4 detik antar worker
  setTimeout(() => startWorker(i), spawnDelay);
}

process.on('SIGINT', () => {
  console.log('\nAll workers stopped by user.');
  process.exit(0);
});
