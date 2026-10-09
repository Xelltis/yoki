// GitHubのAPI（運営の管理画面の「更新」が使う）。元のリポジトリの最新のRelease、2つの版のあいだに変わったファイル、
// 公開しているリポジトリの更新のワークフローを呼ぶことと、その実行の一覧。トークンは呼ぶときに渡し、ここでは覚えない。
// 元のリポジトリは、トークンがあればトークンで読む（トークンなしの上限は、出口のIPごとに1時間60回で、Cloudflareではほかの利用者と分け合うため、
// すぐに尽きて403になる）。APIが断ったら、最新のReleaseは、APIの上限を使わないReleaseのフィード（Atom）から読む

/** 元のリポジトリのRelease */
export type Release = { tag: string; name: string; url: string; publishedAt: string; body: string };
/** 更新のワークフローの実行 */
export type UpdateRun = { id: number; status: string; conclusion: string; createdAt: string; url: string };

export interface UpdateApi {
  /** 最新のRelease。まだ無ければnull。tokenがあれば（空でなければ）、それで読む */
  latestRelease(repo: string, token: string): Promise<Release | null>;
  /** baseからheadまでに変わったファイルの名前。tokenがあれば（空でなければ）、それで読む */
  changedFiles(repo: string, base: string, head: string, token: string): Promise<string[]>;
  /** ワークフローをmainで動かす（workflow_dispatch） */
  dispatch(repo: string, token: string, workflow: string, inputs: Record<string, string>): Promise<void>;
  /** ワークフローの最近の実行（新しい順に5件） */
  runs(repo: string, token: string, workflow: string): Promise<UpdateRun[]>;
}

const API = 'https://api.github.com';

/** 読み出しの上限に達したか（429か、残りが0の403） */
const limited = (res: Response) => res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');

/** GitHubが断ったときの文。上限なら、そう書く。権限・名前の誤りなら、確かめることを添える */
function refused(res: Response): Error {
  if (limited(res)) {
    return new Error('GitHubの読み出しの上限に達しました。しばらくしてから確かめ直してください（トークンなしの読み出しは、Cloudflareのほかの利用者と上限を分け合います。WorkerのsecretにUPDATE_DISPATCH_TOKENがあれば、それで読みます）');
  }
  const s = res.status;
  return new Error('GitHubが' + s + 'を返しました' + (s === 401 || s === 403 || s === 404 ? '。トークンの権限と、リポジトリの名前を確かめてください' : ''));
}

/** HTMLの文字の参照（&lt; など）を戻す。&amp; は最後（二重に戻さないため） */
const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');

/** Releaseの本文のHTML（フィードの中身）を、APIの本文と同じ形のMarkdown（見出しと箇条書き）にする */
export function htmlToMarkdown(html: string): string {
  return decode(
    html
      .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)')
      .replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**')
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g, (_, n: string, t: string) => '#'.repeat(Number(n)) + ' ' + t)
      .replace(/<li>([\s\S]*?)<\/li>/g, '* $1')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Releaseのフィード（https://github.com/<repo>/releases.atom）から、最新のReleaseを読む。APIの上限を使わない。
 * { release } を返す（Releaseがまだ無ければnull）。フィードを読めなければnull
 */
async function feedRelease(repo: string): Promise<{ release: Release | null } | null> {
  const res = await fetch('https://github.com/' + repo + '/releases.atom', { headers: { 'User-Agent': 'yoki', Accept: 'application/atom+xml' } });
  if (!res.ok) return null;
  const xml = await res.text();
  if (!/<feed[\s>]/.test(xml)) return null;
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  if (!entry) return { release: null };
  const pick = (re: RegExp) => re.exec(entry)?.[1] ?? '';
  // idは tag:github.com,2008:Repository/<番号>/<タグ>
  const tag = decode(pick(/<id>[^<]*\/([^/<]+)<\/id>/));
  return {
    release: {
      tag, name: decode(pick(/<title>([^<]*)<\/title>/)) || tag, url: pick(/<link[^>]*href="([^"]+)"/), publishedAt: pick(/<updated>([^<]*)<\/updated>/),
      body: htmlToMarkdown(decode(pick(/<content[^>]*>([\s\S]*?)<\/content>/))),
    },
  };
}

async function gh(path: string, token = '', init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'yoki' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(API + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

export function realGitHub(): UpdateApi {
  return {
    async latestRelease(repo, token) {
      let res = await gh('/repos/' + repo + '/releases/latest', token);
      // トークンが使えなければ（期限切れ・取り消し）、トークンなしで読み直す
      if (token && res.status === 401) { token = ''; res = await gh('/repos/' + repo + '/releases/latest'); }
      if (res.status === 404) {
        // Releaseがまだ無いのか、リポジトリが見えない（非公開・名前の誤り）のかを分ける。見えないまま「版が無い」とは言わない
        const home = await gh('/repos/' + repo, token);
        if (home.status === 404) throw new Error('GitHubで元のリポジトリ「' + repo + '」が見えません。公開されているか、名前が合っているかを確かめてください');
        if (!home.ok) throw refused(home);
        return null;
      }
      if (!res.ok) {
        // 上限などでAPIが断ったら、Releaseのフィードで読む。フィードも読めなければ、APIの断りを返す
        const feed = await feedRelease(repo);
        if (feed) return feed.release;
        throw refused(res);
      }
      const r = (await res.json()) as { tag_name: string; name: string | null; html_url: string; published_at: string | null; body: string | null };
      return { tag: r.tag_name, name: r.name || r.tag_name, url: r.html_url, publishedAt: r.published_at ?? '', body: r.body ?? '' };
    },
    async changedFiles(repo, base, head, token) {
      const path = '/repos/' + repo + '/compare/' + encodeURIComponent(base) + '...' + encodeURIComponent(head);
      let res = await gh(path, token);
      if (token && res.status === 401) res = await gh(path);
      if (!res.ok) throw refused(res);
      const r = (await res.json()) as { files?: { filename: string }[] };
      return (r.files ?? []).map((f) => f.filename);
    },
    async dispatch(repo, token, workflow, inputs) {
      const res = await gh('/repos/' + repo + '/actions/workflows/' + workflow + '/dispatches', token, { method: 'POST', body: { ref: 'main', inputs } });
      if (res.status !== 204) throw refused(res);
    },
    async runs(repo, token, workflow) {
      const res = await gh('/repos/' + repo + '/actions/workflows/' + workflow + '/runs?per_page=5', token);
      if (!res.ok) throw refused(res);
      const r = (await res.json()) as { workflow_runs: { id: number; status: string; conclusion: string | null; created_at: string; html_url: string }[] };
      return r.workflow_runs.map((x) => ({ id: x.id, status: x.status, conclusion: x.conclusion ?? '', createdAt: x.created_at, url: x.html_url }));
    },
  };
}
