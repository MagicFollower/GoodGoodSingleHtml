// 主题与令牌解析。
//
// 两条纪律：
// 1. 令牌只写在 :root[data-theme='light'] / [data-theme='dark'] 两处（tokens.css），不在 @media 里再写一份 ——
//    两处各写一遍迟早漏条目；system 档由这里读 matchMedia 后翻 data-theme。
// 2. ReactBits 件里有一批 props 会被 JS 解析（只认 hex/rgb），传 'var(--x)' 会静默变白/变默认值，
//    所以统一先 getComputedStyle 取真色再传。

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Theme } from './api';

export type TokenName =
  | 'bg' | 'surface' | 'surface-2' | 'ink' | 'ink-2' | 'ink-3' | 'line'
  | 'accent' | 'accent-ink' | 'accent-soft' | 'ok' | 'warn' | 'err' | 'run';

const VAR: Record<TokenName, string> = {
  bg: '--bg', surface: '--surface', 'surface-2': '--surface-2', ink: '--ink', 'ink-2': '--ink-2', 'ink-3': '--ink-3',
  line: '--line', accent: '--accent', 'accent-ink': '--accent-ink', 'accent-soft': '--accent-soft',
  ok: '--ok', warn: '--warn', err: '--err', run: '--run'
};

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function resolvedDark(mode: Theme): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme(mode: Theme) {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const dark = mode === 'system' ? systemDark : mode === 'dark';

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  return { dark, systemDark };
}

export function useTokens(deps: unknown[]) {
  const [map, setMap] = useState<Record<TokenName, string>>(() => readTokens());
  useEffect(() => {
    const id = requestAnimationFrame(() => setMap(readTokens()));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return map;
}

function readTokens(): Record<TokenName, string> {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as Record<TokenName, string>;
  for (const k of Object.keys(VAR) as TokenName[]) {
    const raw = cs.getPropertyValue(VAR[k]).trim();
    out[k] = toHex(raw) || '#888888';        // 解析不出来时给个能看见的兜底，别传空串让件回退成白
  }
  return out;
}

// rgb()/rgba()/hex → #rrggbb：件里的 parse() 只认 hex 与 rgb()，但有的只处理 hex，统一转成 hex 最安全。
function toHex(value: string): string | null {
  if (value.startsWith('#')) return value.length === 4 ? `#${value.slice(1).split('').map((c) => c + c).join('')}` : value.slice(0, 7);
  const m = /rgba?\(([^)]+)\)/i.exec(value);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  const n = parts.map((p) => (p.endsWith('%') ? Math.round(parseFloat(p) * 2.55) : Math.round(parseFloat(p))));
  if (n.length < 3 || n.some((x) => !Number.isFinite(x))) return null;
  if (n[3] !== undefined && n[3] < 1) return null;      // 半透明令牌不适合当纯色传
  return '#' + n.slice(0, 3).map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
}

export function useElapsed(running: boolean) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!running) { setMs(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setMs(Date.now() - t0), 100);
    return () => clearInterval(id);
  }, [running]);
  return ms;
}

export function useCopy() {
  return useCallback((text: string) => {
    void navigator.clipboard.writeText(text).catch(() => { /* 剪贴板不可用时静默，UI 上文本本身可见 */ });
  }, []);
}

export const memoEmpty = <T,>(v: T) => useMemo(() => v, [v]);
