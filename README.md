# Cutroom

A video editor that runs in your browser, in the style of Descript.

## How to open it
Double-click `Start Cutroom.command`. It opens http://localhost:5180 in your browser.
Use Chrome or Edge for everything to work (live captions while recording need them).

Or in a terminal, from this folder: `python3 server.py`, then open http://localhost:5180.

## What it does
- Record: Screen + Face (your face in a circle on your screen), Screen, Camera, or Audio only. Turn the microphone off for video with no sound.
- Drop video or audio files anywhere to add them.
- Captions that follow your voice: live while recording, or "Generate captions" (runs Whisper on your computer).
- Edit by text: the Script tab shows every word. Drag across words and press Delete to cut them.
- Hold Return and drag on the timeline to select a part, then press Delete.
- Hold Right to play forward, hold Left to play backward. Tap them to step 1 second.
- 15 modes, the same ones as PetPost (`js/themes.js` is copied from PetPost).
- Thumbnails, free with no account or key: Best quality (AI Horde, 1 to 4 minute line) or Fast (Pollinations). `server.py` fetches them for the page.
- Photo editor (Photo button at the top): drop or take a photo, 17 filters (face squish, big head, mirrors, kaleidoscope, glitch, pop art and more), and hold Cmd+Shift to scribble pixel blur over anything. Hold Cmd+Option and click (or use Up/Down and Return) to mix up to 10 filters. Faces are found with Google MediaPipe, on this computer.
- Video filters (Effects tab): the same 17 filters, on the piece under the playhead or a Return+drag selection. Cmd+Option click mixes up to 10. They show live, in exports, and as FX badges on the timeline.
- Voice changer (Effects tab): Robot and 10 more voices on any part of a video.
- Record more (timeline toolbar): add a new recording at the end or at the playhead.
- Export to a 1080p WebM video or audio only, and captions as .srt.

## Online
The code is in the private GitHub repo `vibe331212/Cutroom`. Cloudflare Pages publishes it (no build command, output folder `/`).
`functions/` holds the Cloudflare Functions that make free thumbnails on the website (the same job `server.py` does on your computer).
Push to `main` and the website updates about a minute later.

## Files
- `server.py`: runs the app and fetches free thumbnails.
- `index.html`: the page layout and icons.
- `styles.css`: all the styling. Light and dark looks follow the mode.
- `js/photo.js`: the photo editor.
- `js/voices.js`: the 11 voices for the voice changer.
- `js/app.js`: the editor (timeline, playback, cutting, captions, recording, thumbnails, export).
- `js/themes.js`: the 15 animated modes, copied from PetPost. If PetPost's modes change, copy the file again.

## If the page looks broken
Your browser may be showing old saved files. Close Cutroom, open it again with `Start Cutroom.command`, and press Cmd+Shift+R in the browser.
