// 新規登録の受付（運営者が運営の管理画面で切り替える）。止めると、新しいグループの作成と、初めての人のログインを断る。
// もう使っている人と今あるグループは、そのまま使える。運営者は、止めていてもログインでき、グループも作れる（切り替えた人が締め出されないように）。
// 印はmetaのregistration。'closed' なら止めている。無ければ受け付ける
const KEY = 'registration';

export async function registrationOpen(db: D1Database): Promise<boolean> {
  return (await db.prepare('SELECT value FROM meta WHERE key = ?').bind(KEY).first<string>('value')) !== 'closed';
}

export async function setRegistrationOpen(db: D1Database, open: boolean): Promise<void> {
  await db.prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(KEY, open ? 'open' : 'closed').run();
}

/** その人がログインしてよいか。受付を止めていても、もう使っている人（usersに行がある人）と運営者はよい */
export async function mayLogIn(db: D1Database, userId: string, operator: boolean): Promise<boolean> {
  if (operator || (await db.prepare('SELECT 1 FROM users WHERE id = ?').bind(userId).first())) return true;
  return registrationOpen(db);
}
