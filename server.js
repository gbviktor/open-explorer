'use strict';
/*
 * Open Explorer — a local, web-based file explorer with a duplicate finder.
 * Zero dependencies: Node.js (>=18.15) standard library only.
 * Listens on 127.0.0.1 only; mutating requests require the X-OE header.
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 5180;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const IS_WIN = process.platform === 'win32';

// Types /api/file is allowed to serve inline. Everything else is sent as a download,
// and every response is sandboxed so user files can never run script on this origin.
const MEDIA = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.opus': 'audio/ogg', '.pdf': 'application/pdf',
};
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

const SYSTEM_NAMES = new Set([
  '$recycle.bin', 'system volume information', 'pagefile.sys', 'hiberfil.sys', 'swapfile.sys',
  'dumpstack.log.tmp', 'dumpstack.log', '$windows.~bt', '$windows.~ws', '$sysreset', 'config.msi',
  'msocache', '$winreagent', 'documents and settings', '$getcurrent', 'recovery',
]);
const isHiddenName = (n) => n.startsWith('.') || n.startsWith('$') || SYSTEM_NAMES.has(n.toLowerCase()) || /^ntuser\./i.test(n);

// ---------------------------------------------------------------- helpers
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function send(res, code, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}
const ok = (res, obj) => send(res, 200, obj);

function readJSON(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 50e6) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function absPath(p) {
  if (typeof p !== 'string' || !p.trim()) throw new HttpError(400, 'Path is required');
  let s = p.trim();
  if (IS_WIN && /^[a-zA-Z]:$/.test(s)) s += '\\';
  return path.resolve(s);
}
function pathList(arr) {
  if (!Array.isArray(arr) || !arr.length) throw new HttpError(400, 'No paths given');
  return arr.map(absPath);
}
function validName(n) {
  if (typeof n !== 'string' || !n.trim()) throw new HttpError(400, 'Name is required');
  n = n.trim();
  if (/[\\/:*?"<>|\x00-\x1f]/.test(n) || n === '.' || n === '..') throw new HttpError(400, 'Name contains invalid characters: \\ / : * ? " < > |');
  return n;
}
async function exists(p) { try { await fsp.lstat(p); return true; } catch { return false; } }
async function uniquePath(dir, name) {
  const ext = path.extname(name); const base = ext ? name.slice(0, -ext.length) : name;
  let candidate = path.join(dir, name); let i = 2;
  while (await exists(candidate)) candidate = path.join(dir, `${base} (${i++})${ext}`);
  return candidate;
}
async function mapLimit(items, limit, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i++; await fn(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); const g = m.get(k); if (g) g.push(x); else m.set(k, [x]); }
  return m;
}
const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// ---------------------------------------------------------------- locations
let driveLabels = {};
function loadDriveLabels() {
  if (!IS_WIN) return;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json -Compress'],
  { windowsHide: true, timeout: 15000 }, (err, stdout) => {
    if (err) return;
    try {
      let arr = JSON.parse(stdout); if (!Array.isArray(arr)) arr = [arr];
      for (const d of arr) driveLabels[d.DeviceID] = { label: d.VolumeName || '', type: d.DriveType };
    } catch { /* ignore */ }
  });
}

