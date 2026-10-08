const { loadApp, requireApp, readIndexHtml } = require('./setup/loadApp');

const THEME_KEY = 'ops-theme';

/**
 * Fake window.matchMedia (jsdom has none) reporting the given OS theme. Returns a
 * setSystemTheme(theme) function that changes the OS setting and fires 'change'.
 */
function mockSystemTheme(theme) {
  const media = { matches: theme === 'dark', media: '(prefers-color-scheme: dark)', listeners: [] };
  media.addEventListener = (type, fn) => media.listeners.push(fn);
  media.removeEventListener = jest.fn();
  window.matchMedia = jest.fn(() => media);
  return (next) => {
    media.matches = next === 'dark';
    media.listeners.forEach((fn) => fn({ matches: media.matches }));
  };
}

/** Run the inline <head> script of index.html, as the browser does before first paint. */
function runHeadScript() {
  const head = readIndexHtml().match(/<head>([\s\S]*)<\/head>/)[1];
  const code = head.match(/<script>([\s\S]*?)<\/script>/)[1];
  new Function(code)();
}

function currentTheme() {
  return document.documentElement.getAttribute('data-theme');
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.matchMedia;
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('nextTheme', () => {
  test('switches light to dark and dark to light', () => {
    const { nextTheme } = requireApp();
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });
});

describe('theme on load', () => {
  test('follows a dark OS setting when nothing is stored', async () => {
    mockSystemTheme('dark');
    await loadApp();
    expect(currentTheme()).toBe('dark');
  });

  test('follows a light OS setting when nothing is stored', async () => {
    mockSystemTheme('light');
    await loadApp();
    expect(currentTheme()).toBe('light');
  });

  test('falls back to light when the OS setting is unavailable', async () => {
    await loadApp();
    expect(currentTheme()).toBe('light');
  });

  test('a stored choice wins over the OS setting', async () => {
    mockSystemTheme('light');
    window.localStorage.setItem(THEME_KEY, 'dark');
    await loadApp();
    expect(currentTheme()).toBe('dark');
  });

  test('ignores an unknown stored value', async () => {
    mockSystemTheme('dark');
    window.localStorage.setItem(THEME_KEY, 'purple');
    await loadApp();
    expect(currentTheme()).toBe('dark');
  });

  test('does not store anything until the user picks a theme', async () => {
    mockSystemTheme('dark');
    await loadApp();
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
  });
});

describe('theme toggle', () => {
  test('the accessible label names the theme a click will switch to', async () => {
    await loadApp();
    const button = document.getElementById('theme-toggle');
    expect(currentTheme()).toBe('light');
    expect(button.getAttribute('aria-label')).toBe('Switch to the dark theme');
    expect(button.getAttribute('title')).toBe('Switch to the dark theme');

    button.click();
    expect(currentTheme()).toBe('dark');
    expect(button.getAttribute('aria-label')).toBe('Switch to the light theme');
    expect(button.getAttribute('title')).toBe('Switch to the light theme');
  });

  test('the button holds a moon and a sun icon, hidden from screen readers', async () => {
    await loadApp();
    const button = document.getElementById('theme-toggle');
    for (const cls of ['icon-moon', 'icon-sun']) {
      const icon = button.querySelector('svg.' + cls);
      expect(icon).not.toBeNull();
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });

  test('a click switches the theme and stores the choice', async () => {
    await loadApp();
    document.getElementById('theme-toggle').click();
    expect(currentTheme()).toBe('dark');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  test('two clicks come back to the starting theme', async () => {
    await loadApp();
    const button = document.getElementById('theme-toggle');
    button.click();
    button.click();
    expect(currentTheme()).toBe('light');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('light');
  });

  test('the stored choice survives a reload', async () => {
    await loadApp();
    document.getElementById('theme-toggle').click();
    await loadApp();
    expect(currentTheme()).toBe('dark');
  });

  test('charts take their colours from CSS, not from inline attributes', async () => {
    await loadApp();
    document.getElementById('theme-toggle').click();
    for (const id of ['chart-on-time', 'chart-tickets']) {
      const svg = document.getElementById(id);
      expect(svg.querySelectorAll('rect.bar').length).toBeGreaterThan(0);
      expect(svg.querySelectorAll('[fill], [stroke], [style]').length).toBe(0);
    }
  });
});

describe('theme before first paint (inline script in <head>)', () => {
  test('applies a stored choice over the OS setting', () => {
    mockSystemTheme('light');
    window.localStorage.setItem(THEME_KEY, 'dark');
    runHeadScript();
    expect(currentTheme()).toBe('dark');
  });

  test('follows the OS setting when nothing is stored', () => {
    mockSystemTheme('dark');
    runHeadScript();
    expect(currentTheme()).toBe('dark');
  });

  test('falls back to light without matchMedia or with an unknown stored value', () => {
    window.localStorage.setItem(THEME_KEY, 'purple');
    runHeadScript();
    expect(currentTheme()).toBe('light');
  });
});

describe('theme changes from outside the page', () => {
  test('follows an OS change while nothing is stored', async () => {
    const setSystemTheme = mockSystemTheme('light');
    await loadApp();
    setSystemTheme('dark');
    expect(currentTheme()).toBe('dark');
    setSystemTheme('light');
    expect(currentTheme()).toBe('light');
  });

  test('ignores an OS change once the user has picked a theme', async () => {
    const setSystemTheme = mockSystemTheme('light');
    await loadApp();
    document.getElementById('theme-toggle').click();
    setSystemTheme('light');
    expect(currentTheme()).toBe('dark');
  });

  test('picks up a choice made in another open tab', async () => {
    await loadApp();
    window.localStorage.setItem(THEME_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'dark' }));
    expect(currentTheme()).toBe('dark');
    expect(document.getElementById('theme-toggle').getAttribute('aria-label')).toBe('Switch to the light theme');
  });
});

describe('blocked storage', () => {
  test('the dashboard still loads and the toggle still works', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    mockSystemTheme('dark');
    const { app } = await loadApp();
    expect(currentTheme()).toBe('dark');
    expect(app.state.kpis).not.toBeNull();

    document.getElementById('theme-toggle').click();
    expect(currentTheme()).toBe('light');
  });

  test('the <head> script falls back to the OS setting', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    mockSystemTheme('dark');
    runHeadScript();
    expect(currentTheme()).toBe('dark');
  });
});
