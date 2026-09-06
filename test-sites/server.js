const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const __dir = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const ROUTES = {
  '/': 'index.html',
  '/banking': 'banking.html',
  '/ecommerce': 'ecommerce.html',
  '/login': 'login.html',
  '/healthcare': 'healthcare.html',
  '/social': 'social.html',
  '/admin': 'admin.html',
  '/payment': 'payment.html',
  '/profile': 'profile.html',
  '/email': 'email.html',
  '/government': 'government.html',
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];
  let fileName = ROUTES[urlPath];

  if (!fileName) {
    const ext = path.extname(urlPath);
    if (ext) {
      fileName = urlPath.slice(1);
    }
  }

  if (!fileName) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 Not Found</h1>');
    return;
  }

  const filePath = path.join(__dir, fileName);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>500 Internal Server Error</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('  Privacy Vision Agent - Synthetic Test Server');
  console.log('='.repeat(60));
  console.log(`\n  Server running on http://localhost:${PORT}\n`);
  console.log('  Available pages:');
  Object.entries(ROUTES).forEach(([route, file]) => {
    const label = route === '/' ? '/index' : route;
    console.log(`    http://localhost:${PORT}${label.padEnd(15)} -> ${file}`);
  });
  console.log('\n' + '='.repeat(60));
});
