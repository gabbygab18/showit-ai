# Showit AI: mobile helper

Checks and fixes the **mobile** version of a Showit site. It works inside the normal Showit editor, and you can watch its cursor (with a small avatar) do the work. **Desktop is never changed.** Nothing goes live until you click **Publish** in Showit.

## Install the app (Windows)

1. Install **Google Chrome**.
2. Run **`Showit AI Setup 1.0.0.exe`**. It's unsigned, so Windows SmartScreen warns the first time: choose "More info", then "Run anyway".
3. Open **Showit AI** (desktop shortcut). Click **Open Showit**. A separate Chrome window opens: log in to Showit there and open your site in the editor. Your login is remembered.

The app panel then shows the buttons:

| Button | What it does | Changes the site? |
|---|---|---|
| Check this page / all pages | Lists mobile problems (Issues tab) | No |
| Preview fixes | Cursor tour of each fix it would make | No |
| Fix this page / all pages | Applies the fixes (asks first) | Yes (mobile only) |
| Rebuild a section | Show plan, then rebuild one section from desktop | Yes (mobile only) |
| History → Undo | Puts a run's changes back | Yes (puts things back) |
| Stop | Stops before the next edit; nothing is left half done | |

Closing the panel hides it to the tray (bottom-right, by the clock); quit from the tray icon's menu. The app keeps its log and Showit login in `%APPDATA%\Showit AI`.

To build the installer yourself: `npm install`, then `npm run dist` (output in `release/`).

## Without the app (command line)

Needs **Node.js LTS** (https://nodejs.org). Double-click **`ShowitAI.cmd`** (first run installs what it needs), choose **1** to open the Showit window, then:

| Option | What it does | Changes the site? |
|---|---|---|
| 2 / 3 | Check this page / all pages and list problems | No |
| 4 | Cursor tour: shows each fix it would make | No |
| 5 / 6 | Fix this page / all pages | Yes (mobile only) |
| 7 | Rebuild one section's mobile layout from its desktop layout | Yes (mobile only) |
| 8 | Undo a previous run | Yes (puts things back) |

Leave the Showit window alone while the tool is working.

## What it fixes

- Text smaller than **12px** on mobile is set to 12px.
- Text slightly off the edge of the screen is slid back. Text lined up in a column moves together.
- Text boxes too small for their text: small text is widened, big headings just get a taller box (looks the same).
- Small text crowded against the text above it (gap under 6px) is moved down a little. The section grows if needed.

## What it never touches (reports only)

- Images or galleries that bleed off the edge, and scrolling text strips (usually deliberate design).
- Overlapping text: often deliberate (big titles behind text). Check these yourself.
- Locked elements (the lock icon in Showit).
- Blog post text that WordPress fills in.

## Safety

- After every change it re-reads the site and checks that mobile changed as intended and desktop did not. If not, it undoes the change and stops.
- If a fix would create a new problem (e.g. an overlap), it undoes that fix and leaves it for you.
- **Header and Footer are shared by all pages.** A fix there shows on every page.
- Every change is recorded in `fixes-log.json`. **History** in the app (option **8** on the command line) lists runs and undoes the one you pick. Anything you edited by hand afterwards is left alone.
- Showit's own undo (Ctrl+Z) also works.

## Rebuild a section (option 7)

Type the section name exactly as shown in Showit's layers panel (for example `About`). It shows the plan first and asks before changing anything. Result: one column, top-to-bottom in desktop reading order, full-width text, photos scaled to fit, section height adjusted. Text laid over a photo is kept on top only when the photo is the section's full background. Always check the result in Preview. Undo with option 8.

## The cursor and avatar

While working, the tool shows a macOS-style pointer with an avatar beside it and a speech bubble saying what it's doing. The avatar is the file **`avatar.svg`** in this folder (currently "Ember" from avatar-app, trimmed to just the round body). To use a different one:

1. In the `avatar-app` folder run `npm run dev`, open http://localhost:3000/studio and design the avatar.
2. In the **Export** tab, export it as **SVG** with a **transparent** background.
3. Save the file as `avatar.svg` in `%APPDATA%Showit AI` (app) or in this folder (command line). Delete `avatar.svg` to show a plain "Showit AI" tag instead.

## When something goes wrong

- **"The tool's Chrome window is not open"**: choose 1.
- **"Open the Showit editor"**: log in and open your site in the tool's Chrome window (not your normal Chrome).
- **"The Showit editor did not respond as expected"**: close any Showit popup and try again. If it keeps happening, Showit may have updated its editor and the tool needs an update. Whatever it changed before stopping can be undone with option 8.

## Limits

- Relies on how Showit's editor works today. A Showit update can stop it working until the tool is updated. It stops instead of guessing.
- Tested on the Lūce template (all 15 pages). Other templates should work but are not yet tested.
- Windows only for the one-click launcher (the scripts themselves also run on Mac with `node`).

## For developers

`audit.js` (find problems) · `fix.js` (apply fixes) · `rebuild.js` (desktop → mobile) · `restore.js` (undo) · `editor.js` (drives the Showit editor) · `cursor.js` (visible cursor) · `connect.js` (Chrome connection) · `electron/` + `src/` (the desktop app, built like Orbit: Electron, React, Glint UI). `npm run dev` opens the app with hot reload. `npm test` runs the built-in checks. Set `DEBUG=1` for full error details.
# showit-ai