async function getDrives() {
  const space = async (p) => {
    try { const st = await fsp.statfs(p); return { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; } catch { return {}; }
  };
  if (!IS_WIN) return [{ name: '/', path: '/', label: 'Root', ...(await space('/')) }];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const res = await Promise.all(letters.map(async (L) => {
    const p = `${L}:\\`;
    try { await fsp.access(p); } catch { return null; }
    const info = driveLabels[`${L}:`] || {};
    return { name: `${L}:`, path: p, label: info.label || '', driveType: info.type, ...(await space(p)) };
  }));
  return res.filter(Boolean);
}

function quickAccess() {
  const home = os.homedir();
  const pick = (name) => [path.join(home, name), path.join(home, 'OneDrive', name)].find((p) => fs.existsSync(p));
  const out = [{ name: 'Home', path: home, icon: 'home' }];
  for (const [name, icon] of [['Desktop', 'desktop'], ['Downloads', 'downloads'], ['Documents', 'documents'], ['Pictures', 'pictures'], ['Music', 'music'], ['Videos', 'videos']]) {
    const p = pick(name); if (p) out.push({ name, path: p, icon });
  }
  return out;
}

async function statEntry(full, name, dirent) {
  try {
    const st = await fsp.stat(full);
    return {
      name, path: full, dir: st.isDirectory(), size: st.isDirectory() ? null : st.size,
      mtime: st.mtimeMs, ctime: st.birthtimeMs, link: dirent ? dirent.isSymbolicLink() : false, hidden: isHiddenName(name),
    };
  } catch {
    return { name, path: full, dir: dirent ? dirent.isDirectory() : false, size: null, mtime: null, ctime: null, hidden: isHiddenName(name), error: true };
  }
}

async function listDir(dir) {
  let dirents;
  try { dirents = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (e) {
    if (e.code === 'ENOENT') throw new HttpError(404, `Folder not found: ${dir}`);
    if (e.code === 'ENOTDIR') throw new HttpError(400, `Not a folder: ${dir}`);
    if (e.code === 'EPERM' || e.code === 'EACCES') throw new HttpError(403, `Access denied: ${dir}`);
    throw e;
  }
  const items = [];
  await mapLimit(dirents, 64, async (d) => { items.push(await statEntry(path.join(dir, d.name), d.name, d)); });
  return items;
}

// ---------------------------------------------------------------- walker
async function walk(roots, { includeHidden, excludeNames, isCancelled, onDir, onFiles, onError }) {
  const stack = [...roots].reverse();
  while (stack.length) {
    if (isCancelled()) return;
    const dir = stack.pop();
    onDir && onDir(dir);
    let dirents;
    try { dirents = await fsp.readdir(dir, { withFileTypes: true }); } catch { onError && onError(dir); continue; }
    const files = []; const subdirs = [];
    for (const d of dirents) {
      if (d.isSymbolicLink()) continue; // skips symlinks and junctions -> no loops
      if (!includeHidden && isHiddenName(d.name)) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) { if (!excludeNames.has(d.name.toLowerCase())) subdirs.push(full); }
      else if (d.isFile()) files.push(full);
    }
    for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i]);
    if (files.length) await onFiles(files, dir);
  }
}

