// 几何映射 I：分层与螺旋。口径见 ../../格式规格.md §5。
//
// 提供两条等价路径：
//   - 慢路径 spiralForwardSlow()：sqrt 闭式 + 整数校正，O(1)，用于随机访问与判据 10 的参照；
//   - 快路径 SEG_*：把一层拆成 2048 个等差段，段内纯加法递推，无 sqrt 无除法。
// 判据 10 断言两者对同一输入产出逐字节相同的 payload。

import { N, L, RING_COUNT, SEG_PER_LAYER } from './constants.js';

// §5.3：前 k 圈占用的格子总数
export const ringBase = (k) => 4 * k * (N - k);

// §5.5：s -> [x, y]
export function spiralForwardSlow(s) {
  let k = Math.floor((N - Math.sqrt(N * N - s)) / 2);
  // 整数校正必须保留：吸收跨平台浮点舍入差异（§5.5）
  while (4 * (k + 1) * (N - k - 1) <= s) k++;
  while (k > 0 && ringBase(k) > s) k--;

  const m = N - 2 * k;
  const e = m - 1;
  const t = s - ringBase(k);

  if (t < e) return [k + t, k];                        // 下边
  if (t < 2 * e) return [k + m - 1, k + (t - e)];      // 右边
  if (t < 3 * e) return [k + m - 1 - (t - 2 * e), k + m - 1]; // 上边
  return [k, k + m - 1 - (t - 3 * e)];                 // 左边
}

// §5.6：[x, y] -> s
export function spiralInverse(x, y) {
  const k = Math.min(x, y, N - 1 - x, N - 1 - y);
  const m = N - 2 * k;
  const e = m - 1;
  const s0 = ringBase(k);

  if (y === k && x >= k && x <= k + m - 2) return s0 + (x - k);
  if (x === k + m - 1 && y >= k && y <= k + m - 2) return s0 + e + (y - k);
  if (y === k + m - 1 && x >= k + 1 && x <= k + m - 1) return s0 + 2 * e + (k + m - 1 - x);
  return s0 + 3 * e + (k + m - 1 - y);
}

// §9.3：2048 个等差段。qStep 为光栅序号步进，仿射后 rStep = a*qStep mod L。
// 用并列 typed array 而非对象数组，避免每层 2048 次对象分配。
export const SEG_S = new Int32Array(SEG_PER_LAYER);   // 段首的填充序号 s
export const SEG_Q = new Int32Array(SEG_PER_LAYER);   // 段首的光栅序号 q
export const SEG_QSTEP = new Int32Array(SEG_PER_LAYER); // q 步进：+1 / +N / -1 / -N
export const SEG_LEN = new Int32Array(SEG_PER_LAYER); // 段长 = m-1

let segTotal = 0;
{
  let i = 0;
  for (let k = 0; k < RING_COUNT; k++) {
    const m = N - 2 * k;
    const e = m - 1;
    const s0 = ringBase(k);
    const hi = k + m - 1;

    // 下边：(k+t, k)，t = 0..e-1
    SEG_S[i] = s0;           SEG_Q[i] = k * N + k;      SEG_QSTEP[i] = 1;  SEG_LEN[i] = e; i++;
    // 右边：(k+m-1, k+t)
    SEG_S[i] = s0 + e;       SEG_Q[i] = k * N + hi;     SEG_QSTEP[i] = N;  SEG_LEN[i] = e; i++;
    // 上边：(k+m-1-t, k+m-1)
    SEG_S[i] = s0 + 2 * e;   SEG_Q[i] = hi * N + hi;    SEG_QSTEP[i] = -1; SEG_LEN[i] = e; i++;
    // 左边：(k, k+m-1-t)
    SEG_S[i] = s0 + 3 * e;   SEG_Q[i] = hi * N + k;     SEG_QSTEP[i] = -N; SEG_LEN[i] = e; i++;

    segTotal += 4 * e;
  }
  if (i !== SEG_PER_LAYER) throw new Error(`段数不符：${i} != ${SEG_PER_LAYER}`);
}

// 自证：段长之和必须等于 L（§5.4 覆盖完备性的机器检版本）
export const SEG_TOTAL_LEN = segTotal;
