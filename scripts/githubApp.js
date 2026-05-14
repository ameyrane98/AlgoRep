// AlgoRep GitHub App configuration + auth helpers shared across contexts.
// Webpack bundles this into popup/welcome/leetcode; background imports it too.

export const APP = {
  CLIENT_ID: 'Iv23lir31sGJS3ZEv9Sz',
  APP_SLUG: 'algorep',
  DEVICE_CODE_URL: 'https://github.com/login/device/code',
  ACCESS_TOKEN_URL: 'https://github.com/login/oauth/access_token',
  API_BASE: 'https://api.github.com',
};

export const installUrl = () => `https://github.com/apps/${APP.APP_SLUG}/installations/new`;

const browserApi = () =>
  typeof chrome !== 'undefined' && chrome.runtime ? chrome :
  typeof browser !== 'undefined' && browser.runtime ? browser :
  null;

// Single point of truth for "give me a usable access token". The background
// worker is the only place that talks to /access_token, so refresh races
// can't burn the single-use refresh token from multiple tabs at once.
export async function getValidToken() {
  const api = browserApi();
  const resp = await api.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' });
  if (!resp || resp.error) return null;
  return resp.token;
}

export async function forceRefresh() {
  const api = browserApi();
  const resp = await api.runtime.sendMessage({ type: 'REFRESH_AUTH' });
  if (!resp || resp.error) return null;
  return resp.token;
}

// Wrapper that injects auth + transparently refreshes on 401.
export async function githubFetch(path, opts = {}) {
  let token = await getValidToken();
  if (!token) throw new Error('unauthenticated');
  const url = path.startsWith('http') ? path : `${APP.API_BASE}${path}`;
  const buildInit = t => ({
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
      Authorization: `Bearer ${t}`,
    },
  });
  let res = await fetch(url, buildInit(token));
  if (res.status === 401) {
    token = await forceRefresh();
    if (!token) throw new Error('unauthenticated');
    res = await fetch(url, buildInit(token));
  }
  return res;
}