// ---------------------------------------------------------------- search
async function searchFiles(root, query, includeHidden) {
  const qs = query.toLowerCase().trim();
  let test;
  if (/[*?]/.test(qs)) {
    const re = new RegExp('^' + qs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    test = (n) => re.test(n);
  } else test = (n) => n.toLowerCase().includes(qs);
  const results = []; const LIMIT = 2000; const deadline = Date.now() + 20000; let truncated = false;
  const matchDirs = [];
  await walk([root], {
    includeHidden, excludeNames: new Set(),
    isCancelled: () => { if (results.length >= LIMIT || Date.now() > deadline) { truncated = true; return true; } return false; },
    onDir: (d) => { if (d !== root && test(path.basename(d))) matchDirs.push(d); },
    onFiles: async (files) => {
      const hits = files.filter((f) => test(path.basename(f)));
      await mapLimit(hits, 32, async (f) => { results.push(await statEntry(f, path.basename(f))); });
    },
  });
  for (const d of matchDirs.slice(0, 500)) results.push(await statEntry(d, path.basename(d)));
  return { items: results.slice(0, LIMIT), truncated };
}

// ---------------------------------------------------------------- duplicate scanner
const CHUNK = 64 * 1024;
const scans = new Map();

async function readAt(fh, buf, pos) {
  let off = 0;
  while (off < buf.length) {
    const { bytesRead } = await fh.read(buf, off, buf.length - off, pos + off);
    if (!bytesRead) break; off += bytesRead;
  }
  return off;
}
async function hashPartial(p, size) {
  const fh = await fsp.open(p, 'r');
  try {
    const h = crypto.createHash('sha1');
    if (size <= CHUNK * 2) { const b = Buffer.alloc(size); h.update(b.subarray(0, await readAt(fh, b, 0))); }
    else {
      const b = Buffer.alloc(CHUNK);
      h.update(b.subarray(0, await readAt(fh, b, 0)));
      h.update(b.subarray(0, await readAt(fh, b, size - CHUNK)));
    }
    return h.digest('hex');
  } finally { await fh.close(); }
}
function hashFull(p, onBytes, isCancelled) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(p, { highWaterMark: 1024 * 1024 });
    s.on('data', (c) => {
      if (isCancelled()) { s.destroy(); reject(new Error('cancelled')); return; }
      h.update(c); onBytes && onBytes(c.length);
    });
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

function startScan(opts) {
  const roots = pathList(opts.roots).sort((a, b) => a.length - b.length);
  const uniqueRoots = roots.filter((r, i) => !roots.slice(0, i).some((o) => isInside(r, o)));
  const scan = {
    id: crypto.randomUUID(), status: 'running', phase: 'Scanning folders', startedAt: Date.now(), finishedAt: null,
    opts: {
      roots: uniqueRoots, mode: ['content', 'namesize', 'name'].includes(opts.mode) ? opts.mode : 'content',
      minSize: Math.max(0, Number(opts.minSize) || 0), maxSize: Number(opts.maxSize) || 0,
      exts: Array.isArray(opts.exts) ? opts.exts.map((e) => String(e).trim().toLowerCase().replace(/^\.?/, '.')).filter((e) => e.length > 1) : [],
      exclude: Array.isArray(opts.exclude) ? opts.exclude.map((e) => String(e).trim().toLowerCase()).filter(Boolean) : [],
      includeHidden: !!opts.includeHidden,
    },
    dirs: 0, files: 0, bytes: 0, errors: 0, hardlinks: 0, current: '',
    candidates: 0, checked: 0, hashBytesTotal: 0, hashBytesDone: 0,
    cancelled: false, groups: null, error: null,
  };
  scans.set(scan.id, scan);
  // keep memory bounded: only the 5 most recent scans
  while (scans.size > 5) scans.delete(scans.keys().next().value);
  runScan(scan).catch((e) => {
    if (scan.cancelled) { scan.status = 'cancelled'; scan.phase = 'Cancelled'; }
    else { scan.status = 'error'; scan.error = e.message; scan.phase = 'Failed'; }
    scan.finishedAt = Date.now();
  });
  return scan;
}

async function runScan(scan) {
  const o = scan.opts;
  const isCancelled = () => scan.cancelled;
  const extSet = o.exts.length ? new Set(o.exts) : null;
  const files = []; const seen = new Set();

  await walk(o.roots, {
    includeHidden: o.includeHidden, excludeNames: new Set(o.exclude), isCancelled,
    onDir: (d) => { scan.dirs++; scan.current = d; },
    onError: () => { scan.errors++; },
    onFiles: async (list) => {
      const filtered = extSet ? list.filter((f) => extSet.has(path.extname(f).toLowerCase())) : list;
      await mapLimit(filtered, 32, async (f) => {
        let st;
        try { st = await fsp.stat(f, { bigint: true }); } catch { scan.errors++; return; }
        const size = Number(st.size);
        if (size < o.minSize || (o.maxSize && size > o.maxSize)) return;
        if (st.ino !== 0n) {
          const key = `${st.dev}:${st.ino}`; // same physical file (hard link) - not a real duplicate
          if (seen.has(key)) { scan.hardlinks++; return; }
          seen.add(key);
        }
        files.push({ path: f, size, mtime: Number(st.mtimeMs), ctime: Number(st.birthtimeMs) });
        scan.files++; scan.bytes += size;
      });
    },
  });
  if (scan.cancelled) throw new Error('cancelled');

  let groups;
  if (o.mode === 'name' || o.mode === 'namesize') {
    scan.phase = 'Grouping by name';
    const m = groupBy(files, (f) => path.basename(f.path).toLowerCase() + (o.mode === 'namesize' ? `|${f.size}` : ''));
    groups = [...m.entries()].filter(([, g]) => g.length > 1).map(([k, g]) => ({ key: k, files: g }));
  } else {
    // Stage 1: same size
    const sizeGroups = [...groupBy(files, (f) => f.size).values()].filter((g) => g.length > 1);
    const cands = sizeGroups.flat();
    scan.candidates = cands.length;
    // Stage 2: hash of first + last 64 KB (whole file if small)
    scan.phase = 'Comparing file samples';
    await mapLimit(cands, 8, async (f) => {
      if (scan.cancelled) return;
      try { f.partial = await hashPartial(f.path, f.size); } catch { f.partial = null; scan.errors++; }
      scan.checked++;
    });
    if (scan.cancelled) throw new Error('cancelled');
    const stage2 = [];
    for (const g of sizeGroups) {
      for (const sg of groupBy(g.filter((f) => f.partial), (f) => f.partial).values()) if (sg.length > 1) stage2.push(sg);
    }
    // Stage 3: full content hash for files bigger than the sample
    const done = []; const needFull = [];
    for (const g of stage2) (g[0].size <= CHUNK * 2 ? done : needFull).push(g);
    scan.phase = 'Hashing full content';
    const fullFiles = needFull.flat();
    scan.hashBytesTotal = fullFiles.reduce((a, f) => a + f.size, 0);
    await mapLimit(fullFiles, 4, async (f) => {
      if (scan.cancelled) return;
      try { f.hash = await hashFull(f.path, (n) => { scan.hashBytesDone += n; }, isCancelled); }
      catch { f.hash = null; if (!scan.cancelled) scan.errors++; }
    });
    if (scan.cancelled) throw new Error('cancelled');
    groups = done.map((g) => ({ key: g[0].partial, files: g }));
    for (const g of needFull) {
      for (const [k, sg] of groupBy(g.filter((f) => f.hash), (f) => f.hash)) if (sg.length > 1) groups.push({ key: k, files: sg });
    }
  }

  scan.groups = groups.map((g) => {
    const fl = g.files.map((f) => ({ path: f.path, name: path.basename(f.path), dir: path.dirname(f.path), size: f.size, mtime: f.mtime, ctime: f.ctime }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const total = fl.reduce((a, f) => a + f.size, 0);
    const max = Math.max(...fl.map((f) => f.size));
    return { key: g.key, size: fl[0].size, total, wasted: total - max, files: fl };
  }).sort((a, b) => b.wasted - a.wasted || b.files.length - a.files.length)
    .map((g, i) => ({ id: i + 1, ...g }));

  scan.status = 'done'; scan.phase = 'Done'; scan.finishedAt = Date.now(); scan.current = '';
}

function scanInfo(s) {
  const { groups, cancelled, ...rest } = s;
  return {
    ...rest,
    groupCount: groups ? groups.length : 0,
    dupFiles: groups ? groups.reduce((a, g) => a + g.files.length - 1, 0) : 0,
    wasted: groups ? groups.reduce((a, g) => a + g.wasted, 0) : 0,
  };
}

// ---------------------------------------------------------------- file operations
function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

const RECYCLE_CS = `
using System; using System.Runtime.InteropServices;
public static class OERecycle {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct SHFILEOPSTRUCT { public IntPtr hwnd; public uint wFunc; public string pFrom; public string pTo; public ushort fFlags; public bool fAnyOperationsAborted; public IntPtr hNameMappings; public string lpszProgressTitle; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHFileOperation(ref SHFILEOPSTRUCT op);
  public static int Recycle(string p) {
    var op = new SHFILEOPSTRUCT();
    op.wFunc = 3; // FO_DELETE
    op.pFrom = p + "\\0\\0";
    op.fFlags = 0x0040 | 0x0010 | 0x0400 | 0x0004; // ALLOWUNDO | NOCONFIRMATION | NOERRORUI | SILENT
    return SHFileOperation(ref op);
  }
}`;

async function recyclePaths(paths) {
  if (!IS_WIN) return permanentDelete(paths);
  const tmp = path.join(os.tmpdir(), `oe-recycle-${crypto.randomUUID()}.json`);
  await fsp.writeFile(tmp, JSON.stringify(paths), 'utf8');
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${RECYCLE_CS}
'@
$list = ConvertFrom-Json -InputObject (Get-Content -LiteralPath '${tmp.replace(/'/g, "''")}' -Raw -Encoding UTF8)
$out = @(foreach ($p in $list) {
  if (-not (Test-Path -LiteralPath $p)) { @{ path = $p; ok = $false; error = 'Not found' }; continue }
  $code = [OERecycle]::Recycle($p)
  if ((Test-Path -LiteralPath $p) -or $code -ne 0) { @{ path = $p; ok = $false; error = "Shell error $code" } }
  else { @{ path = $p; ok = $true } }
})
ConvertTo-Json -InputObject $out -Compress -Depth 3`;
  try {
    const out = await runPowerShell(script);
    const parsed = JSON.parse(out.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } finally { fsp.unlink(tmp).catch(() => {}); }
}

async function permanentDelete(paths) {
  const results = [];
  for (const p of paths) {
    try { await fsp.rm(p, { recursive: true, force: false }); results.push({ path: p, ok: true }); }
    catch (e) { results.push({ path: p, ok: false, error: e.message }); }
  }
  return results;
}

async function moveOrCopy(paths, dest, copy) {
  const st = await fsp.stat(dest).catch(() => null);
  if (!st || !st.isDirectory()) throw new HttpError(400, 'Destination folder does not exist');
  const results = [];
  for (const src of paths) {
    try {
      if (isInside(dest, src)) throw new Error('Cannot move or copy a folder into itself');
      if (!copy && path.dirname(src).toLowerCase() === dest.toLowerCase()) { results.push({ path: src, ok: true, to: src, skipped: true }); continue; }
      const target = await uniquePath(dest, path.basename(src));
      if (copy) await fsp.cp(src, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      else {
        try { await fsp.rename(src, target); }
        catch (e) {
          if (e.code !== 'EXDEV') throw e;
          await fsp.cp(src, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
          await fsp.rm(src, { recursive: true });
        }
      }
      results.push({ path: src, ok: true, to: target });
    } catch (e) { results.push({ path: src, ok: false, error: e.message }); }
  }
  return results;
}

async function replaceWithHardlinks(keep, targets) {
  const kst = await fsp.stat(keep);
  const keepHash = await hashFull(keep, null, () => false);
  const results = [];
  for (const t of targets) {
    try {
      if (t.toLowerCase() === keep.toLowerCase()) throw new Error('Same file as the one kept');
      const tst = await fsp.stat(t);
      if (tst.size !== kst.size) throw new Error('Size differs from kept file');
      if (await hashFull(t, null, () => false) !== keepHash) throw new Error('Content differs from kept file');
      const tmp = `${t}.oe-${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fsp.rename(t, tmp);
      try { await fsp.link(keep, t); }
      catch (e) {
        await fsp.rename(tmp, t);
        throw new Error(e.code === 'EXDEV' ? 'Hard links only work on the same drive' : e.message);
      }
      await fsp.unlink(tmp);
      results.push({ path: t, ok: true });
    } catch (e) { results.push({ path: t, ok: false, error: e.message }); }
  }
  return results;
}

function openPath(p, reveal) {
  if (IS_WIN) {
    const args = reveal ? `/select,"${p}"` : `"${p}"`;
    spawn('explorer.exe', [args], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } else {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, reveal && process.platform === 'darwin' ? ['-R', p] : [reveal ? path.dirname(p) : p], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function serveFile(req, res, p, download) {
  const st = await fsp.stat(p).catch(() => null);
  if (!st || !st.isFile()) throw new HttpError(404, 'File not found');
  const ext = path.extname(p).toLowerCase();
  const type = (!download && MEDIA[ext]) || 'application/octet-stream';
  const headers = {
    'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
    'Last-Modified': st.mtime.toUTCString(),
  };
  if (type === 'application/octet-stream') headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(p))}`;
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range && st.size > 0) {
    let start = range[1] === '' ? st.size - Number(range[2]) : Number(range[1]);
    let end = range[1] === '' || range[2] === '' ? st.size - 1 : Number(range[2]);
    start = Math.max(0, start); end = Math.min(end, st.size - 1);
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(p, { start, end }).on('error', () => res.destroy()).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(p).on('error', () => res.destroy()).pipe(res);
  }
}

async function readText(p) {
  const st = await fsp.stat(p);
  if (!st.isFile()) throw new HttpError(400, 'Not a file');
  const max = 200 * 1024;
  const fh = await fsp.open(p, 'r');
  try {
    const buf = Buffer.alloc(Math.min(max, st.size));
    const n = await readAt(fh, buf, 0);
    const b = buf.subarray(0, n);
    const sample = b.subarray(0, 8000);
    if (sample.includes(0) && !(sample[0] === 0xff && sample[1] === 0xfe)) return { binary: true };
    let text = (sample[0] === 0xff && sample[1] === 0xfe) ? b.toString('utf16le') : b.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return { text, truncated: st.size > max, size: st.size };
  } finally { await fh.close(); }
}

// ---------------------------------------------------------------- API router
async function api(req, res, url) {
  const route = url.pathname.slice(5);
  const qp = (k) => url.searchParams.get(k);
  const body = req.method === 'POST' ? await readJSON(req) : {};

  switch (`${req.method} ${route}`) {
    case 'GET roots': return ok(res, { drives: await getDrives(), quick: quickAccess(), home: os.homedir(), sep: path.sep, platform: process.platform });
    case 'GET list': {
      const dir = absPath(qp('path'));
      return ok(res, { path: dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), items: await listDir(dir) });
    }
    case 'GET search': return ok(res, await searchFiles(absPath(qp('path')), qp('q') || '', qp('hidden') === '1'));
    case 'GET stat': return ok(res, await statEntry(absPath(qp('path')), path.basename(absPath(qp('path')))));
    case 'GET file': return serveFile(req, res, absPath(qp('path')), qp('download') === '1');
    case 'GET text': return ok(res, await readText(absPath(qp('path'))));

    case 'POST open': openPath(absPath(body.path), false); return ok(res, { ok: true });
    case 'POST reveal': openPath(absPath(body.path), true); return ok(res, { ok: true });
    case 'POST mkdir': {
      const parent = absPath(body.path);
      const target = await uniquePath(parent, validName(body.name || 'New folder'));
      await fsp.mkdir(target);
      return ok(res, { path: target });
    }
    case 'POST newfile': {
      const parent = absPath(body.path);
      const target = await uniquePath(parent, validName(body.name || 'New Text Document.txt'));
      await fsp.writeFile(target, '', { flag: 'wx' });
      return ok(res, { path: target });
    }
    case 'POST rename': {
      const src = absPath(body.path);
      const target = path.join(path.dirname(src), validName(body.name));
      if (target !== src && target.toLowerCase() !== src.toLowerCase() && await exists(target)) throw new HttpError(409, 'An item with that name already exists');
      await fsp.rename(src, target);
      return ok(res, { path: target });
    }
    case 'POST delete': {
      const paths = pathList(body.paths);
      const results = body.permanent ? await permanentDelete(paths) : await recyclePaths(paths);
      return ok(res, { results });
    }
    case 'POST move': return ok(res, { results: await moveOrCopy(pathList(body.paths), absPath(body.dest), false) });
    case 'POST copy': return ok(res, { results: await moveOrCopy(pathList(body.paths), absPath(body.dest), true) });
    case 'POST hardlink': return ok(res, { results: await replaceWithHardlinks(absPath(body.keep), pathList(body.paths)) });

    case 'POST scan': return ok(res, scanInfo(startScan(body)));
  }
  let m;
  if ((m = /^scan\/([\w-]+)(\/result|\/cancel)?$/.exec(route))) {
    const scan = scans.get(m[1]);
    if (!scan) throw new HttpError(404, 'Scan not found (the server may have restarted)');
    if (m[2] === '/cancel' && req.method === 'POST') { scan.cancelled = true; return ok(res, { ok: true }); }
    if (m[2] === '/result') return ok(res, { ...scanInfo(scan), groups: scan.groups || [] });
    return ok(res, scanInfo(scan));
  }
  throw new HttpError(404, 'Unknown API route');
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!isInside(file, PUBLIC_DIR)) throw new HttpError(403, 'Forbidden');
  const data = await fsp.readFile(file).catch(() => null);
  if (!data) throw new HttpError(404, 'Not found');
  send(res, 200, data, { 'Content-Type': STATIC_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
}

const server = http.createServer(async (req, res) => {
  try {
    const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new HttpError(403, 'Forbidden host');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['x-oe'] !== '1') throw new HttpError(403, 'Missing X-OE header');
      return await api(req, res, url);
    }
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    let status = e.status || 500; let msg = e.message;
    if (e.code === 'ENOENT') { status = 404; msg = 'Not found: ' + (e.path || ''); }
    else if (e.code === 'EPERM' || e.code === 'EACCES') { status = 403; msg = 'Access denied: ' + (e.path || ''); }
    else if (e.code === 'EBUSY') { status = 409; msg = 'File is in use: ' + (e.path || ''); }
    if (!res.headersSent) send(res, status, { error: msg }); else res.destroy();
  }
});

loadDriveLabels();
server.listen(PORT, HOST, () => {
  console.log(`Open Explorer running at http://localhost:${PORT}`);
});
