// 開発用の偽の Google（GOOGLE_CLIENT_ID が dev-fake の開発サーバーだけ）。本物の Google の値が無くても、連携の流れを通しで確かめるため。
// 同意の画面は出さずに許可したことにし、書き込んだ予定と「予定あり」の時間は D1 の meta（dev_google）に置く。
// app.ts と config.ts が import.meta.env.DEV のときだけ使うので、本番の組み立てには入らない（vite.config.ts の noDevLogin が確かめる）
import type { Hono } from 'hono';
import type { AppEnv } from '../app';
import { isLocalHttp } from '../auth/session';
import { randomToken } from '../lib/ids';
import type { Busy, GoogleApi, GoogleEventBody } from './api';
import { GoogleRevoked } from './api';

const KEY = 'dev_google';
/** 偽の Google のアカウントの ID（ログインに使う） */
export const DEV_GOOGLE_SUB = 'dev-google-account';

/** 偽の Google の中身。events は書き込まれた予定、busy は「予定あり」の時間（ISO）、revoked は取り消した refresh token */
export type FakeState = { seq: number; events: Record<string, GoogleEventBody>; busy: { start: string; end: string }[]; revoked: string[] };

const empty = (): FakeState => ({ seq: 0, events: {}, busy: [], revoked: [] });

export async function readFake(db: D1Database): Promise<FakeState> {
  const v = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(KEY).first<string>('value');
  return v ? (JSON.parse(v) as FakeState) : empty();
}

export async function writeFake(db: D1Database, state: FakeState): Promise<void> {
  await db
    .prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(KEY, JSON.stringify(state))
    .run();
}

async function change<T>(db: D1Database, fn: (s: FakeState) => T): Promise<T> {
  const s = await readFake(db);
  const out = fn(s);
  await writeFake(db, s);
  return out;
}

/** 偽の Google。同意の画面は origin の /dev/google/authorize（すぐに許可して戻す） */
export function fakeGoogle(db: D1Database, origin: string): GoogleApi {
  return {
    authorizeUrl(redirectUri, state) {
      return origin + '/dev/google/authorize?' + new URLSearchParams({ redirect_uri: redirectUri, state }).toString();
    },
    async exchangeCode(code) {
      return { refreshToken: 'dev-refresh-' + code, email: 'dev@example.com' };
    },
    loginUrl(redirectUri, state) {
      return origin + '/dev/google/authorize?' + new URLSearchParams({ redirect_uri: redirectUri, state }).toString();
    },
    // 偽の Google のアカウントは 1 つだけ（開発用の人のだれにでも結びつけられる）
    async exchangeLogin() {
      return { sub: DEV_GOOGLE_SUB, email: 'dev@example.com' };
    },
    async accessToken(refreshToken) {
      if ((await readFake(db)).revoked.includes(refreshToken)) throw new GoogleRevoked('取り消されています（偽の Google）');
      return 'dev-access';
    },
    async revoke(refreshToken) {
      await change(db, (s) => void s.revoked.push(refreshToken));
    },
    async insertEvent(_at, body) {
      return change(db, (s) => {
        const id = 'dev-event-' + ++s.seq;
        s.events[id] = body;
        return id;
      });
    },
    async updateEvent(_at, eventId, body) {
      return change(db, (s) => {
        if (!s.events[eventId]) return 'gone' as const;
        s.events[eventId] = body;
        return 'ok' as const;
      });
    },
    async deleteEvent(_at, eventId) {
      await change(db, (s) => void delete s.events[eventId]);
    },
    async busy(_at, fromMs, toMs) {
      return (await readFake(db)).busy
        .map((b): Busy => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
        .filter((b) => b.end > fromMs && b.start < toMs);
    },
  };
}

export function registerGoogleDevRoutes(app: Hono<AppEnv>): void {
  // 同意の画面の代わり。すぐに許可したことにして、戻り先へ code と state を付けて返す。
  // code は毎回変える（refresh token は code から作るので、前に外して取り消した token と重ならないように）
  app.get('/dev/google/authorize', (c) => {
    if (!isLocalHttp(new URL(c.req.url))) return c.notFound();
    const back = new URL(c.req.query('redirect_uri') ?? '/', c.req.url);
    if (back.origin !== new URL(c.req.url).origin) return c.notFound();
    back.searchParams.set('code', 'dev-code-' + randomToken().slice(0, 8));
    back.searchParams.set('state', c.req.query('state') ?? '');
    return c.redirect(back.toString());
  });
  // 中身を見る（e2e が、書き込まれた予定を確かめる）
  app.get('/dev/google/state', async (c) => {
    if (!isLocalHttp(new URL(c.req.url))) return c.notFound();
    return c.json(await readFake(c.env.DB));
  });
  // 「予定あり」の時間を置き換える（e2e が、予定から印が入るのを確かめる）。{ busy: [{ start, end }]（ISO） }
  app.post('/dev/google/busy', async (c) => {
    if (!isLocalHttp(new URL(c.req.url))) return c.notFound();
    const body = (await c.req.json()) as { busy?: { start: string; end: string }[] };
    await change(c.env.DB, (s) => void (s.busy = body.busy ?? []));
    return c.json({ ok: true });
  });
}
