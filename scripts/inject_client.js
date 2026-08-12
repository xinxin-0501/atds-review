const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();

console.log('Running build_report.js...');
try {
  console.log(execSync('node scripts/build_report.js', { cwd: ROOT, encoding: 'utf8' }));
} catch (e) {
  console.error('Build error:', e.stderr || e.message);
  process.exit(1);
}

const sharedJs = fs.readFileSync(path.join(ROOT, 'scripts/shared_client.js'), 'utf8').trim();
const modalCss = fs.readFileSync(path.join(ROOT, 'modal_css.txt'), 'utf8').trim();
const dragonCss = fs.readFileSync(path.join(ROOT, 'dragon_pool.css'), 'utf8').trim();
const intlCss = fs.readFileSync(path.join(ROOT, 'intl_mkt.css'), 'utf8').trim();
const tpCss = fs.readFileSync(path.join(ROOT, 'tech_playbook_verdict.css'), 'utf8').trim();
const ceCss = fs.readFileSync(path.join(ROOT, 'close_emotion.css'), 'utf8').trim();
const heroCss = fs.readFileSync(path.join(ROOT, 'hero_mobile.css'), 'utf8').trim();

// 自动扫描 site 下所有 HTML(含 reviews/ 子目录),云端新日期自动纳入
function scanFiles() {
  const out = [];
  const walk = (dir) => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs)) {
      const rel = dir + '/' + name;
      const full = path.join(ROOT, rel);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        walk(rel);
      } else if (name.endsWith('.html')) {
        out.push(rel);
      }
    }
  };
  walk('site');
  return out;
}

const files = scanFiles();

for (const rel of files) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.log('MISSING:', rel); continue; }
  let c = fs.readFileSync(file, 'utf8');

  // 确保 HTML 有 <style></style> 占位符(build_report.js 不输出)
  if (!c.includes('</style>')) {
    if (c.includes('</title>')) {
      c = c.replace('</title>', '</title>\n<style></style>', 1);
    } else if (c.includes('</head>')) {
      c = c.replace('</head>', '<style></style>\n</head>', 1);
    }
  }

  // Ensure modal CSS exists (inject into first </style> if missing)
  if (!c.includes('.modal-mask{display:none')) {
    if (c.includes('</style>')) {
      c = c.replace('</style>', modalCss + '\n</style>', 1);
      console.log('  +modal CSS:', rel);
    }
  }
  // Ensure dragon pool CSS exists
  if (!c.includes('.dragon-pool{')) {
    if (c.includes('</style>')) {
      c = c.replace('</style>', dragonCss + '\n</style>', 1);
      console.log('  +dragon CSS:', rel);
    }
  }
  // Ensure intl mkt CSS exists
  if (!c.includes('.intl-mkt{')) {
    if (c.includes('</style>')) {
      c = c.replace('</style>', intlCss + '\n</style>', 1);
      console.log('  +intl CSS:', rel);
    }
  }
  // Ensure tech/playbook/verdict CSS exists
  if (!c.includes('.tech-card{')) {
  // Ensure close emotion CSS exists
  if (!c.includes('.close-emotion{')) {
  // Ensure hero/mobile CSS exists
  if (!c.includes('.hero-eyebrow{')) {
    if (c.includes('</style>')) {
      c = c.replace('</style>', heroCss + '\n</style>', 1);
      console.log('  +hero CSS:', rel);
    }
  }
    if (c.includes('</style>')) {
      c = c.replace('</style>', ceCss + '\n</style>', 1);
      console.log('  +ce CSS:', rel);
    }
  }
    if (c.includes('</style>')) {
      c = c.replace('</style>', tpCss + '\n</style>', 1);
      console.log('  +tp CSS:', rel);
    }
  }

  // Remove any existing shared blocks
  const re = /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcodejs\/1\.0\.0\/qrcode\.min\.js"><\/script>\s*\n\s*<script>[\s\S]*?<\/script>\s*\n?/g;
  c = c.replace(re, '');

  // Inject before </body>
  if (c.includes('</body>')) {
    c = c.replace('</body>', sharedJs + '\n</body>');
    fs.writeFileSync(file, c, 'utf8');
    console.log('INJECTED:', rel);
  } else {
    console.log('NO </body>:', rel);
  }
}
console.log('Done.');