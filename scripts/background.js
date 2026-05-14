import { APP } from './githubApp.js';

const api =
  typeof chrome !== 'undefined' && chrome.runtime ? chrome :
  typeof browser !== 'undefined' && browser.runtime ? browser :
  undefined;

const TOKEN_KEY = 'algorep_token';
const TOKEN_EXPIRES_KEY = 'algorep_token_expires_at';
const REFRESH_KEY = 'algorep_refresh_token';
const REFRESH_EXPIRES_KEY = 'algorep_refresh_token_expires_at';
const USERNAME_KEY = 'algorep_username';
const HOOK_KEY = 'algorep_hook';
const INSTALLATION_KEY = 'algorep_installation_id';
const PENDING_KEY = 'pending_device_flow';
const AUTH_EVENT_KEY = 'auth_event';

// ------------------------------------------------------------
// One-time migration from leethub_* keys to algorep_* keys
// ------------------------------------------------------------
function migrateLegacyKeys() {
  const keyMap = {
    leethub_token: TOKEN_KEY,
    leethub_hook: HOOK_KEY,
    leethub_username: USERNAME_KEY,
    leethub_ai_key: 'algorep_ai_key',
    leethub_ai_provider: 'algorep_ai_provider',
  };
  api.storage.local.get(Object.keys(keyMap), data => {
    const updates = {};
    for (const [oldKey, newKey] of Object.entries(keyMap)) {
      if (data[oldKey] != null) updates[newKey] = data[oldKey];
    }
    if (Object.keys(updates).length) {
      api.storage.local.set(updates);
    }
  });
}

// Tokens from the old OAuth Web Flow have no refresh_token; they're also
// hostage to a hardcoded client_secret that we've now removed. Drop them so
// the user lands cleanly on the Device Flow on next launch.
async function dropLegacyOAuthTokens() {
  const data = await api.storage.local.get([TOKEN_KEY, REFRESH_KEY]);
  if (data[TOKEN_KEY] && !data[REFRESH_KEY]) {
    await api.storage.local.remove([TOKEN_KEY, TOKEN_EXPIRES_KEY]);
  }
}

api.runtime.onInstalled.addListener(async details => {
  if (details.reason === 'install') {
    await api.storage.local.set({ sync_stats: true });
    api.tabs.create({ url: api.runtime.getURL('welcome.html') });
  } else if (details.reason === 'update') {
    migrateLegacyKeys();
    await dropLegacyOAuthTokens();
  }
});

// ------------------------------------------------------------
// Device Flow
// ------------------------------------------------------------

let pollAbort = null;

async function startDeviceFlow() {
  // Cancel any in-flight poll from a previous attempt before kicking off a new one.
  if (pollAbort) pollAbort.cancelled = true;

  const body = new URLSearchParams({ client_id: APP.CLIENT_ID });
  const res = await fetch(APP.DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`device_code_request_failed_${res.status}`);
  const data = await res.json();

  await api.storage.local.set({
    [PENDING_KEY]: {
      device_code: data.device_code,
      expires_at: Date.now() + data.expires_in * 1000,
      interval: data.interval,
      started_at: Date.now(),
    },
    [AUTH_EVENT_KEY]: { type: 'pending', at: Date.now() },
  });

  pollAbort = { cancelled: false };
  pollDeviceFlow(data.device_code, data.interval, data.expires_in, pollAbort);

  return {
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    verification_uri_complete: data.verification_uri_complete,
    expires_in: data.expires_in,
  };
}

