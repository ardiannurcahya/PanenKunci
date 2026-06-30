// multi_loop.js — Runs multiple alibaba workers concurrently at different screen positions
const { spawn } = require('child_process');

// ==========================================
// CONFIGURATION
// ==========================================
const CONCURRENT_WORKERS = 6; // Jumlah worker yang berjalan bersamaan
const SCREEN_WIDTH = 2000;   // Lebar layar monitor Anda (sesuaikan, misal: 1920, 2560, 1366)
const SCREEN_HEIGHT = 1000;  // Tinggi layar monitor Anda (sesuaikan, misal: 1080, 1440, 768)

// Perhitungan pembagian grid layar (misal 2x2 untuk 4 worker)
const COLS = Math.ceil(Math.sqrt(CONCURRENT_WORKERS));
const ROWS = Math.ceil(CONCURRENT_WORKERS / COLS);
const WIDTH = Math.floor(SCREEN_WIDTH / COLS)*0.5;
const HEIGHT = Math.floor(SCREEN_HEIGHT / ROWS)*0.5;

console.log(`=== MULTI WORKER RUNNER ===`);
console.log(`Starting ${CONCURRENT_WORKERS} workers in a ${COLS}x${ROWS} grid.`);
console.log(`Each window size: ${WIDTH}x${HEIGHT} px\n`);

// List proxy untuk rotasi (opsional). Kosongkan array jika tidak pakai proxy.
const PROXIES = [
  // 'http://user:pass@ip:port',
  // 'http://user:pass@ip:port',
];

function getProxy(workerIndex) {
  if (PROXIES.length === 0) return '';
  return PROXIES[workerIndex % PROXIES.length];
}

function startWorker(index) {
  // Hitung posisi x, y di grid layar
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const x = col * WIDTH * 2;
  const y = row * HEIGHT * 2;

  const proxy = getProxy(index);
  const proxyText = proxy ? ` (Proxy: ${proxy.split('@').pop()})` : ' (No Proxy)';

  console.log(`[Worker #${index}] Spawning at position: X=${x}, Y=${y}${proxyText}...`);

  const env = { 
    ...process.env,
    WINDOW_X: String(x),
    WINDOW_Y: String(y),
    WINDOW_WIDTH: String(WIDTH),
    WINDOW_HEIGHT: String(HEIGHT)
  };
  if (proxy) env.PROXY = proxy;

  const child = spawn('node', ['register.js'], {
    stdio: 'inherit',
    cwd: __dirname,
    env,
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`\n[Worker #${index}] Completed registration successfully.`);
    } else {
      console.log(`\n[Worker #${index}] Terminated or failed (Exit code: ${code}).`);
    }

    const restartDelay = 5000 + Math.floor(Math.random() * 5000);
    console.log(`[Worker #${index}] Restarting in ${Math.round(restartDelay / 1000)}s...\n`);
    setTimeout(() => startWorker(index), restartDelay);
  });
}

// Menjalankan semua worker dengan stagger delay agar tidak tabrakan di awal
for (let i = 0; i < CONCURRENT_WORKERS; i++) {
  const spawnDelay = i * 4000; // jeda 4 detik antar worker
  setTimeout(() => startWorker(i), spawnDelay);
}

process.on('SIGINT', () => {
  console.log('\nAll workers stopped by user.');
  process.exit(0);
});
