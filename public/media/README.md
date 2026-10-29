# Media folder

Served by the backend at `/media`. Nothing here is generated or downloaded automatically.

- `ambient.mp4` - the ambient loop shown on `/display`. Export it from Canva as MP4 and
  copy it here with exactly this name (or change `display.ambientVideoFile` in the event
  configuration). If the file is missing the display shows a neutral placeholder.
- `logos/` - team logos uploaded from the admin panel (PNG, JPEG or WebP). Created automatically.

Files in this folder are ignored by git, except this README.
