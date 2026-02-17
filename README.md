# TDFC Homepage Revamp Prototype

Single-file homepage prototype with a dense 3D Ethereum cube surface:

- Full-page background made of touching cubes (no gaps)
- Thousands of cubes rendered at once
- Each cube maps to a generated Ethereum transaction ID (`0x...`) and displays characters from that ID
- Mouse hover raises a local cluster and rotates cubes on their own axis to a new transaction character
- Lighter gray palette for clearer depth contrast

## Project Files

- `index.html` - Full prototype (HTML, CSS, JavaScript in one file)
- `README.md` - Setup and deployment notes

## Run Locally

```bash
cd /Users/silasrowlands/Desktop/Code/tdfc-revamp-homepage
open index.html
```

Optional local server:

```bash
cd /Users/silasrowlands/Desktop/Code/tdfc-revamp-homepage
python3 -m http.server 8080
```

Then open <http://localhost:8080>

## Git Setup

```bash
cd /Users/silasrowlands/Desktop/Code/tdfc-revamp-homepage
git init
git add .
git commit -m "Add 3D ethereum cube background prototype"
```

If commit fails because Git user identity is missing:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
git commit -m "Add 3D ethereum cube background prototype"
```

## GitHub Pages Deployment

1. Create a repo on GitHub (example: `tdfc-revamp-homepage`).
2. Push code:

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/tdfc-revamp-homepage.git
git push -u origin main
```

3. On GitHub: `Settings -> Pages`.
4. Choose:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
5. Site URL:

```text
https://<your-username>.github.io/tdfc-revamp-homepage/
```
