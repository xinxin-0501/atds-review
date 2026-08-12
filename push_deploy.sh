#!/bin/bash
# ATDS PRO 一键推送到 GitHub(首次运行需输入 Personal Access Token)
# 用法: bash push_deploy.sh

set -e
REPO_URL="https://github.com/xinxin-0501/atds-review.git"
BRANCH="main"

# 1. 检查是否已有远程
echo "=== 配置远程仓库 ==="
git remote remove origin 2>/dev/null || true

# 2. 提示输入 token(不回显)
echo "请先获取 Personal Access Token:"
echo "  1. 打开 https://github.com/settings/tokens"
echo "  2. Generate new token (classic)"
echo "  3. 勾选 repo 权限(整个 repo 复选框)"
echo "  4. 生成后复制 token 粘贴到下方"
read -rsp "输入 GitHub Personal Access Token: " TOKEN
echo
if [ -z "$TOKEN" ]; then
  echo "错误: token 为空"
  exit 1
fi

# 3. 用 token 作为密码推送
echo "=== 推送到 GitHub ==="
git remote add origin "https://xinxin-0501:${TOKEN}@github.com/xinxin-0501/atds-review.git"
git push -u origin "${BRANCH}" 2>&1 || {
  echo "推送失败,请检查 token 权限(需要 repo 权限)"
  git remote remove origin
  exit 1
}

# 4. 推送成功后移除带 token 的远程,恢复干净地址
git remote set-url origin "${REPO_URL}"
echo
echo "✅ 推送成功!"
echo "   仓库地址: https://github.com/xinxin-0501/atds-review"
echo "   工作流:  https://github.com/xinxin-0501/atds-review/actions"
echo "   完成后到 Settings → Pages → Source 选 GitHub Actions 开启 Pages"
