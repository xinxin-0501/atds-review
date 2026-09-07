// GitHub REST API 推送 (blobs -> trees -> commit -> PATCH refs/heads/main)
// 用法: node scripts/push_api.mjs <commit-message>
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OWNER = 'xinxin-0501';
const REPO = 'atds-review';
const BRANCH = 'main';
const TOKEN = (() => {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('无法获取 GitHub 凭据');
  return m[1].trim();
})();
const MESSAGE = process.argv[2] || 'ATDS auto premarket report';

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const H = { Authorization: `token ${TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'atds-auto' };

async function req(method, url, body, retries = 4) {
  for (let i = 0; i < retries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    try {
      const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
      const t = await r.text();
      if (!r.ok) throw new Error(`${method} ${url} -> ${r.status}: ${t.slice(0, 300)}`);
      return t ? JSON.parse(t) : null;
    } catch (e) {
      clearTimeout(timer);
      console.log(`retry ${i + 1}/${retries} for ${method} ${url}: ${e.message}`);
      if (i === retries - 1) throw e;
      await new Promise(s => setTimeout(s, 2000 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
}

// 0. 取 main head commit + tree sha (先于 tree 构建)
const headRef = await req('GET', `${API}/git/ref/heads/${BRANCH}`);
const headCommit = await req('GET', `${API}/git/commits/${headRef.object.sha}`);
console.log('parent head:', headRef.object.sha, '| head tree:', headCommit.tree.sha);

// 1. 列出全部跟踪文件
const files = execSync('git ls-files -z', { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean).map(f => f.replace(/\//g, path.sep));
console.log('tracked files:', files.length);

// 2. 批量创建 blobs
const blobSha = new Map();
let done = 0;
const queue = files.map(f => async () => {
  const buf = fs.readFileSync(path.join(ROOT, f));
  const j = await req('POST', `${API}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
  blobSha.set(f, j.sha);
  done++;
  if (done % 20 === 0 || done === files.length) console.log(`blobs ${done}/${files.length}`);
});
const CONC = 6;
for (let i = 0; i < queue.length; i += CONC) {
  await Promise.all(queue.slice(i, i + CONC).map(fn => fn()));
}

// 3. 自底向上构建嵌套 tree
async function buildTree(dir) {
  const children = new Map();
  for (const f of files) {
    const rel = path.relative(dir, f);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      const seg = rel.split(path.sep)[0];
      const full = path.join(dir, seg);
      if (seg === rel) children.set(seg, { type: 'blob', path: full });
      else if (!children.has(seg)) children.set(seg, { type: 'tree', path: full });
    }
  }
  const entries = [];
  for (const [name, c] of children) {
    if (c.type === 'blob') entries.push({ path: name, mode: '100644', type: 'blob', sha: blobSha.get(c.path) });
    else {
      const sub = await buildTree(c.path);
      entries.push({ path: name, mode: '040000', type: 'tree', sha: sub });
    }
  }
  const body = dir === '' ? { tree: entries, base_tree: headCommit.tree.sha } : { tree: entries };
  console.log('POST tree:', dir === '' ? '(root, base_tree=' + headCommit.tree.sha.slice(0, 7) + ')' : dir);
  const j = await req('POST', `${API}/git/trees`, body);
  return j.sha;
}

console.log('构建 tree...');
const rootTreeSha = await buildTree('');
console.log('root tree:', rootTreeSha);

// 4. 创建 commit
const commit = await req('POST', `${API}/git/commits`, {
  message: MESSAGE,
  tree: rootTreeSha,
  parents: [headRef.object.sha],
});
console.log('commit:', commit.sha);

// 5. PATCH ref
const ref = await req('PATCH', `${API}/git/refs/heads/${BRANCH}`, {
  sha: commit.sha,
  force: false,
});
console.log('ref updated:', ref.object.sha);
console.log('PUSH OK');
