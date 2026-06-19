// loop.js — Keeps re-running register.js with delays to avoid rate limiting
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
      console.log(`\nRun #${count} stopped (code ${code}).`);
    }
    // Random delay 60-120s to avoid rate limiting
    const delay = 60000 + Math.floor(Math.random() * 60000);
    console.log(`Waiting ${Math.round(delay / 1000)}s before next run...\n`);
    setTimeout(run, delay);
  });
}

process.on('SIGINT', () => {
  console.log('\nStopped by user.');
  process.exit(0);
});

run();
