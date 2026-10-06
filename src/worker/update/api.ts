// GitHub の API（運営の管理画面の「更新」が使う）。元のリポジトリの最新の Release、2 つの版のあいだに変わったファイル、
// 公開しているリポジトリの更新のワークフローを呼ぶことと、その実行の一覧。トークンは呼ぶときに渡し、ここでは覚えない

/** 元のリポジトリの Release */
export type Release = { tag: string; name: string; url: string; publishedAt: string; body: string };
/** 更新のワークフローの実行 */
export type UpdateRun = { id: number; status: string; conclusion: string; createdAt: string; url: string };

export interface UpdateApi {
  /** 最新の Release。まだ無ければ null */
  latestRelease(repo: string): Promise<Release | null>;
  /** base から head までに変わったファイルの名前 */
  changedFiles(repo: string, base: string, head: string): Promise<string[]>;
  /** ワークフローを main で動かす（workflow_dispatch） */
  dispatch(repo: string, token: string, workflow: string, inputs: Record<string, string>): Promise<void>;
  /** ワークフローの最近の実行（新しい順に 5 件） */
  runs(repo: string, token: string, workflow: string): Promise<UpdateRun[]>;
}

const API = 'https://api.github.com';

/** GitHub が断ったときの文。権限・名前の誤りなら、確かめることを添える */
function refused(status: number): Error {
  return new Error('GitHub が ' + status + ' を返しました' + (status === 401 || status === 403 || status === 404 ? '。トークンの権限と、リポジトリの名前を確かめてください' : ''));
}

async function gh(path: string, token = '', init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'yoki' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(API + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

export function realGitHub(): UpdateApi {
  return {
    async latestRelease(repo) {
      const res = await gh('/repos/' + repo + '/releases/latest');
      if (res.status === 404) return null;
      if (!res.ok) throw refused(res.status);
      const r = (await res.json()) as { tag_name: string; name: string | null; html_url: string; published_at: string | null; body: string | null };
      return { tag: r.tag_name, name: r.name || r.tag_name, url: r.html_url, publishedAt: r.published_at ?? '', body: r.body ?? '' };
    },
    async changedFiles(repo, base, head) {
      const res = await gh('/repos/' + repo + '/compare/' + encodeURIComponent(base) + '...' + encodeURIComponent(head));
      if (!res.ok) throw refused(res.status);
      const r = (await res.json()) as { files?: { filename: string }[] };
      return (r.files ?? []).map((f) => f.filename);
    },
    async dispatch(repo, token, workflow, inputs) {
      const res = await gh('/repos/' + repo + '/actions/workflows/' + workflow + '/dispatches', token, { method: 'POST', body: { ref: 'main', inputs } });
      if (res.status !== 204) throw refused(res.status);
    },
    async runs(repo, token, workflow) {
      const res = await gh('/repos/' + repo + '/actions/workflows/' + workflow + '/runs?per_page=5', token);
      if (!res.ok) throw refused(res.status);
      const r = (await res.json()) as { workflow_runs: { id: number; status: string; conclusion: string | null; created_at: string; html_url: string }[] };
      return r.workflow_runs.map((x) => ({ id: x.id, status: x.status, conclusion: x.conclusion ?? '', createdAt: x.created_at, url: x.html_url }));
    },
  };
}
