#!/bin/bash
# ./assemble.sh <soup runDir> <wcag runDir> <task id> <soup label> <wcag label> [soup step to flag] [note]
set -euo pipefail
cd "$(dirname "$0")"
FF=$(ls ~/Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-mac | tail -1)
"$FF" -hide_banner -loglevel error -i "$(ls "$1"/video/*.webm | head -1)" -c copy -y soup.webm
"$FF" -hide_banner -loglevel error -i "$(ls "$2"/video/*.webm | head -1)" -c copy -y wcag.webm
node build-steps.mjs "$1" soup.json "${6:-}" "${7:-}"
node build-steps.mjs "$2" wcag.json
python3 -I - "$3" "$4" "$5" "$1" <<'PY'
import sys, json, re
task, soup_label, wcag_label, run = sys.argv[1:5]
prompt = open(run + '/prompt.txt').read()
m = re.search(r'^Task: (.*)$', prompt, re.M)
s = open('index.template.html').read()
s = (s.replace('__TASK__', task).replace('__PROMPT__', m.group(1) if m else '')
      .replace('__SOUP_LABEL__', soup_label).replace('__WCAG_LABEL__', wcag_label)
      .replace('__SOUP_JSON__', open('soup.json').read()).replace('__WCAG_JSON__', open('wcag.json').read()))
open('index.html', 'w').write(s)
PY
echo "assembled index.html"
