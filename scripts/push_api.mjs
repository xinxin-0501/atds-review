// GitHub REST API 推送 (blobs -> trees -> commit -> PATCH refs/heads/main)
// 用法: node scripts/push_api.mjs <commit-message>
// 特性: 增量 blob(仅上传与远程 tree 不同的文件) + base_tree 合并(保留远程独有文件)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

async function req(method, url, body, retries = 5) {
  for (let i = 0; i < retries; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60000);
    try {
      const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
      const t = await r.text();
      if (!r.ok) throw new Error(`${method} ${url.split('?')[0]} -> ${r.status}: ${t.slice(0, 200)}`);
      return t ? JSON.parse(t) : null;
    } catch (e) {
      clearTimeout(timer);
      console.log(`  retry ${i + 1}/${retries} ${method} ${url.split('?')[0]}: ${e.message}`);
      if (i === retries - 1) throw e;
      await new Promise(s => setTimeout(s, 3000 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
}

// git blob sha1 = sha1("blob <size>\0<content>")
function gitBlobSha(buf) {
  const h = crypto.createHash('sha1');
  h.update(`blob ${buf.length}\0`);
  h.update(buf);
  return h.digest('hex');
}

// 0. 取远程 main head + 递归 tree (path -> sha)
console.log('fetch remote head/tree...');
const headRef = await req('GET', `${API}/git/ref/heads/${BRANCH}`);
const headSha = headRef.object.sha;
const headCommit = await req('GET', `${API}/git/commits/${headSha}`);
const headTree = headCommit.tree.sha;
console.log('remote head:', headSha.slice(0, 7), '| tree:', headTree.slice(0, 7));

let remotePaths = new Map();
try {
  const t = await req('GET', `${API}/git/trees/${headTree}?recursive=1`);
  for (const e of t.tree) if (e.type === 'blob') remotePaths.set(e.path, e.sha);
  console.log('remote blobs:', remotePaths.size);
} catch (e) {
  console.log('recursive tree fetch failed, treat as empty base:', e.message);
}

// 1. 列出全部本地跟踪文件 + 计算 blob sha,筛出需上传的
const files = execSync('git ls-files -z', { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean).map(f => f.replace(/\//g, path.sep));
console.log('tracked files:', files.length);

const needUpload = []; // {p, buf}
const localSha = new Map();
for (const f of files) {
  const abs = path.join(ROOT, f);
  const buf = fs.readFileSync(abs);
  const sha = gitBlobSha(buf);
  localSha.set(f, sha);
  const rp = f.split(path.sep).join('/');
  if (remotePaths.get(rp) !== sha) needUpload.push({ p: f, buf, rp });
}
console.log(`diff blobs to upload: ${needUpload.length}/${files.length}`);

// 2. 并发上传差异 blob
const blobSha = new Map(localSha);
let done = 0;
const CONC = 5;
for (let i = 0; i < needUpload.length; i += CONC) {
  await Promise.all(needUpload.slice(i, i + CONC).map(async ({ p, buf, rp }) => {
    const j = await req('POST', `${API}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
    blobSha.set(p, j.sha);
    done++;
    console.log(`  blob ${done}/${needUpload.length}: ${rp}`);
  }));
}

// 3. 自底向上构建嵌套 tree (await 递归,保证子树先建)
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
    else entries.push({ path: name, mode: '040000', type: 'tree', sha: await buildTree(c.path) });
  }
  const body = dir === '' ? { tree: entries, base_tree: headTree } : { tree: entries };
  console.log('POST tree:', dir === '' ? `(root, base_tree=${headTree.slice(0, 7)})` : dir);
  const j = await req('POST', `${API}/git/trees`, body);
  return j.sha;
}

console.log('构建 tree...');
const rootTreeSha = await buildTree('');
console.log('root tree:', rootTreeSha.slice(0, 7));

// 4. 创建 commit (parent = 远程 head)
const commit = await req('POST', `${API}/git/commits`, {
  message: MESSAGE,
  tree: rootTreeSha,
  parents: [headSha],
});
console.log('commit:', commit.sha);

// 5. PATCH ref (force:false,若远程又前进则失败重跑)
const ref = await req('PATCH', `${API}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });
console.log('ref updated:', ref.object.sha);
console.log('PUSH OK');
