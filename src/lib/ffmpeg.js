const { execSync } = require('child_process');

function findFfmpeg() {
  const paths = [
    'C:\\Users\\ardia\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe',
    'ffmpeg',
  ];
  for (const p of paths) {
    try {
      execSync(`"${p}" -version`, { stdio: 'ignore' });
      return p;
    } catch (_) {}
  }
  return 'ffmpeg'; // fallback
}

module.exports = { findFfmpeg };
