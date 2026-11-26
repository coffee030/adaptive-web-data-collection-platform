import { useState } from 'react';

type Theme = 'system' | 'light' | 'dark';

export function ThemeSelect() {
  const [theme, setTheme] = useState<Theme>(() => {
    const applied = document.documentElement.dataset.theme;
    return applied === 'light' || applied === 'dark' ? applied : 'system';
  });

  function apply(next: Theme) {
    setTheme(next);
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('collection-theme', next);
    } catch {}
  }

  return <label className="theme-control">
    <span>Theme</span>
    <select value={theme} onChange={event => apply(event.target.value as Theme)}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>;
}
