import { readFile } from 'node:fs/promises'
const buf = await readFile('D:/soft/DeepSeek Harness/resources/app.asar')
const needle = Buffer.from('reloadPlugins')
let idx = -1
while ((idx = buf.indexOf(needle, idx + 1)) !== -1) {
  const start = Math.max(0, idx - 400)
  const end = Math.min(buf.length, idx + 500)
  console.log('--- at', idx, '---')
  console.log(buf.subarray(start, end).toString('utf8').replace(/[^\x20-\x7E\n\r\t]/g, '.'))
}
