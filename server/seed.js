// Seeds four fictional example stories so a fresh install isn't empty.
// They are tagged "Example" in the UI; delete them from the admin view (or
// run `npm run seed -- --clear`) once real stories come in.
import { openDatabase } from './db.js';

const db = await openDatabase();
const clear = process.argv.includes('--clear');
const key = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const day = 86_400_000, now = Date.now();

const EXAMPLES = [
  ['ex-northwind-sync', 'Northwind Logistics', 'Greg in Ops', 'Booked a "quick sync" at 4:55 on a Friday.', 'Joined twelve minutes late, camera off, and opened with "so what are we talking about?" We are all still there.', now - 0.3 * day],
  ['ex-cobalt-replyall', 'Cobalt Dynamics', 'Marcus in Marketing', 'Replied-all to say "please stop replying all."', 'Then did it twice more to clarify. 1,900 inboxes. Legend.', now - 0.6 * day],
  ['ex-meridian-refactor', 'Meridian Ops', 'Tyler in Engineering', 'His "small refactor" touched 214 files.', 'Commit message: "stuff." Reviewer: also Tyler.', now - 1.2 * day],
  ['ex-pinegrove-family', 'Pinegrove Health', 'Dana in HR', 'Sent the "we\'re a family" email 40 minutes before cancelling PTO rollover.', 'Subject line was "Exciting updates!" Nobody has recovered.', now - 4 * day],
];

if (clear) {
  await db.run('DELETE FROM votes WHERE story_id IN (SELECT id FROM stories WHERE example = 1)');
  await db.run('DELETE FROM stories WHERE example = 1');
  console.log('Removed example stories.');
} else {
  for (const [id, company, who, title, body, at] of EXAMPLES) {
    const exists = await db.get('SELECT 1 AS x FROM stories WHERE id = ?', [id]);
    if (exists) continue;
    await db.run('INSERT INTO stories (id, company, company_key, who, title, body, author, example, created_at) VALUES (?,?,?,?,?,?,?,1,?)',
      [id, company, key(company), who, title, body, 'seed', Math.round(at)]);
  }
  console.log('Seeded example stories.');
}
await db.close();
