/**
 * Read a file from public/ inside a route handler.
 *
 * The ~10,800 Gemeinde GeoJSON files (several hundred MB) are deliberately kept
 * out of the serverless bundles (outputFileTracingExcludes in
 * next.config.ts): traced in, they would push every function past the
 * hosting size limits. So a route first tries the local file (dev, `next
 * start`, self-hosting) and otherwise fetches the same file from the
 * site's own static hosting.
 */
import fs from 'fs';
import path from 'path';

export async function readPublicText(origin: string, relativePath: string): Promise<string | null> {
  const clean = relativePath.replace(/^\/+/, '');
  const localPath = path.join(process.cwd(), 'public', clean);
  try {
    if (fs.existsSync(localPath)) {
      return fs.readFileSync(localPath, 'utf-8');
    }
  } catch {
    // fall through to HTTP
  }
  try {
    const response = await fetch(`${origin}/${clean}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}
