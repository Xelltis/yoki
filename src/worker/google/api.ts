// GoogleのAPI（OAuthとカレンダー）。本物（realGoogle）と、開発用の偽物（dev.tsのfakeGoogle）が同じ形を持つ。
// 使うのは本人のメインのカレンダー（primary）だけ。scopeはcalendar.events.owned（本人が持つカレンダーの予定を書く・読む。共有されたほかの人の
// カレンダーには届かない、いちばん狭いもの）と、だれの連携かを知るopenid email
import { jstMs } from '../lib/ics';

export const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events.owned';
/** Googleでログインするときのscope（だれかを知るだけ。カレンダーには触らない） */
export const GOOGLE_LOGIN_SCOPE = 'openid email';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
/** 予定を読むときのページの数の上限（1ページ250件） */
const MAX_PAGES = 4;

type When = { date: string } | { dateTime: string; timeZone: string };

/** 書き込む予定。extendedProperties.private.yoki = '1' がYokiの書いた印（読むときに除く） */
export type GoogleEventBody = {
  summary: string;
  location: string;
  description: string;
  start: When;
  end: When;
  source: { title: string; url: string };
  extendedProperties: { private: { yoki: '1'; session: string } };
};

/** 予定ありの時間（UTCのミリ秒。[start, end)） */
export type Busy = { start: number; end: number };

/** refresh tokenが使えない（本人がGoogleで取り消した・期限が切れた）。連携し直してもらう */
export class GoogleRevoked extends Error {}

export class GoogleHttpError extends Error {
  constructor(readonly status: number, what: string) {
    super(what + 'が失敗しました（HTTP ' + status + '）');
  }
}

export type GoogleApi = {
  /** 同意の画面のURL */
  authorizeUrl(redirectUri: string, state: string): string;
  /** 認可コードをrefresh tokenと、連携したGoogleアカウントのメールに換える */
  exchangeCode(code: string, redirectUri: string): Promise<{ refreshToken: string; email: string }>;
  /** ログインの同意の画面のURL（openid emailだけ。アカウントを選んでもらう） */
  loginUrl(redirectUri: string, state: string): string;
  /** ログインの認可コードを、GoogleのアカウントのID（sub）とメールに換える */
  exchangeLogin(code: string, redirectUri: string): Promise<{ sub: string; email: string }>;
  accessToken(refreshToken: string): Promise<string>;
  /** 許可を取り消す（連携を外すとき。失敗しても投げない） */
  revoke(refreshToken: string): Promise<void>;
  insertEvent(accessToken: string, body: GoogleEventBody): Promise<string>;
  /** 書き直す。予定がGoogle側で消されていれば 'gone' */
  updateEvent(accessToken: string, eventId: string, body: GoogleEventBody): Promise<'ok' | 'gone'>;
  /** 消す。もう無ければそのまま */
  deleteEvent(accessToken: string, eventId: string): Promise<void>;
  /** 予定ありの時間（Yokiが書いた予定・予定なしの予定・欠席の予定は除く） */
  busy(accessToken: string, fromMs: number, toMs: number): Promise<Busy[]>;
};

/** Googleカレンダーの予定（読む欄だけ） */
export type GoogleEvent = {
  status?: string;
  transparency?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

const whenMs = (w: GoogleEvent['start']) => (w?.dateTime ? Date.parse(w.dateTime) : w?.date ? jstMs(w.date, 0) : NaN);

/** 予定を、予定ありの時間にする。数えない予定はnull。終日の予定は、日本時間の0時から次の日の0時まで */
export function toBusy(e: GoogleEvent): Busy | null {
  if (e.status === 'cancelled' || e.transparency === 'transparent' || e.extendedProperties?.private?.yoki === '1') return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;
  const start = whenMs(e.start), end = whenMs(e.end);
  return end > start ? { start, end } : null;
}

/**
 * id_token（JWT）の中身。トークンはGoogleのトークンの窓口からHTTPSで直接受け取ったものなので、署名は確かめない
 * （OpenID Connectの決まりで、直接受け取ったときはTLSの確かめで代えてよい）
 */
export function idTokenClaims(idToken: string | undefined): { sub?: string; email?: string; aud?: string } {
  const payload = idToken?.split('.')[1];
  if (!payload) return {};
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))) as { sub?: string; email?: string; aud?: string };
}

/** id_tokenからメールを読む */
export function emailOfIdToken(idToken: string | undefined): string {
  return String(idTokenClaims(idToken).email ?? '');
}

