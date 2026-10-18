import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/tokens.css';
import './styles/adapt.css';
import './styles/app.css';

import App from './App';

// 首帧就要有 data-theme，否则 tokens 没挂上会先闪一帧无令牌的白底。
// system 档下这里用 matchMedia 猜一次，App 挂载后由 settings 校正。
document.documentElement.dataset.theme =
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('index.html 里没有 #root');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