async function pollDeviceFlow(deviceCode, interval, expiresIn, abort) {
  const deadline = Date.now() + expiresIn * 1000;
  let wait = interval;
  while (Date.now() < deadline && !abort.cancelled) {
    await new Promise(r => setTimeout(r, wait * 1000));
    if (abort.cancelled) return;

    const body = new URLSearchParams({
      client_id: APP.CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    let data;
    try {
      const res = await fetch(APP.ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body,
      });
      data = await res.json();
    } catch (e) {
      // network blip — try again next interval rather than dying
      continue;
    }

    if (data.access_token) {
      await persistTokens(data);
      await fetchAndStoreUsername();
      await api.storage.local.remove(PENDING_KEY);
      await api.storage.local.set({
        [AUTH_EVENT_KEY]: { type: 'success', at: Date.now() },
      });
      return;
    }
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { wait += 5; continue; }
    // expired_token, access_denied, unsupported_grant_type, incorrect_device_code, etc.
    await api.storage.local.remove(PENDING_KEY);
    await api.storage.local.set({
      [AUTH_EVENT_KEY]: { type: 'error', error: data.error || 'unknown', at: Date.now() },
    });
    return;
  }
  if (!abort.cancelled) {
    await api.storage.local.remove(PENDING_KEY);
    await api.storage.local.set({
      [AUTH_EVENT_KEY]: { type: 'error', error: 'expired_token', at: Date.now() },
    });
  }
}

async function persistTokens(data) {
  // Defaults match GitHub's documented lifetimes: 8h access, 6mo refresh.
  const now = Date.now();
  await api.storage.local.set({
    [TOKEN_KEY]: data.access_token,
    [TOKEN_EXPIRES_KEY]: now + (data.expires_in || 28800) * 1000,
    [REFRESH_KEY]: data.refresh_token,
    [REFRESH_EXPIRES_KEY]: now + (data.refresh_token_expires_in || 15552000) * 1000,
  });
}

async function fetchAndStoreUsername() {
  const { [TOKEN_KEY]: token } = await api.storage.local.get(TOKEN_KEY);
  if (!token) return;
  try {
    const res = await fetch(`${APP.API_BASE}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (res.ok) {
      const u = await res.json();
      await api.storage.local.set({ [USERNAME_KEY]: u.login });
    }
  } catch (_) { /* non-fatal */ }
}

// ------------------------------------------------------------
// Token refresh — serialized to prevent burning the single-use refresh token
// ------------------------------------------------------------
let refreshInFlight = null;

async function refreshToken() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const { [REFRESH_KEY]: rt } = await api.storage.local.get(REFRESH_KEY);
    if (!rt) throw new Error('no_refresh_token');
    const body = new URLSearchParams({
      client_id: APP.CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: rt,
    });
    const res = await fetch(APP.ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body,
    });
    const data = await res.json();
    if (!data.access_token) {
      await api.storage.local.remove([
        TOKEN_KEY, TOKEN_EXPIRES_KEY, REFRESH_KEY, REFRESH_EXPIRES_KEY,
      ]);
      throw new Error(data.error || 'refresh_failed');
    }
    await persistTokens(data);
    return data.access_token;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function getValidTokenInternal() {
  const data = await api.storage.local.get([TOKEN_KEY, TOKEN_EXPIRES_KEY, REFRESH_KEY]);
  if (!data[TOKEN_KEY]) return null;
  // Refresh ahead of expiry to avoid in-flight 401s on slow requests.
  const buffer = 60 * 1000;
  if (data[TOKEN_EXPIRES_KEY] && data[TOKEN_EXPIRES_KEY] - Date.now() < buffer) {
    if (!data[REFRESH_KEY]) return null;
    try { return await refreshToken(); } catch (_) { return null; }
  }
  return data[TOKEN_KEY];
}

async function signOut() {
  if (pollAbort) pollAbort.cancelled = true;
  await api.storage.local.remove([
    TOKEN_KEY, TOKEN_EXPIRES_KEY, REFRESH_KEY, REFRESH_EXPIRES_KEY,
    USERNAME_KEY, HOOK_KEY, INSTALLATION_KEY, PENDING_KEY,
  ]);
}

// ------------------------------------------------------------
// Keep service worker alive while a UI tab is actively waiting on us
// ------------------------------------------------------------
api.runtime.onConnect.addListener(port => {
  // No-op: the open port itself prevents idle-timeout shutdown of the SW
  // while the welcome page is mid-device-flow.
  port.onDisconnect.addListener(() => {});
});

// ------------------------------------------------------------
// Message router
// ------------------------------------------------------------
api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request !== 'object') return false;

  (async () => {
    try {
      switch (request.type) {
        case 'START_DEVICE_FLOW': {
          const r = await startDeviceFlow();
          sendResponse({ ok: true, ...r });
          return;
        }
        case 'CANCEL_DEVICE_FLOW': {
          if (pollAbort) pollAbort.cancelled = true;
          await api.storage.local.remove(PENDING_KEY);
          sendResponse({ ok: true });
          return;
        }
        case 'GET_AUTH_TOKEN': {
          const token = await getValidTokenInternal();
          if (!token) sendResponse({ error: 'unauthenticated' });
          else sendResponse({ token });
          return;
        }
        case 'REFRESH_AUTH': {
          try {
            const token = await refreshToken();
            sendResponse({ token });
          } catch (e) {
            sendResponse({ error: e.message });
          }
          return;
        }
        case 'SIGN_OUT': {
          await signOut();
          sendResponse({ ok: true });
          return;
        }
        case 'LEETCODE_SUBMISSION': {
          api.webNavigation.onHistoryStateUpdated.addListener(
            (e = function (details) {
              const submissionId = details.url.match(/\/submissions\/(\d+)\//)[1];
              sendResponse({ submissionId });
              api.webNavigation.onHistoryStateUpdated.removeListener(e);
            }),
            { url: [{ hostSuffix: 'leetcode.com' }, { pathContains: 'submissions' }] }
          );
          return;
        }
        default:
          sendResponse({ error: 'unknown_message_type' });
      }
    } catch (e) {
      sendResponse({ error: e.message || String(e) });
    }
  })();

  return true; // keep the channel open for the async sendResponse
});
