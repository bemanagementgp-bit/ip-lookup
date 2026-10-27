/** Runs every test/*.test.js in its own process: `npm test` */
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
let failed = 0;
for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) {
  console.log('\n# ' + f);
  try { execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' }); } catch (e) { failed++; }
}
if (failed) { console.log(`\n${failed} file(s) failed`); process.exit(1); } else console.log('\nall test files passed');
