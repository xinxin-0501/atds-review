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
  // 优先环境变量，其次 git credential 存储
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('无法获取 GitHub 凭据');
  return m[1].trim();
})();
const MESSAGE = process.argv[2] || 'ATDS auto premarket report';

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const H = { Authorization: `token ${TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'atds-auto' };

async function req(method, url, body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      if (!r.ok) throw new Error(`${method} ${url} -> ${r.status}: ${t.slice(0, 300)}`);
      return t ? JSON.parse(t) : null;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(s => setTimeout(s, 1500 * (i + 1)));
    }
  }
}

// 1. 列出全部跟踪文件
const files = execSync('git ls-files -z', { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean).map(f => f.replace(/\//g, path.sep));

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
function buildTree(dir) {
  const children = new Map(); // name -> {type, path}
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
      const sub = buildTree(c.path); // returns sha (creates on server)
      entries.push({ path: name, mode: '040000', type: 'tree', sha: sub });
    }
  }
  // 根目录树提交
  const base = dir === '' ? undefined : undefined;
  const body = { tree: entries };
  if (dir === '') body.base_tree = undefined; // full replacement tree
  delete body.base_tree;
  // 每次 POST tree 得到 sha
  return req('POST', `${API}/git/trees`, body).then(j => j.sha);
}

console.log('构建 tree...');
const rootTreeSha = await buildTree('');

// 4. 取 main head 作为父提交
const head = await req('GET', `${API}/git/ref/heads/${BRANCH}`);
console.log('parent head:', head.object.sha);

// 5. 创建 commit
const commit = await req('POST', `${API}/git/commits`, {
  message: MESSAGE,
  tree: rootTreeSha,
  parents: [head.object.sha],
});
console.log('commit:', commit.sha);

// 6. PATCH ref
const ref = await req('PATCH', `${API}/git/refs/heads/${BRANCH}`, {
  sha: commit.sha,
  force: false,
});
console.log('ref updated:', ref.object.sha);
console.log('PUSH OK');
