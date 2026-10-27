#!/bin/sh
# Renders what a screen reader announces for the What-Iff Memory Manager at each tier.
# The phrases follow the accessibility tree a Playwright MCP agent received on the
# memories page in run T2-r1 of each tier (roles, names and states, VoiceOver-style
# wording). macOS only: needs `say` and `afconvert`.
set -eu
cd "$(dirname "$0")"
mkdir -p audio

speak() { # name text
  say -v Samantha -r 210 -o "audio/$1.aiff" "$2"
  afconvert -f WAVE -d LEI16@22050 "audio/$1.aiff" "audio/$1.wav"
  rm "audio/$1.aiff"
}

speak soup "Memory Manager, heading level 1. [[slnc 300]]
Memories. [[slnc 200]] Merge history. [[slnc 200]] Compaction log. [[slnc 400]]
User. [[slnc 200]] Thread. [[slnc 400]]
Trip Planner. [[slnc 150]] Personality. [[slnc 150]] October 21. [[slnc 150]] vertical ellipsis. [[slnc 200]]
Prefers aisle seats on flights. [[slnc 150]] 60 percent, medium confidence."

speak wcag "Memory Manager, heading level 1. [[slnc 300]]
Memory manager sections, tab group. [[slnc 150]] Memories, selected, tab, 1 of 3. [[slnc 400]]
Memories, list, 14 items. [[slnc 300]]
Select memory, checkbox, unchecked. [[slnc 150]] More actions, button. [[slnc 300]]
Select memory, checkbox, unchecked. [[slnc 150]] More actions, button. [[slnc 300]]
Select memory, checkbox, unchecked. [[slnc 150]] More actions, button."

speak patterns "Memory Manager, heading level 1. [[slnc 300]]
Memory manager sections, tab group. [[slnc 150]] Memories, selected, tab, 1 of 3. [[slnc 400]]
Memories, list, 14 items. [[slnc 300]]
Prefers aisle seats on flights, Trip Planner, active. [[slnc 200]]
Select memory: Prefers aisle seats on flights, checkbox, unchecked. [[slnc 200]]
More actions for: Prefers aisle seats on flights, button."