const form = (body: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
const bearer = (accessToken: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...init.headers, Authorization: 'Bearer ' + accessToken } });
const json = (accessToken: string, method: string, body: unknown) => bearer(accessToken, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function realGoogle(clientId: string, clientSecret: string): GoogleApi {
  return {
    authorizeUrl(redirectUri, state) {
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPE,
        // refresh tokenを受け取るため。prompt=consentで、連携し直したときも必ず受け取る
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      return AUTH + '?' + q.toString();
    },

    async exchangeCode(code, redirectUri) {
      const res = await fetch(TOKEN, form({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }));
      if (!res.ok) throw new GoogleHttpError(res.status, 'Googleのトークンの取得');
      const j = (await res.json()) as { refresh_token?: string; id_token?: string };
      if (!j.refresh_token) throw new Error('Googleからrefresh tokenが返りませんでした。');
      return { refreshToken: j.refresh_token, email: emailOfIdToken(j.id_token) };
    },

    loginUrl(redirectUri, state) {
      const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_LOGIN_SCOPE, prompt: 'select_account', state });
      return AUTH + '?' + q.toString();
    },

    async exchangeLogin(code, redirectUri) {
      const res = await fetch(TOKEN, form({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }));
      if (!res.ok) throw new GoogleHttpError(res.status, 'Googleのログイン');
      const claims = idTokenClaims(((await res.json()) as { id_token?: string }).id_token);
      // ほかのアプリに向けて出されたid_tokenは受け取らない
      if (!claims.sub || claims.aud !== clientId) throw new Error('Googleのログインを確かめられませんでした。');
      return { sub: claims.sub, email: String(claims.email ?? '') };
    },

    async accessToken(refreshToken) {
      const res = await fetch(TOKEN, form({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }));
      if (res.status === 400 || res.status === 401) {
        const err = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        if (err === 'invalid_grant' || err === 'unauthorized_client') throw new GoogleRevoked('Googleの許可が取り消されたか、期限が切れました。');
      }
      if (!res.ok) throw new GoogleHttpError(res.status, 'Googleのトークンの更新');
      return ((await res.json()) as { access_token: string }).access_token;
    },

    async revoke(refreshToken) {
      await fetch(REVOKE, form({ token: refreshToken })).catch(() => undefined);
    },

    async insertEvent(accessToken, body) {
      const res = await fetch(EVENTS, json(accessToken, 'POST', body));
      if (!res.ok) throw new GoogleHttpError(res.status, 'Googleカレンダーへの書き込み');
      return ((await res.json()) as { id: string }).id;
    },

    async updateEvent(accessToken, eventId, body) {
      const res = await fetch(EVENTS + '/' + encodeURIComponent(eventId), json(accessToken, 'PUT', body));
      if (res.status === 404 || res.status === 410) return 'gone';
      if (!res.ok) throw new GoogleHttpError(res.status, 'Googleカレンダーの書き直し');
      return 'ok';
    },

    async deleteEvent(accessToken, eventId) {
      const res = await fetch(EVENTS + '/' + encodeURIComponent(eventId), bearer(accessToken, { method: 'DELETE' }));
      if (!res.ok && res.status !== 404 && res.status !== 410) throw new GoogleHttpError(res.status, 'Googleカレンダーの予定の削除');
    },

    async busy(accessToken, fromMs, toMs) {
      const out: Busy[] = [];
      let pageToken = '';
      for (let page = 0; page < MAX_PAGES; page++) {
        const q = new URLSearchParams({
          timeMin: new Date(fromMs).toISOString(),
          timeMax: new Date(toMs).toISOString(),
          singleEvents: 'true',
          maxResults: '250',
          showDeleted: 'false',
          // 時間を決めるのに要る欄だけを受け取る（予定の名前・場所・説明などは受け取らない）
          fields: 'nextPageToken,items(status,transparency,start,end,extendedProperties/private,attendees(self,responseStatus))',
        });
        if (pageToken) q.set('pageToken', pageToken);
        const res = await fetch(EVENTS + '?' + q.toString(), bearer(accessToken));
        if (!res.ok) throw new GoogleHttpError(res.status, 'Googleカレンダーの読み込み');
        const j = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
        for (const e of j.items ?? []) {
          const b = toBusy(e);
          if (b) out.push(b);
        }
        if (!j.nextPageToken) break;
        pageToken = j.nextPageToken;
      }
      return out;
    },
  };
}
