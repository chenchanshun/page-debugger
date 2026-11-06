(() => {
  const themes = ['cloud', 'graphite', 'pine'];
  const key = 'page-debugger-theme';
  let current = 'cloud';
  try { const saved = localStorage.getItem(key); if (themes.includes(saved)) current = saved; } catch {}
  function apply(theme, persist = true) {
    if (!themes.includes(theme)) return;
    current = theme;
    document.documentElement.dataset.theme = theme;
    for (const button of document.querySelectorAll('[data-theme-choice]')) button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
    if (persist) { try { localStorage.setItem(key, theme); } catch {} }
  }
  window.pageDebuggerTheme = { apply, current: () => current,
    setup() { for (const button of document.querySelectorAll('[data-theme-choice]')) button.onclick = () => apply(button.dataset.themeChoice); apply(current, false); }
  };
  apply(current, false);
})();
