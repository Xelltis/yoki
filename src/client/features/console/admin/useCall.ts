// 設定を保存する呼び出し。押したボタンを押せなくし、結果を欄と吹き出しに出す（前の画面の stCall と同じ）
import { useState } from 'react';
import type { RpcName, RpcResult } from '../../../../shared/api';
import { toast } from '../../../ui/toast';
import { useConsole } from '../context';

export function useCall() {
  const { sync } = useConsole();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsgs] = useState<Record<string, string>>({});
  const setMsg = (key: string, text: string) => setMsgs((m) => ({ ...m, [key]: text }));
  /** btn のボタンを押せなくし、msgKey の欄に結果を出す */
  const call = (btn: string, msgKey: string, fn: RpcName, form?: object): Promise<RpcResult | null> => {
    setBusy((b) => ({ ...b, [btn]: true })); setMsg(msgKey, '保存しています…');
    return sync.write<RpcResult>(fn, form).then((res) => {
      setBusy((b) => ({ ...b, [btn]: false })); setMsg(msgKey, res.message); toast(res.message);
      return res;
    }, (e: Error) => {
      setBusy((b) => ({ ...b, [btn]: false })); setMsg(msgKey, e.message); toast(e.message);
      return null;
    });
  };
  return { busy, msg, setMsg, call };
}
