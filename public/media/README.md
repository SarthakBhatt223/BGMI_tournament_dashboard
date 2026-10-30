# Media folder

Served by the backend at `/media`. Nothing here is generated or downloaded automatically.

- `ambient.mp4` - the ambient loop shown on `/display`. Export it from Canva as MP4 and
  copy it here with exactly this name (or change `display.ambientVideoFile` in the event
  configuration). If the file is missing the display shows a neutral placeholder.
- `backdrop.mp4` - optional looping background video (e.g. exported from Canva) layered over the
  built-in tactical background on the standings, MVP and ambient-fallback screens. Hidden until it
  loads; if missing, nothing is shown. No code change is needed to add or replace it.
- `players/<playerId>.jpg` (or `.jpeg`, `.png`, `.webp`) - optional player photographs for the MVP
  showcase. The player id is the "ID n" label next to each player in the Roster tab (for example
  `players/17.jpg`; hover the label to see the file name). Without a photo the MVP frame shows character artwork instead.
- `mvp-character.png` (or `.webp`) - your own MVP artwork, shown in the MVP frame (the artwork
  holder) when the selected player has no photo. Drop the file in, reload `/display`; no code change.
  Recommended size 1020x1620 px (17:27 portrait). It is scaled to cover the frame and cropped from
  the bottom, so keep the head and shoulders in the upper part. A transparent cut-out works too.
  If the file is missing the frame shows a clean tactical placeholder with the player's initials. A player
  photo (`players/<id>.*`) always takes precedence. Use only artwork you have the right to use.
- `backdrop.jpg` - optional artwork (your own, e.g. from Canva, 1920x1080) behind every `/display`
  mode. When it (or `backdrop.mp4`) loads, the built-in skyline and silhouettes step aside; the glow,
  smoke and particles stay. Without it, the built-in animated tactical background is shown. The
  motion is CSS only and is switched off entirely when the OS "reduce motion" setting is on.
- `logos/` - team logos uploaded from the admin panel (PNG, JPEG or WebP). Created automatically.

Files in this folder are ignored by git, except this README.
