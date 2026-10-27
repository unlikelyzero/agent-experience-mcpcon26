#!/usr/bin/env python3
"""Renders what a screen reader announces for the What-Iff Memory Manager at each tier.

The phrases follow the accessibility tree a Playwright MCP agent received on the memories page in
run T2-r1 of each tier (roles, names and states, VoiceOver-style wording). Each phrase is spoken
on its own and joined into audio/<tier>.wav; audio/cues.json records when each one starts, keyed
by the cue the deck highlights (data-cue on tree lines and transcript lines). macOS only: needs
`say` and `afconvert`.
"""
import json, os, subprocess, tempfile, wave

RATE = 22050
GAP = 0.25  # seconds of silence after each phrase
TIERS = {
    'soup': [
        ('Memory Manager, heading level 1.', 'h1'),
        ('Memories.', 'tab1'), ('Merge history.', 'tab2'), ('Compaction log.', 'tab3'),
        ('User.', 'user'), ('Thread.', 'thread'),
        ('Trip Planner.', 'tp'), ('Personality.', 'tp'), ('October 21.', 'date'), ('vertical ellipsis.', 'menu'),
        ('Prefers aisle seats on flights.', 'text'), ('60 percent, medium confidence.', 'conf'),
    ],
    'wcag': [
        ('Memory Manager, heading level 1.', 'h1'),
        ('Memory manager sections, tab group.', 'tabs'), ('Memories, selected, tab, 1 of 3.', 'tab1'),
        ('Memories, list, 14 items.', 'list'),
        ('Select memory, checkbox, unchecked.', 'cb1'), ('More actions, button.', 'btn1'),
        ('Select memory, checkbox, unchecked.', 'cb2'), ('More actions, button.', 'btn2'),
        ('Select memory, checkbox, unchecked.', 'cb3'), ('More actions, button.', 'btn3'),
    ],
    'patterns': [
        ('Memory Manager, heading level 1.', 'h1'),
        ('Memory manager sections, tab group.', 'tabs'), ('Memories, selected, tab, 1 of 3.', 'tab1'),
        ('Memories, list, 14 items.', 'list'),
        ('Prefers aisle seats on flights, Trip Planner, active.', 'item'),
        ('Select memory: Prefers aisle seats on flights, checkbox, unchecked.', 'cb'),
        ('More actions for: Prefers aisle seats on flights, button.', 'btn'),
    ],
}

here = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(here, 'audio'), exist_ok=True)
cues = {}
with tempfile.TemporaryDirectory() as tmp:
    for tier, phrases in TIERS.items():
        frames, t, cues[tier] = [], 0.0, []
        for i, (text, cue) in enumerate(phrases):
            aiff, wav = os.path.join(tmp, f'{i}.aiff'), os.path.join(tmp, f'{i}.wav')
            subprocess.run(['say', '-v', 'Samantha', '-r', '210', '-o', aiff, text], check=True)
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEI16@{RATE}', '-c', '1', aiff, wav], check=True)
            with wave.open(wav) as w:
                data = w.readframes(w.getnframes())
            dur = len(data) / 2 / RATE
            cues[tier].append({'t': round(t, 3), 'end': round(t + dur, 3), 'cue': cue})
            frames.append(data + b'\0\0' * int(GAP * RATE))
            t += dur + GAP
        with wave.open(os.path.join(here, 'audio', f'{tier}.wav'), 'wb') as out:
            out.setnchannels(1); out.setsampwidth(2); out.setframerate(RATE)
            out.writeframes(b''.join(frames))
        print(f'{tier}: {len(phrases)} phrases, {t:.1f}s')
with open(os.path.join(here, 'audio', 'cues.json'), 'w') as f:
    json.dump(cues, f, indent=1)
