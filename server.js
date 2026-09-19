// 最簡單的本機靜態檔案伺服器,沒有額外套件依賴。
// ES module 的 import 在瀏覽器裡需要透過 http:// 開啟才能運作(file:// 會被瀏覽器擋掉),
// 所以才需要這個小伺服器,不能直接用瀏覽器打開 index.html。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 4173;
const DATA_DIR = path.join(ROOT, 'data');
const STATS_FILE = path.join(DATA_DIR, 'players.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function readStatsFile() {
  try {
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// 先寫到暫存檔再 rename,避免伺服器剛好在寫入途中被中斷而弄壞資料庫檔案。
function writeStatsFile(stats) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = `${STATS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(stats, null, 2));
  fs.renameSync(tmpFile, STATS_FILE);
}

function handleStatsApi(req, res) {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(readStatsFile()));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) req.destroy(); // 避免異常大的請求把伺服器記憶體吃光
    });
    req.on('end', () => {
      try {
        const stats = JSON.parse(body);
        if (typeof stats !== 'object' || stats === null || Array.isArray(stats)) {
          throw new Error('格式錯誤');
        }
        writeStatsFile(stats);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: '資料格式錯誤' }));
      }
    });
    return;
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath === '/api/stats') {
    handleStatsApi(req, res);
    return;
  }

  let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('找不到這個檔案:' + urlPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`麻將訓練頁面已啟動:http://localhost:${PORT}`);
});
