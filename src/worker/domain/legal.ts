// 利用規約とプライバシーポリシー（/terms・/privacy）。運営者が運営の管理画面で、運営者の名前・問い合わせ先・本文を直す。
// 印はmetaのlegal_operator・legal_contactと、直した本文のlegal_terms・legal_privacy（{"text","at"}のJSON）。
// 本文の行が無ければ、既定の文（legal-text.ts）を出す。空か既定の文と同じにして保存すると、行を消して既定の文に戻す
import { type AdminLegal, LEGAL_KINDS, LEGAL_MAX, LEGAL_TITLES, type LegalKind } from '../../shared/admin';
import { badRequest } from '../lib/errors';
import { jst } from '../lib/jst';
import { type Form, str } from './form';
import { DEFAULT_LEGAL, DEFAULT_LEGAL_DATE } from './legal-text';

const upsert = 'INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value';

export async function readLegal(db: D1Database): Promise<AdminLegal> {
  const rows = (await db.prepare("SELECT key, value FROM meta WHERE key IN ('legal_operator', 'legal_contact', 'legal_terms', 'legal_privacy')").all<{ key: string; value: string }>()).results;
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const doc = (k: LegalKind) => {
    const saved = m.get('legal_' + k);
    const v = saved ? (JSON.parse(saved) as { text: string; at: string }) : { text: DEFAULT_LEGAL[k], at: DEFAULT_LEGAL_DATE };
    return { text: v.text, custom: !!saved, updatedAt: v.at, defaultText: DEFAULT_LEGAL[k] };
  };
  return { operator: m.get('legal_operator') ?? '', contact: m.get('legal_contact') ?? '', terms: doc('terms'), privacy: doc('privacy') };
}

/** 本文の改行をそろえ、前後の空白を除く */
const normText = (v: unknown) => String(v ?? '').replace(/\r\n?/g, '\n').trim();

/**
 * 運営者の名前・問い合わせ先・本文を保存する。form: { operator?, contact?, terms?, privacy? }（省いたものは変えない）。
 * 本文は、中身が変わったときだけ更新日を今日（日本時間）にする。変えた本文の種類を返す
 */
export async function saveLegal(db: D1Database, form: Form, now: Date): Promise<{ changed: LegalKind[] }> {
  const cur = await readLegal(db);
  const stmts: D1PreparedStatement[] = [];
  const changed: LegalKind[] = [];
  for (const [key, label] of [['operator', '運営者の名前'], ['contact', '問い合わせ先']] as const) {
    if (form[key] === undefined) continue;
    const v = str(form[key]);
    if (v.length > LEGAL_MAX[key]) throw badRequest(label + 'は' + LEGAL_MAX[key] + '文字までです。');
    stmts.push(v ? db.prepare(upsert).bind('legal_' + key, v) : db.prepare('DELETE FROM meta WHERE key = ?').bind('legal_' + key));
  }
  for (const k of LEGAL_KINDS) {
    if (form[k] === undefined) continue;
    // 空なら既定の文
    const text = normText(form[k]) || DEFAULT_LEGAL[k];
    if (text.length > LEGAL_MAX.text) throw badRequest(LEGAL_TITLES[k] + 'は' + LEGAL_MAX.text + '文字までです。');
    if (text === cur[k].text) continue;
    changed.push(k);
    stmts.push(
      text !== DEFAULT_LEGAL[k]
        ? db.prepare(upsert).bind('legal_' + k, JSON.stringify({ text, at: jst(now).ymd }))
        : db.prepare('DELETE FROM meta WHERE key = ?').bind('legal_' + k),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return { changed };
}
