# Phase 1 — 3D motion foundation

Branch: `autovideo-motion-v2`

## Known issues

### Grasp visual quality (open)
Grasp visual quality: palm curves unnaturally during grip; hand does not read as wrapped around the cup in close-up. Numeric checks pass. Needs visual fix in a later pass. Affects cup, book, phone.

Frames to review (1A cup close-up, `videos/_tests/phase1/1A_cup_hand.mp4`, rendered by `tests/motion_lab.py cup hand`):

| Stage | Time |
|---|---|
| Reach | 1.55 s |
| Grasp | 2.45 s |
| Lift  | 3.0 s |

Stage sheet with the same frames from two angles: `videos/_tests/phase1/fixes/grasp_fix_stages_closeup.png`.
Videos are local only (`videos/` is gitignored); re-render with the command above.
