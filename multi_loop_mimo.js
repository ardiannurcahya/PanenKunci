// multi_loop_mimo.js — Runs multiple Xiaomi Mimo workers concurrently at smaller window sizes
const { spawn } = require('child_process');

// ==========================================
// CONFIGURATION
// ==========================================
const CONCURRENT_WORKERS = 5; // Jumlah worker yang berjalan bersamaan
const SCREEN_WIDTH = 1920;   // Lebar layar monitor Anda
const SCREEN_HEIGHT = 1080;  // Tinggi layar monitor Anda

// Ukuran jendela yang diperkecil (misal 960x540 px)
const WIDTH = 960;
const HEIGHT = 540;

// Perhitungan posisi kolom dan baris berdasarkan ukuran window di atas
const COLS = Math.floor(SCREEN_WIDTH / (WIDTH + 10)) || 1; // 10px spacing
const ROWS = Math.floor(SCREEN_HEIGHT / (HEIGHT + 10)) || 1;

console.log(`=== MIMO MULTI WORKER RUNNER (SMALL WINDOW) ===`);
console.log(`Starting ${CONCURRENT_WORKERS} workers.`);
console.log(`Each window size: ${WIDTH}x${HEIGHT} px (Arranged in up to ${COLS} columns)\n`);

// List proxy untuk rotasi (opsional)
const PROXIES = [
  // 'http://user:pass@ip:port',
  // 'http://user:pass@ip:port',
];

function getProxy(workerIndex) {
  if (PROXIES.length === 0) return '';
  return PROXIES[workerIndex % PROXIES.length];
}

function startWorker(index) {
  // Hitung posisi x, y di layar agar rapi berjajar
  const col = index % COLS;
  const row = Math.floor(index / COLS) % ROWS;
  const x = col * (WIDTH + 10);
  const y = row * (HEIGHT + 40); // 40px offset untuk taskbar/titlebar

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

  // Memanggil register.js (Xiaomi Mimo)
  const child = spawn('node', ['register.js'], {
    stdio: 'inherit',
    cwd: __dirname,
    env,
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`\n[Worker #${index}] Mimo registration completed.`);
    } else {
      console.log(`\n[Worker #${index}] Mimo worker failed (Exit code: ${code}).`);
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
