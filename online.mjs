// "npm run online": baut das Spiel und lädt es auf GitHub Pages hoch (Branch gh-pages).
// Der Link bleibt immer gleich: https://jakobebinger.github.io/dackel-rennen/
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });
const repo = execSync('git remote get-url origin').toString().trim();
const name = execSync('git config user.name').toString().trim();
const email = execSync('git config user.email').toString().trim();

run('npx vite build');
writeFileSync('dist/.nojekyll', ''); // GitHub soll die Dateien unverändert ausliefern
rmSync('dist/.git', { recursive: true, force: true });
run('git init -q -b gh-pages', 'dist');
run(`git -c user.name="${name}" -c user.email="${email}" add -A`, 'dist');
run(`git -c user.name="${name}" -c user.email="${email}" commit -q -m "Spiel-Update ${new Date().toISOString().slice(0, 16)}"`, 'dist');
run(`git push -q -f ${repo} gh-pages`, 'dist');
rmSync('dist/.git', { recursive: true, force: true });
console.log('\nHochgeladen! In 1-2 Minuten online: https://jakobebinger.github.io/dackel-rennen/');
