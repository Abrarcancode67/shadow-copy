# Shadow Copy 👻🐈

A minimalist neon browser game — collect gold orbs, avoid your own shadow clones (and the red hunter ghosts), survive as long as you can. Pure HTML/CSS/JS, no backend, no build step, no dependencies.

## Project structure
```
shadow-copy/
├── index.html          # page structure / screens (menu, HUD, game over, etc.)
├── css/
│   └── style.css       # all styling (theme, layout, animations)
├── js/
│   └── game.js         # all game logic (rendering, physics, input, scoring)
├── standalone/
│   └── index.html      # everything bundled into ONE file — handy for quick local testing
├── package.json
├── vercel.json
├── LICENSE
├── .gitignore
└── README.md
```

## Recent fixes
- Fixed the game screen not fitting fully on phone or desktop (now sizes itself against both viewport width and height).
- Removed the duplicate pause button that showed up twice on mobile.
- TIME / SCORE / BEST now sit in a bar above the game area instead of overlapping gameplay.
- Coins are now gold instead of blue, so they're clearly distinct from the player.
- Mobile joystick made smaller so it takes up less screen space.

## Play locally
Just open `index.html` in any browser (desktop or mobile) — double-click the file, or run a tiny local server:
```bash
npx serve .
```

## Deploy to GitHub
1. Create a new repository on GitHub (e.g. `shadow-copy`).
2. Upload everything in this folder to the repo — drag-and-drop on github.com, or via git:
   ```bash
   git init
   git add .
   git commit -m "Shadow Copy game"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/shadow-copy.git
   git push -u origin main
   ```

## Deploy to Vercel
**Option A — from GitHub (recommended, auto-redeploys on future pushes):**
1. Go to [vercel.com](https://vercel.com) → New Project.
2. Import the GitHub repo you just created.
3. Framework preset: choose **"Other"** (it's a static site, no build step needed).
4. Click Deploy. You'll get a live URL like `shadow-copy.vercel.app`.

**Option B — direct upload (no GitHub needed):**
1. Go to [vercel.com](https://vercel.com) → New Project → "Deploy" tab → drag and drop this whole folder.
2. Click Deploy.

That's it — no environment variables, no API keys, no database. 100% free to host on Vercel's Hobby tier.

## How to play
- **Move:** WASD or Arrow Keys (desktop), on-screen joystick (mobile, auto-detected)
- **Goal:** collect blue orbs, survive as long as possible
- Every 5 seconds, your movements from the last 5 seconds become a looping shadow ghost — avoid them
- Red ghosts are moving obstacles that patrol fixed paths — avoid those too
- Power-ups: 🟢 Shield (temporary invincibility), ⚡ Speed Boost, 🧲 Coin Magnet
- Difficulty ramps up (enemies speed up) every 30 seconds

## Notes
- High scores are saved locally per-device via `localStorage` — they are **not** shared between players.
- No build tools, frameworks, or external libraries required — everything runs from plain HTML/CSS/JS.
