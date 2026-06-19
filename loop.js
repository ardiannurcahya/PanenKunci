// loop.js — Keeps re-running register.js until stopped manually (Ctrl+C)
const { spawn } = require('child_process');

let count = 0;

function run() {
  count++;
  console.log(`\n=== RUN #${count} ===\n`);

  const child = spawn('node', ['register.js'], {
    stdio: 'inherit',
    cwd: __dirname,
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`\nRun #${count} completed.`);
    } else {
      console.log(`\nRun #${count} stopped (code ${code}) — likely custom captcha.`);
    }
    console.log('Restarting in 3 seconds...\n');
    setTimeout(run, 3000);
  });
}

process.on('SIGINT', () => {
  console.log('\nStopped by user.');
  process.exit(0);
});

run();
