// 卓の準備の窓: HOの枠（公開HO）・割り当て・秘匿HO・HOの希望・キャラシの提出と締め切り。
// 見えるもの・書けるものは人で変わる。GMは枠・割り当て・秘匿HO・知らせ、参加者は自分の秘匿HO・希望・キャラシ、管理者は枠と締め切り。
// 秘匿HOはサーバーが、GMと割り当てた本人の分だけを画面データに入れる（ここでは隠さない）
import { useState } from 'react';
import { type ConsoleData, type ConsoleSession, PREP_MAX, type RpcName, type RpcResult } from '../../../../shared/api';
import { field, fieldLabel, fieldNote } from '../../../ui/fields';
import { Icon } from '../../../ui/Icon';
import { Modal } from '../../../ui/Modal';
import { formActions, wideBar, wideBarTitle } from '../../../ui/modalParts';
import { useStore } from '../../../ui/store';
import { toast } from '../../../ui/toast';
import { discordSend, failToast } from '../api/discord';
import { useConsole, useData } from '../context';
import { fmtJa } from '../model/dates';
import { byId, me } from '../model/model';
import { hookFor } from '../model/notify';
import { personChip } from '../styles';

/** 準備の様子（カードに出す短い文）。HOもキャラシの締め切りも無ければ空 */
export function prepSummary(d: ConsoleData, s: ConsoleSession): string {
  const p = s.prep;
  if (!p.slots.length && !p.sheetDue) return '';
  const players = playersOf(d, s);
  const sheets = players.filter((n) => p.sheets[n]).length;
  return ['準備', p.slots.length ? 'HO ' + p.slots.filter((x) => x.assigned).length + '/' + p.slots.length + 'を割り当て' : '',
    'キャラシ ' + sheets + '/' + players.length, p.sheetDue ? '締め切り ' + fmtJa(p.sheetDue) : ''].filter(Boolean).join('・');
}

/** HOを割り当てられ、キャラシを出すPL（参加者のうちメンバーの人） */
function playersOf(d: ConsoleData, s: ConsoleSession): string[] {
  return s.members.filter((n) => d.members.some((m) => m.name === n));
}

type SlotDraft = { pos: number; label: string; summary: string };

