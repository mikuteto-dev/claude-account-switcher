const MARK = 'data-cas';
const send = (msg) => chrome.runtime.sendMessage(msg);

const logoutLink = (menu) => menu.querySelector('a[href*="/logout"]');

const makeItem = (template, label, glyph, onSelect, badge) => {
  const item = document.createElement('div');
  item.setAttribute(MARK, '');
  item.setAttribute('role', 'menuitem');
  item.tabIndex = -1;
  item.className = template.className;
  item.style.cursor = 'pointer';
  const iconTpl = template.firstElementChild;
  const labelTpl = template.lastElementChild;
  const icon = document.createElement('span');
  icon.className = iconTpl?.className ?? '';
  const glyphTpl = iconTpl?.querySelector('[data-cds="Icon"]');
  if (glyphTpl) {
    const g = glyphTpl.cloneNode(false);
    g.textContent = glyph;
    icon.append(g);
  } else icon.textContent = glyph;
  const text = document.createElement('span');
  text.className = labelTpl?.className ?? '';
  text.textContent = label;
  item.append(icon, text);
  if (badge) {
    const b = document.createElement('span');
    b.textContent = badge;
    b.style.cssText = 'margin-left:auto;padding-left:8px;font-size:.8em;opacity:.6;flex-shrink:0';
    item.append(b);
  }
  if (!onSelect) {
    item.setAttribute('aria-disabled', 'true');
    item.style.cursor = 'default';
    return item;
  }
  item.addEventListener('mouseenter', () => item.setAttribute('data-highlighted', ''));
  item.addEventListener('mouseleave', () => item.removeAttribute('data-highlighted'));
  item.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect();
  });
  return item;
};

const act = async (msg) => {
  const res = await send(msg);
  if (res?.error) alert(res.error);
};

const state = { current: null, accounts: {} };
const load = (s) => {
  if ('accounts' in s) state.accounts = s.accounts ?? {};
  if ('current' in s) state.current = s.current ?? null;
};

const inject = (menu, logout) => {
  const { current, accounts } = state;
  logout.addEventListener('click', () => current && send({ type: 'remove', uuid: current }));
  const items = Object.entries(accounts).map(([uuid, a]) =>
    uuid === current
      ? makeItem(logout, a.email, '\u{e03b}', null, chrome.i18n.getMessage('signedIn'))
      : makeItem(logout, a.email, '\u{e0e3}', () => act({ type: 'switch', uuid })),
  );
  items.push(makeItem(logout, chrome.i18n.getMessage('addAccount'), '\u{e001}', () => act({ type: 'add' })));
  const sep = document.createElement('div');
  sep.setAttribute(MARK, '');
  sep.setAttribute('role', 'separator');
  sep.className = menu.querySelector('[role="separator"]')?.className ?? '';
  logout.before(...items, sep);
};

const scan = () => {
  for (const menu of document.querySelectorAll('[role="menu"]')) {
    const logout = logoutLink(menu);
    if (logout && !menu.querySelector(`[${MARK}]`)) inject(menu, logout);
  }
};

chrome.storage.local.get(['accounts', 'current', 'lastError']).then((s) => {
  load(s);
  if (s.lastError) {
    chrome.storage.local.remove('lastError');
    alert(s.lastError);
  }
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') load(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
});
send({ type: 'sync' }).catch(() => {});
