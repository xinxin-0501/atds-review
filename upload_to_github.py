#!/usr/bin/env python3
"""通过 GitHub Contents API 上传全部项目文件(绕开 github.com 防火墙,仅用 api.github.com)
用法: 先确保 token.txt 存在,然后运行 python upload_to_github.py
"""
import os, json, base64, glob, urllib.request, urllib.error, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OWNER = "xinxin-0501"
REPO = "atds-review"
BRANCH = "main"
API = f"https://api.github.com/repos/{OWNER}/{REPO}/contents/"

# 读取 token
token_path = os.path.join(ROOT, "token.txt")
if not os.path.exists(token_path):
    print("错误: 未找到 token.txt,请先把 token 保存到该项目目录的 token.txt")
    sys.exit(1)
with open(token_path, encoding="utf-8") as f:
    TOKEN = f.read().strip()
if not TOKEN:
    print("错误: token.txt 为空")
    sys.exit(1)
print("Token 已加载(长度 %d,不显示内容)" % len(TOKEN))

# 需要上传的文件
def collect():
    files = []
    for f in ["config.json", "README.md", "README_云端部署.md",
              "modal_css.txt", "dragon_pool.css", "intl_mkt.css",
              "tech_playbook_verdict.css", "close_emotion.css", "hero_mobile.css"]:
        p = os.path.join(ROOT, f)
        if os.path.exists(p):
            files.append((f, p))
    for f in ["cloud_fetch.mjs", "build_report.js", "inject_client.js", "shared_client.js"]:
        files.append(("scripts/" + f, os.path.join(ROOT, "scripts", f)))
    files.append((".github/workflows/daily-review.yml", os.path.join(ROOT, ".github/workflows/daily-review.yml")))
    for f in sorted(glob.glob("data/reviews/*.json")):
        files.append((f.replace("\\", "/"), os.path.join(ROOT, f)))
    for f in sorted(glob.glob("site/*.html")):
        files.append((f.replace("\\", "/"), os.path.join(ROOT, f)))
    for f in sorted(glob.glob("site/reviews/*.html")):
        files.append((f.replace("\\", "/"), os.path.join(ROOT, f)))
    return files

def api_request(method, url, payload=None):
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"token {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "atds-deploy")
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    else:
        data = None
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            return json.loads(r.read().decode("utf-8")), r.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"error": body}, e.code

def upload_file(path, local, sha=None):
    with open(local, "rb") as f:
        content = base64.b64encode(f.read()).decode("ascii")
    payload = {"message": f"add {path}", "content": content, "branch": BRANCH}
    if sha:
        payload["sha"] = sha
    result, code = api_request("PUT", API + urllib.parse.quote(path), payload)
    return code in (200, 201), result

import urllib.parse

def main():
    files = collect()
    print(f"共 {len(files)} 个文件待上传\n")
    # 先尝试获取默认分支信息
    data, code = api_request("GET", f"https://api.github.com/repos/{OWNER}/{REPO}")
    if code != 200:
        print(f"仓库访问失败: {data.get('error', data)}")
        return
    default_branch = data.get("default_branch", "main")
    global BRANCH
    BRANCH = default_branch
    print(f"默认分支: {default_branch}")

    ok, fail = 0, 0
    for path, local in files:
        result, _ = api_request("GET", API + urllib.parse.quote(path), None)
        sha = result.get("sha") if isinstance(result, dict) else None
        success, _ = upload_file(path, local, sha)
        if success:
            ok += 1
            print(f"  [OK] {path}")
        else:
            fail += 1
            print(f"  [FAIL] {path}: {_}")
    print(f"\n完成: {ok} 成功, {fail} 失败")

if __name__ == "__main__":
    main()
