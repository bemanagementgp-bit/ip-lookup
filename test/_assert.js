/** Tiny test harness: test(name, fn) + summary on exit. */
const assert = require('assert');
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
async function run() {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('  ok   ' + t.name); }
    catch (e) { failed++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.message)); }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0); // don't wait for cached-list timers
}
setImmediate(run);
module.exports = { test, assert };
