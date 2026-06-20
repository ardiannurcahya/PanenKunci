// loop.js — Keeps re-running register.js with proxy rotation & delays
const { spawn } = require('child_process');

// Add proxies here (one per line). Empty = no proxy.
const PROXIES = [
  // 'http://user:pass@ip:port',
  // 'http://user:pass@ip:port',
];

let count = 0;

function getProxy() {
  if (PROXIES.length === 0) return '';
  return PROXIES[count % PROXIES.length];
}

function run() {
  count++;
  const proxy = getProxy();
  console.log(`\n=== RUN #${count} ${proxy ? `(proxy: ${proxy.split('@').pop()})` : ''} ===\n`);

  const env = { ...process.env };
  if (proxy) env.PROXY = proxy;

  const child = spawn('node', ['register.js'], {
    stdio: 'inherit',
    cwd: __dirname,
    env,
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`\nRun #${count} completed.`);
    } else {
      console.log(`\nRun #${count} stopped (code ${code}).`);
    }
    const delay = 40000 + Math.floor(Math.random() * 30000);
    console.log(`Waiting ${Math.round(delay / 1000)}s before next run...\n`);
    setTimeout(run, delay);
  });
}

process.on('SIGINT', () => {
  console.log('\nStopped by user.');
  process.exit(0);
});

run();
