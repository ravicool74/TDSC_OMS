const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');

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

  const distDir = path.join(__dirname, '..', 'dist');
  const publicDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(distDir)) {
    fs.cpSync(distDir, publicDir, { recursive: true });
    console.log('Successfully synced dist to public directory');
  }
}
