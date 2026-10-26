import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

const file = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')
const db = new DatabaseSync(file, { readOnly: true })
console.log(db.prepare('select count(*) as n, sum(length(data)) as bytes from message').get())
const rows = db.prepare('select id, session_id, time_created, data from message order by time_created desc limit 3').all()
for (const row of rows) {
  console.log('---', row.id, row.session_id, row.time_created)
  console.log(row.data.slice(0, 900))
}
const roles = db.prepare("select json_extract(data,'$.role') as role, count(*) as n from message group by role").all()
console.log(roles)
