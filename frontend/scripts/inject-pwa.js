const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const indexPath = path.join(distDir, 'index.html');

if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');

  // Ensure viewport has viewport-fit=cover
  html = html.replace(
    'content="width=device-width, initial-scale=1, shrink-to-fit=no"',
    'content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"'
  );

  // Inject Apple PWA and Theme meta tags before </head>
  const pwaTags = `
    <!-- iOS Safari PWA / Add to Home Screen -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="TDSC" />
    <meta name="theme-color" content="#1e3a8a" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.json" />
  </head>`;

  if (!html.includes('apple-mobile-web-app-capable')) {
    html = html.replace('</head>', pwaTags);
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log('Successfully injected iOS Safari PWA tags into dist/index.html');
  }

  // Generate 404.html and login.html so static web hosts (Vercel/Netlify) never throw 404 on subroutes
  try {
    fs.copyFileSync(indexPath, path.join(distDir, '404.html'));
    fs.copyFileSync(indexPath, path.join(distDir, 'login.html'));
    console.log('Successfully created 404.html and login.html SPA fallbacks');
  } catch (e) {
    console.warn('Failed creating 404.html fallback:', e.message);
  }
}

// Copy APK from repo root into dist directory for direct downloads
const rootApkPath = path.join(__dirname, '..', '..', 'TDSC-Office-Manager.apk');
const distApkPath = path.join(__dirname, '..', 'dist', 'TDSC-Office-Manager.apk');
if (fs.existsSync(rootApkPath)) {
  try {
    fs.copyFileSync(rootApkPath, distApkPath);
    console.log('Successfully copied TDSC-Office-Manager.apk to dist directory');
  } catch (err) {
    console.warn('Could not copy APK to dist:', err.message);
  }
}
