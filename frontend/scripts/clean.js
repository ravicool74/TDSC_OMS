const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
  console.log('Cleaned dist directory');
}

const publicExpo = path.join(__dirname, '..', 'public', '_expo');
if (fs.existsSync(publicExpo)) {
  fs.rmSync(publicExpo, { recursive: true, force: true });
  console.log('Cleaned public/_expo directory');
}
