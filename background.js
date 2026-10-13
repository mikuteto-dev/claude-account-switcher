const ORIGIN = 'https://claude.ai';
const DEVICE = ['cf_clearance', '__cf_bm', '_cfuvid', '__cflb', 'anthropic-device-id'];
const isSession = (c) => /^sessionKey(V\d+)?$/.test(c.name);
const cookieUrl = (c) => `https://${c.domain.replace(/^\./, '')}${c.path}`;

const getAccounts = async () => (await chrome.storage.local.get('accounts')).accounts ?? {};
const claudeTabs = () => chrome.tabs.query({ url: `${ORIGIN}/*` });
const authCookies = async () => (await chrome.cookies.getAll({ domain: 'claude.ai' })).filter((c) => !DEVICE.includes(c.name));

const whoami = async () => {
  const [tab] = (await claudeTabs()).filter((t) => !t.discarded).sort((a, b) => b.lastAccessed - a.lastAccessed);
  if (!tab) return null;
  const run = chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      const r = await fetch('/api/account');
      if (!r.ok) return null;
      const a = await r.json();
      return { uuid: a.uuid, email: a.email_address };
    },
  });
  const [res] = await Promise.race([run, new Promise((r) => setTimeout(() => r([]), 1500))]);
  return res?.result ?? null;
};

const routingClaims = (cookies) => {
  const jwt = cookies.find((c) => c.name === 'routingHint')?.value.split('.')[1];
  if (!jwt) return {};
  try {
    const bin = atob(jwt.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
  } catch {
    return {};
  }
};

const sync = async () => {
  const cookies = await authCookies();
  if (!cookies.some(isSession)) {
    await chrome.storage.local.set({ current: null });
    return null;
  }
  const claims = routingClaims(cookies);
  const me = await whoami().catch(() => null);
  const uuid = claims.sub ?? me?.uuid;
  if (!uuid) throw new Error(chrome.i18n.getMessage('unidentified'));
  const accounts = await getAccounts();
  const email = (me?.uuid === uuid && me.email) || accounts[uuid]?.email || claims.name || uuid;
  accounts[uuid] = { email, cookies };
  await chrome.storage.local.set({ accounts, current: uuid });
  return uuid;
};

let syncTimer;
chrome.cookies.onChanged.addListener(({ cookie }) => {
  if (!cookie.domain.endsWith('claude.ai') || !(isSession(cookie) || cookie.name === 'routingHint')) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync().catch(() => {}), 800);
});

const restore = (c) =>
  chrome.cookies.set({
    url: cookieUrl(c),
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    ...(c.hostOnly ? {} : { domain: c.domain }),
    ...(c.session ? {} : { expirationDate: c.expirationDate }),
  });

const park = (tab) =>
  new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id, info) => id === tab.id && info.status === 'complete' && done();
    const timer = setTimeout(done, tab.discarded ? 0 : 1500);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tab.id, { url: 'about:blank' }).catch(done);
  });

const switchTo = async (uuid) => {
  await sync();
  const target = uuid && (await getAccounts())[uuid];
  const tabs = await claudeTabs();
  await Promise.all(tabs.map(park));
  for (const c of await authCookies()) await chrome.cookies.remove({ url: cookieUrl(c), name: c.name });
  const left = (await authCookies()).filter(isSession).map((c) => `${c.name}@${c.domain}`);
  let url = target ? `${ORIGIN}/new` : `${ORIGIN}/login?from=logout`;
  if (left.length) {
    await chrome.storage.local.set({ lastError: chrome.i18n.getMessage('cookieRemoveFailed', left.join(', ')) });
    url = `${ORIGIN}/new`;
  } else if (target) for (const c of target.cookies) await restore(c);
  if (tabs.length) await Promise.all(tabs.map((t) => chrome.tabs.update(t.id, { url })));
  else await chrome.tabs.create({ url });
};

const handlers = {
  sync: () => sync(),
  switch: ({ uuid }) => switchTo(uuid),
  add: () => switchTo(null),
  remove: async ({ uuid }) => {
    const accounts = await getAccounts();
    delete accounts[uuid];
    await chrome.storage.local.set({ accounts });
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handlers[msg.type](msg).then(sendResponse, (e) => sendResponse({ error: e.message }));
  return true;
});
