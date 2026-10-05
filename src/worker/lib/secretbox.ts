// 秘密の値を D1 に置くための暗号化（AES-GCM、Web Crypto）。鍵は Worker の secret（32 バイトを base64 にしたもの）。
// 書く形は v1.<IV>.<暗号文>（どちらも base64url）。鍵が違う・中身が書き換わっていれば、読むときに失敗する

const b64urlEncode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function b64Decode(s: string): Uint8Array {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 鍵を読む。32 バイトでなければ投げる（設定の誤りに早く気づけるように） */
export async function importKey(base64: string): Promise<CryptoKey> {
  const raw = b64Decode(base64.trim());
  if (raw.length !== 32) throw new Error('鍵は 32 バイトを base64 にしたものにしてください（' + raw.length + ' バイトでした）');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
  return 'v1.' + b64urlEncode(iv) + '.' + b64urlEncode(ct);
}

export async function open(key: CryptoKey, sealed: string): Promise<string> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('暗号化した値の形が違います');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64Decode(iv) }, key, b64Decode(ct));
  return new TextDecoder().decode(plain);
}
