import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

const sh = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();

// Netlify exposes the built commit as COMMIT_REF; locally fall back to git, and
// to 'dev' when neither is available (a tarball with no .git, say).
function commitRef() {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7);
  try { return sh('git rev-parse --short=7 HEAD'); } catch { return 'dev'; }
}

function branch() {
  if (process.env.BRANCH) return process.env.BRANCH;
  try { return sh('git rev-parse --abbrev-ref HEAD'); } catch { return ''; }
}

// The PR number is what the trip owner actually recognises a build by ("is this
// #12?"), so surface it rather than only the commit. Netlify sets REVIEW_ID on
// deploy previews; locally ask gh for the PR open on this branch. Best-effort
// and fully swallowed — a missing gh, no network, or no PR must never fail a
// build, it just leaves the field blank.
function prNumber() {
  if (process.env.REVIEW_ID) return process.env.REVIEW_ID;
  try { return sh('gh pr view --json number -q .number'); } catch { return ''; }
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5199 },
  // Surfaced under Settings → Developer tools, so a rider reporting a problem
  // can say which build they are on.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commitRef()),
    __APP_BRANCH__: JSON.stringify(branch()),
    __APP_PR__: JSON.stringify(prNumber()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
});
