// テストの前に、ローカルのD1にマイグレーションを当てる。テストごとに表を空にする（テストどうしが混ざらないように）
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// 子の表から順に消す（外部キーのため）
const TABLES = ['notify_log', 'member_scenarios', 'slot_hopes', 'session_sheets', 'session_slots', 'poll_votes', 'session_absences', 'day_notes', 'avail_notes', 'availability', 'google_dismissed', 'google_events', 'discord_events', 'session_people', 'sessions', 'scenarios', 'series_notify', 'members', 'calendar_feeds', 'groups', 'google_links', 'google_logins', 'auth_sessions', 'user_guilds', 'users', 'meta'];

beforeEach(async () => {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare('DELETE FROM ' + t)));
});
