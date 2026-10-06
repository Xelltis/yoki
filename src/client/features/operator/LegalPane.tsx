// 運営者の管理画面の「規約」。利用規約とプライバシーポリシーの運営者の名前・問い合わせ先・本文。
// 書きかけ（保存していない）なら、読み直しても入力を上書きしない。「既定の文に戻す」は入力に既定の文を入れるだけ（保存で決まる）
import { useState } from 'react';
import { type AdminLegal, LEGAL_MAX, LEGAL_TITLES, type LegalKind } from '../../../shared/admin';
import { Icon } from '../../ui/Icon';
import { ADMIN_READS, useAct, useAdmin } from './api';
import { longDate } from './format';

type Fields = { operator: string; contact: string; terms: string; privacy: string };
/** 運営者の名前・問い合わせ先の欄（横に並べる） */
const rowLabel = 'flex-[1_1_260px] text-13 font-semibold';
const rowInput = 'mt-4 block w-full max-w-640';
const IDS: Record<LegalKind, { area: string; state: string }> = { terms: { area: 'lgTerms', state: 'lgTermsState' }, privacy: { area: 'lgPrivacy', state: 'lgPrivacyState' } };

export function LegalPane() {
  const legal = useAdmin<AdminLegal>(ADMIN_READS.legal.queryKey, ADMIN_READS.legal.path).data;
  const act = useAct();
  const [draft, setDraft] = useState<Fields | null>(null);
  const f: Fields = draft || (legal ? { operator: legal.operator, contact: legal.contact, terms: legal.terms.text, privacy: legal.privacy.text } : { operator: '', contact: '', terms: '', privacy: '' });
  const edit = (patch: Partial<Fields>) => setDraft({ ...f, ...patch });
  const doc = (k: LegalKind) => (
    <div className="mt-18">
      <div className="mb-6 flex flex-wrap items-center gap-8">
        <b>{LEGAL_TITLES[k]}</b>
        <span className="hint mr-auto" id={IDS[k].state}>{legal ? (legal[k].custom ? '直した文' : '既定の文') + '・更新日' + longDate(legal[k].updatedAt) : ''}</span>
        {/* 2つのボタンは、折り返すときも一緒に動かす（規約ごとに並びが変わらないように） */}
        <span className="flex gap-8">
          <a className="btn small" href={'/' + k} target="_blank" rel="noopener"><Icon name="open_in_new" size="sm" />開く</a>
          <button type="button" className="btn small" data-default={k} onClick={() => { if (legal) edit({ [k]: legal[k].defaultText }); }}>既定の文に戻す</button>
        </span>
      </div>
      <textarea className="h-360 w-full resize-y text-13 leading-[1.7]" id={IDS[k].area} rows={16} maxLength={LEGAL_MAX.text} aria-label={LEGAL_TITLES[k] + 'の本文'} value={f[k]} onChange={(ev) => edit({ [k]: ev.target.value })} />
    </div>
  );
  return (
    <div data-pane="legal">
      <form className="card" id="opLegal" onSubmit={(ev) => { ev.preventDefault(); void act('/api/admin/legal', f).then((ok) => { if (ok) setDraft(null); }); }}>
        <h3><Icon name="gavel" size="sm" />利用規約とプライバシーポリシー <small className="hint">/termsと /privacyで、ログインしていない人も読めます。入口の画面からもリンクしています</small></h3>
        <div className="flex flex-wrap items-end gap-12">
          <label className={rowLabel}>運営者の名前 <small>ページの上に出ます</small><input type="text" className={rowInput} id="lgOperator" maxLength={LEGAL_MAX.operator} value={f.operator} onChange={(ev) => edit({ operator: ev.target.value })} /></label>
          <label className={rowLabel}>問い合わせ先 <small>URLかメールアドレス。リンクになります</small><input type="text" className={rowInput} id="lgContact" maxLength={LEGAL_MAX.contact} value={f.contact} onChange={(ev) => edit({ contact: ev.target.value })} /></label>
        </div>
        {doc('terms')}
        {doc('privacy')}
        <p className="hint">書き方: 「## 」で始まる行は見出し、「### 」は小見出し、「- 」は箇条書き、「1. 」は番号付きになります。空行で段落を分けます。URLとメールアドレスはリンクになり、[文字](URL) でもリンクを書けます。HTMLは使えません（そのまま文字で出ます）。</p>
        <p className="hint">既定の文は、このままの卓予定に合わせてあります。公開のしかた（前に置くCDNなど）に合わせて直してください。本文を変えて保存すると、更新日が今日になります。本文を空にして保存すると、既定の文に戻ります。</p>
        {/* 変えるまで（既定の文に戻すを押すまで）は押せない */}
        <button type="submit" className="btn primary mt-12" disabled={!draft}>保存する</button>
      </form>
    </div>
  );
}
