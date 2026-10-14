#!/bin/bash

set -uo pipefail



export PATH="/Users/liuxiong/.npm-global/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

if [ -d "$HOME/.nvm/versions/node" ]; then

  NODE_DIR=$(ls "$HOME/.nvm/versions/node" | sort -V | tail -1)

  export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"

fi



REPO="/Users/liuxiong/Desktop/internal-system"

REMOTE="git@github.com:q1345145552-source/neibuwangzhan.git"

LOCK="$REPO/.dispatch.lock"

LOG="$REPO/dispatch.log"

CODEX="/Users/liuxiong/.npm-global/bin/codex"



cd "$REPO" || { echo "仓库路径不存在: $REPO"; exit 1; }

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }



if [ -f "$LOCK" ]; then

  age=$(( $(date +%s) - $(stat -f %m "$LOCK") ))

  [ "$age" -lt 10800 ] && exit 0

  rm -f "$LOCK"

fi

touch "$LOCK"

trap 'rm -f "$LOCK"' EXIT



if ! git remote | grep -q '^origin$'; then

  git remote add origin "$REMOTE"

  log "已配置 origin"

fi



git fetch origin main 2>>"$LOG" || { log "fetch 失败"; exit 0; }

git checkout -q main 2>>"$LOG"

git pull -q --ff-only origin main 2>>"$LOG" || { log "pull 失败"; exit 0; }



PROGRESS=$(cat progress.txt 2>/dev/null | tr -dc '0-9')

PROGRESS=${PROGRESS:-0}

TOTAL=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('prompts.json','utf8')).rounds.length)}catch(e){console.log(0)}" 2>/dev/null)

TOTAL=${TOTAL:-0}



[ "$PROGRESS" -ge "$TOTAL" ] && exit 0



log "检测到任务:进度 $PROGRESS / 共 $TOTAL 轮,开始执行"



while [ "$PROGRESS" -lt "$TOTAL" ]; do

  ROUND=$((PROGRESS + 1))

  TITLE=$(node -e "const r=JSON.parse(require('fs').readFileSync('prompts.json','utf8')).rounds[$PROGRESS];console.log(r.title||'')" 2>/dev/null)

  PROMPT=$(node -e "const r=JSON.parse(require('fs').readFileSync('prompts.json','utf8')).rounds[$PROGRESS];console.log(r.prompt)" 2>/dev/null)



  log "=== 第 $ROUND/$TOTAL 轮 $TITLE 开始 ==="



  FULL=$(printf '以下是第 %s 轮任务,只做这一轮要求的事,别动其他无关代码:\n\n%s\n\n改完代码后,自己跑 npx tsc --noEmit 和 npm run build 验证,报错就自己修,直到编译通过。改完并验证通过后就停下来,不要执行任何 git 操作。' "$ROUND" "$PROMPT")



  "$CODEX" exec --dangerously-bypass-approvals-and-sandbox "$FULL" >>"$LOG" 2>&1

  code=$?

  if [ $code -ne 0 ]; then

    log "第 $ROUND 轮 codex 失败(exit=$code),停止"

    exit 1

  fi



  git add -A

  git commit -q -m "第${ROUND}轮:$TITLE(Codex自动)" 2>>"$LOG" || log "第 $ROUND 轮无改动"

  echo "$ROUND" > progress.txt

  git add progress.txt

  git commit -q -m "第${ROUND}轮完成,进度=$ROUND" 2>>"$LOG" || true

  git push -q origin main 2>>"$LOG" || { log "第 $ROUND 轮 push 失败"; exit 1; }



  log "=== 第 $ROUND 轮完成并推送 ==="

  PROGRESS=$ROUND

done



log "全部 $TOTAL 轮完成"

