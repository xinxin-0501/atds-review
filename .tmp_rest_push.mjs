// One-off REST API push fallback for github.com connection-reset issues.
// Usage: node --dns-result-order=ipv4first .tmp_rest_push.mjs "commit message"
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO = 'xinxin-0501/atds-review';
const API = `https://api.github.com/repos/${REPO}`;
const MSG = process.argv[2] || 'REST API push';

function getToken() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const line = out.split('\n').find((l) => l.startsWith('password='));
  if (!line) throw new Error('no token from git credential fill');
  return line.slice('password='.length).trim();
}

const TOKEN = getToken();
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'atds-rest-push',
};

async function api(method, path, body, retries = 3) {
  for (let i = 0; ; i++) {
    try {
      const ctrl = AbortSignal.timeout(120000);
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl,
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
      }
      return json;
    } catch (e) {
      if (i >= retries) throw e;
      const wait = 2000 * (i + 1);
      console.log(`retry ${i + 1} for ${method} ${path}: ${e.message}; wait ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function main() {
  // Changed files vs parent of local HEAD commit
  const names = execFileSync(
    'git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
    { encoding: 'utf8' },
  ).split('\n').map((s) => s.trim()).filter(Boolean);
  console.log(`changed files: ${names.length}`);

  // Remote base
  const ref = await api('GET', '/git/ref/heads/main');
  const baseCommitSha = ref.object.sha;
  const baseCommit = await api('GET', `/git/commits/${baseCommitSha}`);
  const baseTree = baseCommit.tree.sha;
  console.log(`remote main @ ${baseCommitSha.slice(0, 10)}, tree ${baseTree.slice(0, 10)}`);

  // Create blobs (concurrency 4)
  const tree = [];
  let done = 0;
  const queue = [...names];
  async function worker() {
    while (queue.length) {
      const path = queue.shift();
      const content = readFileSync(path);
      const blob = await api('POST', '/git/blobs', {
        content: content.toString('base64'),
        encoding: 'base64',
      });
      tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      done++;
      if (done % 10 === 0 || done === names.length) console.log(`blobs ${done}/${names.length}`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  const newTree = await api('POST', '/git/trees', { base_tree: baseTree, tree });
  console.log(`new tree ${newTree.sha.slice(0, 10)}`);

  const newCommit = await api('POST', '/git/commits', {
    message: MSG,
    tree: newTree.sha,
    parents: [baseCommitSha],
  });
  console.log(`new commit ${newCommit.sha.slice(0, 10)}`);

  // PATCH ref, retry on 409/sha mismatch
  for (let i = 0; i < 5; i++) {
    try {
      await api('PATCH', '/git/refs/heads/main', {
        sha: newCommit.sha,
        force: false,
      });
      console.log('refs/heads/main updated OK');
      return;
    } catch (e) {
      console.log(`ref patch attempt ${i + 1} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000));
      // rebase commit onto new remote head if moved
      const cur = await api('GET', '/git/ref/heads/main');
      if (cur.object.sha !== baseCommitSha && cur.object.sha !== newCommit.sha) {
        const curTree = (await api('GET', `/git/commits/${cur.object.sha}`)).tree.sha;
        if (curTree === newTree.sha) {
          console.log('remote already at same tree, nothing to push');
          return;
        }
        throw new Error('remote main moved unexpectedly; manual resolution needed');
      }
    }
  }
  throw new Error('failed to update ref after retries');
}

main().then(
  () => { console.log('REST PUSH DONE'); process.exit(0); },
  (e) => { console.error('REST PUSH FAILED:', e.message); process.exit(1); },
);