export function PrepModal() {
  const d = useData();
  const { ui, sync } = useConsole();
  const { prep: req } = useStore(ui);
  const [handled, setHandled] = useState(0);
  const [id, setId] = useState('');
  /** 書きかけ（GMと管理者の枠と締め切り）。nullなら画面データのまま */
  const [draft, setDraft] = useState<{ slots: SlotDraft[]; due: string } | null>(null);
  const [assign, setAssign] = useState<Record<number, string> | null>(null);
  const [secrets, setSecrets] = useState<Record<number, string>>({});
  const [sheet, setSheet] = useState<{ url: string; pc: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  if (req && req.seq !== handled) {
    setHandled(req.seq);
    setId(req.id); setDraft(null); setAssign(null); setSecrets({}); setSheet(null); setMsg('');
  }
  const s = byId(d, id);
  const close = () => { ui.set((x) => ({ ...x, prep: null })); };
  if (!s) return <Modal id="prepModal" open={false} onClose={close}><div /></Modal>;

  const mine = me(d);
  const p = s.prep;
  const memberGm = !!s.gm && d.members.some((m) => m.name === s.gm);
  const isGm = memberGm && s.gm === mine;
  const canFrame = isGm || d.isAdmin;
  const canAssign = isGm || (d.isAdmin && !memberGm);
  const players = playersOf(d, s);
  const isPlayer = players.indexOf(mine) >= 0;
  const slots = draft ? draft.slots : p.slots.map((x) => ({ pos: x.pos, label: x.label, summary: x.summary }));
  const due = draft ? draft.due : p.sheetDue;
  const assigned = (pos: number) => (assign && pos in assign ? assign[pos]! : p.slots.find((x) => x.pos === pos)?.assigned ?? '');
  const myHopes = [1, 2].map((rank) => p.slots.find((x) => x.hopes[mine] === rank)?.pos ?? 0);
  const mySheet = p.sheets[mine];
  const sheetNow = sheet ?? { url: mySheet?.url ?? '', pc: mySheet?.pc ?? '' };

  const run = (key: string, fn: RpcName, form: Record<string, unknown>, done?: () => void) => {
    setBusy(key); setMsg('');
    sync.write<RpcResult>(fn, { id: s.id, ...form }).then((res) => { setBusy(''); toast(res.message); done?.(); }, (e: Error) => { setBusy(''); setMsg(e.message); });
  };
  const setSlots = (next: SlotDraft[]) => setDraft({ slots: next, due });
  const addSlot = () => {
    const pos = Math.max(0, ...slots.map((x) => x.pos)) + 1;
    setSlots(slots.concat({ pos, label: 'HO' + pos, summary: '' }));
  };
  const notify = () => {
    setBusy('notify');
    void discordSend(sync, { kind: 'prep', id: s.id, me: mine }, () => {}).then(({ ok, r }) => { setBusy(''); toast(ok ? 'Discordに準備を知らせました' : failToast(r)); });
  };

  return (
    <Modal id="prepModal" open={!!req} onClose={close}>
      <div className="box wide" role="dialog" aria-modal="true" aria-labelledby="prepTitle" tabIndex={-1} data-id={s.id}>
        <div className={wideBar}>
          <h2 className={wideBarTitle} id="prepTitle"><Icon name="checklist" size="sm" />{'「' + s.name + '」の準備'}</h2>
          <button type="button" className="btn small ml-auto" id="prepClose" onClick={close}><Icon name="close" size="sm" />閉じる</button>
        </div>
        <p className="hint">{prepSummary(d, s) || 'まだHOもキャラシの締め切りもありません。' + (canFrame ? '下で決めてください。' : 'GMが決めると、ここに出ます。')}</p>

        {/* 自分の秘匿HO（割り当てられた人） */}
        {p.slots.filter((x) => x.assigned === mine && x.secret).map((x) => (
          <div className="card mt-8 border-accent-line bg-accent-soft" id="mySecret" key={x.pos}>
            <h3 className="mt-0"><Icon name="lock" size="sm" />{'あなたの秘匿HO（' + x.label + '）'}</h3>
            <p className="m-0 text-14 whitespace-pre-wrap">{x.secret}</p>
            <p className="hint mb-0">GMとあなただけが読めます。ほかの人に話さないでください。</p>
          </div>
        ))}

        <h3 className="mt-16 mb-4 text-15">HO</h3>
        {canFrame ? (
          <div id="prepSlots" className="grid gap-8">
            {slots.map((x, i) => (
              <div className="grid gap-6 rounded-md border border-line p-10" key={x.pos} data-slot={x.pos}>
                <div className="flex items-center gap-8">
                  <input type="text" className="w-[10em]" aria-label="HOの名前" maxLength={PREP_MAX.label} value={x.label}
                    onChange={(ev) => setSlots(slots.map((y, j) => (j === i ? { ...y, label: ev.target.value } : y)))} />
                  <span className="hint">{p.slots.find((y) => y.pos === x.pos)?.hasSecret ? '🔒秘匿HOあり' : ''}</span>
                  <button type="button" className="btn small ml-auto" title="このHOを消す" onClick={() => setSlots(slots.filter((_, j) => j !== i))}><Icon name="delete" size="sm" />消す</button>
                </div>
                <textarea aria-label={x.label + 'の公開HO'} placeholder="公開HO（全員に見せる紹介）" maxLength={PREP_MAX.summary} value={x.summary}
                  onChange={(ev) => setSlots(slots.map((y, j) => (j === i ? { ...y, summary: ev.target.value } : y)))} />
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-8">
              <button type="button" className="btn small" id="prepAddSlot" disabled={slots.length >= PREP_MAX.slots} onClick={addSlot}><Icon name="add" size="sm" />HOを足す</button>
              <div>
                <label className={fieldLabel + ' mt-0'} htmlFor="prepDue">キャラシの締め切り <small className={fieldNote}>前日に、まだの人へDiscordで催促</small></label>
                <input type="date" id="prepDue" value={due} onChange={(ev) => setDraft({ slots, due: ev.target.value })} />
              </div>
              <button type="button" className="btn primary ml-auto" id="prepSave" disabled={!draft || busy === 'save'}
                onClick={() => run('save', 'savePrep', { slots, sheetDue: due }, () => setDraft(null))}>HOと締め切りを保存</button>
            </div>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-6 p-0" id="prepSlots">
            {p.slots.map((x) => (
              <li className="rounded-md border border-line p-10" key={x.pos} data-slot={x.pos}>
                <b>{x.label}</b>{x.assigned && <span className={personChip(false, false) + ' ml-8'}>{x.assigned}</span>}{x.hasSecret && <span className="hint ml-8">🔒秘匿HOあり</span>}
                {x.summary && <p className="mt-4 mb-0 text-13 whitespace-pre-wrap">{x.summary}</p>}
              </li>
            ))}
            {!p.slots.length && <li className="hint">HOはありません。</li>}
          </ul>
        )}

        {/* 割り当てと秘匿HO（GM。メンバーのGMがいない卓は管理者が割り当てる） */}
        {canAssign && p.slots.length > 0 && (
          <div className="mt-16" id="prepAssign">
            <h3 className="mb-4 text-15">割り当て{isGm ? 'と秘匿HO' : ''}</h3>
            <p className="hint mt-0">{isGm ? '秘匿HOは、あなたと割り当てた人だけが読めます（管理者にも見えません）。' : 'この卓にはメンバーのGMがいないので、管理者が割り当てます。'}</p>
            {p.slots.map((x) => (
              <div className="mt-8 rounded-md border border-line p-10" key={x.pos} data-assign={x.pos}>
                <div className="flex flex-wrap items-center gap-8">
                  <b className="min-w-[6em]">{x.label}</b>
                  <select className="w-auto" aria-label={x.label + 'を割り当てる人'} value={assigned(x.pos)} onChange={(ev) => setAssign({ ...assign, [x.pos]: ev.target.value })}>
                    <option value="">（未定）</option>
                    {players.map((n) => <option value={n} key={n}>{n + (x.hopes[n] ? '（第' + x.hopes[n] + '希望）' : '')}</option>)}
                  </select>
                </div>
                {isGm && (
                  <div className="mt-8 flex flex-wrap items-start gap-8">
                    <textarea className="min-w-0 flex-1" aria-label={x.label + 'の秘匿HO'} placeholder="秘匿HO（割り当てた人だけが読む）" maxLength={PREP_MAX.secret}
                      value={x.pos in secrets ? secrets[x.pos] : x.secret ?? ''} onChange={(ev) => setSecrets({ ...secrets, [x.pos]: ev.target.value })} />
                    <button type="button" className="btn small" data-secret-save={x.pos} disabled={!(x.pos in secrets) || busy === 'secret' + x.pos}
                      onClick={() => run('secret' + x.pos, 'saveSlotSecret', { pos: x.pos, secret: secrets[x.pos] }, () => setSecrets((cur) => { const n = { ...cur }; delete n[x.pos]; return n; }))}>
                      <Icon name="lock" size="sm" />秘匿HOを保存
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div className="btns">
              <button type="button" className="btn primary" id="prepAssignSave" disabled={!assign || busy === 'assign'} onClick={() => run('assign', 'assignSlots', { assign }, () => setAssign(null))}>割り当てを保存</button>
            </div>
          </div>
        )}

        {/* HOの希望（参加者） */}
        {isPlayer && p.slots.length > 0 && (
          <div className="mt-16" id="prepHope">
            <h3 className="mb-4 text-15">HOの希望</h3>
            <div className="flex flex-wrap items-center gap-8">
              {[0, 1].map((i) => (
                <label className="m-0 flex items-center gap-6 font-normal" key={i}>{'第' + (i + 1) + '希望'}
                  <select className="w-auto" id={'hope' + (i + 1)} value={myHopes[i]} onChange={(ev) => {
                    const next = myHopes.slice();
                    next[i] = Number(ev.target.value);
                    run('hope', 'setSlotHope', { name: mine, hopes: next.filter(Boolean).filter((v, j, a) => a.indexOf(v) === j) });
                  }}>
                    <option value={0}>（なし）</option>
                    {p.slots.map((x) => <option value={x.pos} key={x.pos}>{x.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* キャラシ */}
        <div className="mt-16" id="prepSheets">
          <h3 className="mb-4 text-15">キャラシ{p.sheetDue ? <small className="hint ml-8">{'締め切り ' + fmtJa(p.sheetDue)}</small> : null}</h3>
          <ul className="m-0 grid list-none gap-4 p-0">
            {players.map((n) => {
              const sh = p.sheets[n];
              return (
                <li className="flex flex-wrap items-center gap-8 text-13" key={n} data-sheet-of={n}>
                  <span className="min-w-[8em] font-semibold">{n}</span>
                  {sh ? <a href={sh.url} target="_blank" rel="noopener noreferrer"><Icon name="open_in_new" size="sm" />{sh.pc || 'キャラシ'}</a> : <span className="hint">まだ</span>}
                  {sh && d.isAdmin && n !== mine && (
                    <button type="button" className="btn small" onClick={() => run('withdraw' + n, 'submitSheet', { name: n, url: '' })}>取り下げる</button>
                  )}
                </li>
              );
            })}
            {!players.length && <li className="hint">参加者（メンバー）がいません。</li>}
          </ul>
          {(isPlayer || isGm) && (
            <div className="mt-10 grid gap-6" id="mySheet">
              <label className={fieldLabel + ' mb-0'} htmlFor="sheetUrl">あなたのキャラシ <small className={fieldNote}>キャラクター保管所などのURL</small></label>
              <input type="url" className={field} id="sheetUrl" maxLength={PREP_MAX.url} placeholder="https://…" value={sheetNow.url} onChange={(ev) => setSheet({ ...sheetNow, url: ev.target.value })} />
              <input type="text" className={field} id="sheetPc" maxLength={PREP_MAX.pc} placeholder="キャラクターの名前（なくてもよい）" aria-label="キャラクターの名前" value={sheetNow.pc} onChange={(ev) => setSheet({ ...sheetNow, pc: ev.target.value })} />
              <div className="btns mt-0">
                <button type="button" className="btn primary" id="sheetSave" disabled={!sheet || !sheetNow.url.trim() || busy === 'sheet'} onClick={() => run('sheet', 'submitSheet', { name: mine, ...sheetNow }, () => setSheet(null))}>キャラシを出す</button>
                {mySheet && <button type="button" className="btn" id="sheetWithdraw" disabled={busy === 'sheet'} onClick={() => run('sheet', 'submitSheet', { name: mine, url: '' }, () => setSheet(null))}>取り下げる</button>}
              </div>
            </div>
          )}
        </div>

        <div className={formActions}>
          <div className="btns mt-0">
            {canFrame && (
              <button type="button" className="btn" id="prepNotify" disabled={!hookFor(d, s.series) || (!p.slots.length && !p.sheetDue) || busy === 'notify'}
                title={hookFor(d, s.series) ? 'HOの割り当てと締め切りをDiscordに知らせる（秘匿HOは載せない）' : 'チャンネル未設定'} onClick={notify}>
                <Icon name="notifications" size="sm" />Discordに知らせる
              </button>
            )}
            <button type="button" className="btn ml-auto" onClick={close}>閉じる</button>
          </div>
          <div className="mt-6 text-err-text empty:hidden" id="prepMsg" role="alert">{msg}</div>
        </div>
      </div>
    </Modal>
  );
}
