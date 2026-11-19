/**
 * Minimal static tile server for local PC deployment.
 * Serves data/tiles + the Vite build (if present).
 *
 *   npm run serve:tiles
 *   → http://localhost:8787
 */

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 8787)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

async function tryFile(filePath: string): Promise<Buffer | null> {
  try {
    const s = await stat(filePath)
    if (!s.isFile()) return null
    return await readFile(filePath)
  } catch {
    return null
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  let rel = decodeURIComponent(url.pathname)
  if (rel === '/') rel = '/index.html'

  const candidates = [
    path.join(ROOT, 'dist', rel),
    path.join(ROOT, 'public', rel),
    path.join(ROOT, 'data', rel.replace(/^\//, '')),
  ]

  for (const filePath of candidates) {
    const buf = await tryFile(filePath)
    if (!buf) continue
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    })
    res.end(buf)
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not found')
}).listen(PORT, () => {
  console.log(`Tile server http://localhost:${PORT}`)
  console.log(`  tiles: ${path.join(ROOT, 'data', 'tiles')}`)
})
