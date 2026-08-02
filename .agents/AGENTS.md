# Workspace Rules

## Automated Git Commit & Deployment
After making any code changes in this workspace:
1. Always run TypeScript check (`npx tsc --noEmit` in `frontend/`) and build check to ensure zero build errors.
2. Automatically stage (`git add .`), commit with a clear conventional commit message, and push (`git push origin main`) to GitHub so Vercel triggers a new deployment automatically.
