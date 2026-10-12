/** Runs every browser check in turn and fails if any line says FAIL. */
import { spawnSync } from 'node:child_process'

const scripts = ['shots', 'behaviour1', 'behaviour2', 'behaviour3', 'behaviour4', 'behaviour5', 'behaviour6', 'mobile']
let failed = 0
for (const name of scripts) {
  console.log(`\n== ${name}`)
  const r = spawnSync('node', [new URL(`./${name}.mjs`, import.meta.url).pathname], { encoding: 'utf8' })
  process.stdout.write(r.stdout)
  process.stderr.write(r.stderr)
  const fails = (r.stdout.match(/^FAIL/gm) ?? []).length
  failed += fails || (r.status ? 1 : 0)
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
