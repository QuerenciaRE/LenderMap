Paste this as the first message in Claude Code on the web (claude.ai/code), repository QuerenciaRE/LenderMap, branch main:

---
Read CLAUDE.md and docs/HANDOFF.md first. This is a static site plus a Python data pipeline that GitHub Actions runs; the site data is never committed. Please:
1. Confirm the repo is on the current version: scripts/run_all.sh downloads BAMLC0A4CBBB, .github/workflows/build.yml has a `push` trigger, and CLAUDE.md exists. If anything is missing, tell me exactly which file.
2. Syntax-check every Python file in scripts/ (python -m py_compile) and site/app.js (node --check). Fix only true syntax errors.
3. Give me a five-line summary of what the project does and the three improvements you would suggest next, in plain language.
Do not run the data pipeline (it downloads ~0.7 GB). Keep replies short; I am not a developer. When I ask for changes later: make them on your branch, run the checks, and tell me when to click Create PR; merging to main deploys automatically.
---
