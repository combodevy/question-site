export const chart = {

                // ===== 内部工具 =====

                // 画布还没完成布局（区块隐藏中 → clientWidth 为 0）时，延后到下一帧重画。
                // 必须有次数上限：区块长期隐藏时，无限重试会变成每帧一次的空转
                //（切到「科目分析」后，总览区块一直隐藏，就会一直空转）。
                _retryDraw(fnName, canvasId, args) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs || !cvs.parentElement) return;
                    const flag = '_retry_' + fnName;
                    const countKey = flag + '_n';
                    if (cvs.dataset[flag]) return;                       // 已排好一次重试
                    const n = Number(cvs.dataset[countKey] || 0);
                    if (n >= 20) return;                                 // 约 0.3 秒后放弃
                    cvs.dataset[flag] = '1';
                    cvs.dataset[countKey] = String(n + 1);
                    requestAnimationFrame(() => {
                        delete cvs.dataset[flag];
                        const fn = App.chart[fnName];
                        if (typeof fn === 'function') fn.call(App.chart, canvasId, ...args);
                    });
                },

                // 画布准备好后清掉重试计数，避免下次又立刻放弃
                _resetRetry(cvs) {
                    if (!cvs || !cvs.dataset) return;
                    Object.keys(cvs.dataset)
                        .filter(k => k.startsWith('_retry_'))
                        .forEach(k => { delete cvs.dataset[k]; });
                },

                // roundRect 在 Safari 16.4 / Firefox 112 以下不存在，
                // 直接调用会抛 TypeError 让整张图挂掉；这里退化成直角矩形。
                // 同时把宽高与圆角都规整成有限的正数，避免 IndexSizeError。
                _roundRect(ctx, x, y, w, h, r) {
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                    const ww = Number.isFinite(w) ? w : 0;
                    const hh = Number.isFinite(h) ? h : 0;
                    if (ww === 0 || hh === 0) return;
                    const rr = Math.max(0, Math.min(Number.isFinite(r) ? r : 0, Math.abs(ww) / 2, Math.abs(hh) / 2));
                    if (typeof ctx.roundRect === 'function') {
                        ctx.roundRect(x, y, ww, hh, rr);
                    } else {
                        ctx.rect(x, y, ww, hh);
                    }
                },

                // 把任意输入转成有限数字，非有限值回退
                _num(v, fallback = 0) {
                    const n = Number(v);
                    return Number.isFinite(n) ? n : fallback;
                },

                // 高分屏清晰度的关键：canvas 背后存储按 devicePixelRatio 放大，
                // 绘制坐标系仍是 CSS 像素（setTransform 统一缩放）。
                // 不这样做的话，2x/3x 屏上每个 CSS 像素被拉伸成 2×2/3×3 物理像素，图表整体发糊。
                // 必须同时显式设置 style.width/height：width 属性变大后，
                // 没有 CSS 尺寸的 canvas 会按属性值显示成两倍大。
                _sizeCanvas(cvs, cssW, cssH) {
                    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
                    const w = Math.max(Math.round(cssW), 1);
                    const h = Math.max(Math.round(cssH), 1);
                    cvs.width = Math.round(w * dpr);
                    cvs.height = Math.round(h * dpr);
                    cvs.style.width = w + 'px';
                    cvs.style.height = h + 'px';
                    const ctx = cvs.getContext('2d');
                    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    return { w, h, dpr };
                },

                // 空数据占位：画布居中一行浅灰提示，替代「空白卡片」
                drawEmpty(canvasId, text) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs || !cvs.parentElement) return;
                    const parent = cvs.parentElement;
                    if (parent.clientWidth === 0) return;
                    const { w, h } = this._sizeCanvas(cvs, parent.clientWidth, Math.max(parent.clientHeight, 80));
                    const ctx = cvs.getContext('2d');
                    if (!ctx) return;
                    ctx.clearRect(0, 0, w, h);
                    ctx.fillStyle = '#94a3b8';
                    ctx.font = '11px Inter, system-ui, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(text || '暂无数据', w / 2, h / 2);
                },

                // 卡片背景色：数据点描边 / 环形图分隔 / 中心圆都要用到
                _cardBg() {
                    return document.documentElement.classList.contains('dark') ? '#1e293b' : '#ffffff';
                },

                // ===== 折线图 =====

                draw(canvasId, dataPoints) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs || !cvs.parentElement) return;
                    if (!Array.isArray(dataPoints)) return;

                    const ctx = cvs.getContext && cvs.getContext('2d');
                    if (!ctx) return;

                    const parent = cvs.parentElement;
                    if (parent.clientWidth === 0 || parent.clientHeight === 0) {
                        this._retryDraw('draw', canvasId, [dataPoints]);
                        return;
                    }
                    this._resetRetry(cvs);
                    const { w, h } = this._sizeCanvas(cvs, parent.clientWidth, parent.clientHeight);
                    const pad = 10;
                    const isDarkMode = document.documentElement.classList.contains('dark');
                    const labelColor = isDarkMode ? '#94a3b8' : '#64748b';

                    ctx.clearRect(0, 0, w, h);

                    if (dataPoints.length === 0) return;
                    // null = 当天无练习：跳过该点并断开线段，而不是误画成 0%
                    const valid = dataPoints.filter(v => v !== null && v !== undefined);
                    if (valid.length === 0) return;
                    if (valid.length === 1) {
                        // 单个有效数据：画一个「点 + 标签」锚定在画面中央，
                        // 而不是一行悬空的百分比文字（看起来像渲染失败）
                        ctx.beginPath();
                        ctx.arc(w / 2, h / 2, 4.5, 0, 2 * Math.PI);
                        ctx.fillStyle = '#0d9488';
                        ctx.fill();
                        ctx.lineWidth = 2;
                        ctx.strokeStyle = this._cardBg();
                        ctx.stroke();
                        ctx.fillStyle = labelColor; ctx.font = '11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
                        ctx.fillText(valid[0] + '%', w / 2, h / 2 - 12);
                        return;
                    }

                    // 极淡的横向参考线（0/50/100%）：不抢戏，但让百分比有可对齐的视觉基准
                    ctx.save();
                    ctx.strokeStyle = isDarkMode ? 'rgba(148, 163, 184, 0.14)' : 'rgba(100, 116, 139, 0.12)';
                    ctx.lineWidth = 1;
                    for (const ratio of [0, 0.5, 1]) {
                        const gy = Math.round(h - pad - ratio * (h - pad * 2)) + 0.5;
                        ctx.beginPath();
                        ctx.moveTo(pad, gy);
                        ctx.lineTo(w - pad, gy);
                        ctx.stroke();
                    }
                    ctx.restore();

                    // 把数据切成连续段（null 断开），段内用中点二次贝塞尔平滑，
                    // 折线观感柔和且不会超出真实数据点范围（不会像三次样条那样过冲）
                    const segs = [];
                    let cur = [];
                    let firstX = null, lastX = null;
                    dataPoints.forEach((val, i) => {
                        if (val === null || val === undefined) {
                            if (cur.length) { segs.push(cur); cur = []; }
                            return;
                        }
                        const x = pad + i * ((w - pad * 2) / (dataPoints.length - 1));
                        const y = h - pad - (this._num(val) / 100 * (h - pad * 2));
                        cur.push({ x, y });
                        if (firstX === null) firstX = x;
                        lastX = x;
                    });
                    if (cur.length) segs.push(cur);
                    const hasGap = segs.length > 1;

                    const tracePath = (pts) => {
                        ctx.beginPath();
                        ctx.moveTo(pts[0].x, pts[0].y);
                        for (let i = 1; i < pts.length - 1; i++) {
                            const mx = (pts[i].x + pts[i + 1].x) / 2;
                            const my = (pts[i].y + pts[i + 1].y) / 2;
                            ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
                        }
                        if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
                    };

                    ctx.strokeStyle = '#0d9488'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                    segs.forEach(pts => { if (pts.length > 1) { tracePath(pts); ctx.stroke(); } });

                    // 无断线时的渐变面积填充（有缺口不填，避免跨缺口造出假面积）
                    if (!hasGap && segs[0].length > 1) {
                        tracePath(segs[0]);
                        const grad = ctx.createLinearGradient(0, 0, 0, h);
                        grad.addColorStop(0, 'rgba(13, 148, 136, 0.2)');
                        grad.addColorStop(1, 'rgba(13, 148, 136, 0)');
                        ctx.save();
                        ctx.lineTo(lastX, h);
                        ctx.lineTo(firstX, h);
                        ctx.closePath();
                        ctx.fillStyle = grad;
                        ctx.fill();
                        ctx.restore();
                    }

                    // 数据点圆标记：实心点加一圈卡片底色描边，压在折线上更立体、更容易看清
                    segs.forEach(pts => pts.forEach(p => {
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 3.2, 0, 2 * Math.PI);
                        ctx.fillStyle = '#0d9488';
                        ctx.fill();
                        ctx.lineWidth = 1.5;
                        ctx.strokeStyle = this._cardBg();
                        ctx.stroke();
                    }));

                    // 标签最后画：压在点和线之上，保证可读。
                    // 首尾点的标签居中会探出画布边缘被裁掉，横向夹回可视范围。
                    const labelEvery = valid.length > 10 ? Math.ceil(valid.length / 8) : 1;
                    let labelIdx = 0;
                    dataPoints.forEach((val, i) => {
                        if (val === null || val === undefined) return;
                        const x = pad + i * ((w - pad * 2) / (dataPoints.length - 1));
                        const y = h - pad - (this._num(val) / 100 * (h - pad * 2));
                        if (labelIdx % labelEvery === 0 || i === dataPoints.length - 1) {
                            ctx.fillStyle = labelColor; ctx.font = '11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
                            ctx.fillText(val + '%', Math.min(Math.max(x, 14), w - 14), y - 10);
                        }
                        labelIdx++;
                    });
                },

                // ===== 七日趋势组合图：答对/答错堆叠柱 + 每柱正确率标注 =====
                // dataPoints: [{ label, attempts, correct, acc }]（acc 无作答为 null）
                drawCombo(canvasId, dataPoints) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs || !cvs.parentElement) return;
                    if (!Array.isArray(dataPoints) || !dataPoints.length) return;

                    const ctx = cvs.getContext && cvs.getContext('2d');
                    if (!ctx) return;
                    const parent = cvs.parentElement;
                    if (parent.clientWidth === 0 || parent.clientHeight === 0) {
                        this._retryDraw('drawCombo', canvasId, [dataPoints]);
                        return;
                    }
                    this._resetRetry(cvs);
                    const { w, h } = this._sizeCanvas(cvs, parent.clientWidth, parent.clientHeight);
                    const padL = 10, padR = 10, padT = 22, padB = 20;
                    const plotH = h - padT - padB;
                    const isDark = document.documentElement.classList.contains('dark');
                    const labelColor = isDark ? '#94a3b8' : '#64748b';
                    const gridColor = isDark ? 'rgba(148,163,184,0.14)' : 'rgba(100,116,139,0.12)';
                    const okColor = '#14b8a6';
                    const badColor = '#ef4444';
                    const en = window.App && App.i18n && App.i18n.lang === 'en';

                    ctx.clearRect(0, 0, w, h);

                    const maxV = Math.max(4, ...dataPoints.map(d => d.attempts));
                    const slot = (w - padL - padR) / dataPoints.length;
                    const barW = Math.min(34, slot * 0.52);

                    // 横向参考线（0 / 半程 / 满程）
                    ctx.save();
                    ctx.strokeStyle = gridColor;
                    ctx.lineWidth = 1;
                    for (const r of [0, 0.5, 1]) {
                        const gy = Math.round(padT + (1 - r) * plotH) + 0.5;
                        ctx.beginPath();
                        ctx.moveTo(padL, gy);
                        ctx.lineTo(w - padR, gy);
                        ctx.stroke();
                    }
                    ctx.restore();

                    dataPoints.forEach((d, i) => {
                        const cx = padL + slot * i + slot / 2;
                        const hasData = d.attempts > 0;
                        if (hasData) {
                            const okH = (d.correct / maxV) * plotH;
                            const badH = ((d.attempts - d.correct) / maxV) * plotH;
                            // 答对（teal 底段）
                            ctx.fillStyle = okColor;
                            this._roundRectTop(ctx, cx - barW / 2, padT + plotH - okH, barW, Math.max(2, okH), 3);
                            // 答错（红 上段）
                            if (badH > 0) {
                                ctx.fillStyle = badColor;
                                ctx.fillRect(cx - barW / 2, padT + plotH - okH - badH, barW, badH);
                            }
                            // 柱顶标注：题数 · 正确率（合并一行，避免与底部星期标签重叠）
                            const topLabel = (d.acc !== null && d.acc !== undefined)
                                ? `${d.attempts} · ${d.acc}%`
                                : String(d.attempts);
                            ctx.fillStyle = labelColor;
                            ctx.font = '10.5px Inter, system-ui, sans-serif';
                            ctx.textAlign = 'center';
                            ctx.fillText(topLabel, cx, padT + plotH - okH - badH - 5);
                        } else {
                            // 无作答：底部一个灰色小点占位
                            ctx.beginPath();
                            ctx.arc(cx, padT + plotH - 2, 2.4, 0, 2 * Math.PI);
                            ctx.fillStyle = isDark ? '#475569' : '#cbd5e1';
                            ctx.fill();
                        }
                        // 星期标签
                        ctx.fillStyle = labelColor;
                        ctx.font = '10.5px Inter, system-ui, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText(d.label, cx, h - 5);
                    });

                    // 图例（右上角，随主题）
                    const legend = en
                        ? [['Correct', okColor], ['Wrong', badColor]]
                        : [['答对', okColor], ['答错', badColor]];
                    let lx = w - padR;
                    ctx.font = '10px Inter, system-ui, sans-serif';
                    ctx.textAlign = 'right';
                    for (let k = legend.length - 1; k >= 0; k--) {
                        const [name, color] = legend[k];
                        ctx.fillStyle = color;
                        ctx.fillRect(lx - 8, padT - 12, 8, 8);
                        ctx.fillStyle = labelColor;
                        const tw = ctx.measureText(name).width;
                        ctx.fillText(name, lx - 12, padT - 4);
                        lx -= tw + 24;
                    }
                },

                _roundRectTop(ctx, x, y, w, h, r) {
                    r = Math.min(r, w / 2, h);
                    ctx.beginPath();
                    ctx.moveTo(x, y + h);
                    ctx.lineTo(x, y + r);
                    ctx.arcTo(x, y, x + r, y, r);
                    ctx.lineTo(x + w - r, y);
                    ctx.arcTo(x + w, y, x + w, y + r, r);
                    ctx.lineTo(x + w, y + h);
                    ctx.closePath();
                    ctx.fill();
                },

                // ===== 横向条形图 =====

                drawBar(canvasId, labels, values, colors) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs || !cvs.parentElement) return;
                    if (!Array.isArray(labels) || labels.length === 0) return;
                    const vals = Array.isArray(values) ? values : [];
                    const cols = Array.isArray(colors) ? colors : [];

                    const ctx = cvs.getContext && cvs.getContext('2d');
                    if (!ctx) return;

                    const parent = cvs.parentElement;
                    if (parent.clientWidth === 0) {
                        this._retryDraw('drawBar', canvasId, [labels, values, colors]);
                        return;
                    }
                    this._resetRetry(cvs);
                    const cssH = Math.max(labels.length * 36 + 20, 100);
                    const { w } = this._sizeCanvas(cvs, parent.clientWidth, cssH);
                    const barH = 20;
                    const isDarkMode = document.documentElement.classList.contains('dark');

                    // 标签区宽度按实际文字宽度自适应。
                    // 原先固定 padL = 60 并把标签硬截断成 5 个字符，
                    // 于是「E-commerce（电子商务）」显示成「E-com」，完全认不出是哪个科目。
                    ctx.font = '11px Inter, system-ui, sans-serif';
                    const labelText = (l) => String(l == null ? '' : l);
                    const maxLabelW = labels.reduce((m, l) => Math.max(m, ctx.measureText(labelText(l)).width), 0);
                    const LABEL_GAP = 10;
                    const padL = Math.round(Math.min(Math.max(maxLabelW + LABEL_GAP, 48), Math.max(48, w * 0.34)));
                    const padR = 46;                    // 右侧固定留给百分比，保证数字成一列
                    const trackW = Math.max(w - padL - padR, 1);
                    const availLabelW = Math.max(padL - LABEL_GAP, 8);

                    // 仍放不下时按「实际像素宽度」截断并加省略号，而不是按字符数硬砍
                    const fitLabel = (l) => {
                        const s = labelText(l);
                        if (ctx.measureText(s).width <= availLabelW) return s;
                        let lo = 0, hi = s.length;
                        while (lo < hi) {
                            const mid = Math.ceil((lo + hi) / 2);
                            if (ctx.measureText(s.slice(0, mid) + '…').width <= availLabelW) lo = mid;
                            else hi = mid - 1;
                        }
                        return lo > 0 ? s.slice(0, lo) + '…' : '…';
                    };

                    ctx.clearRect(0, 0, w, cssH);

                    labels.forEach((label, i) => {
                        const y = 10 + i * 36;
                        const raw = vals[i];
                        const hasValue = raw !== undefined && raw !== null && Number.isFinite(Number(raw));
                        const val = this._num(raw);
                        const barW = Math.max((val / 100) * trackW, 0);

                        ctx.fillStyle = 'rgba(148,163,184,0.15)';
                        ctx.beginPath();
                        this._roundRect(ctx, padL, y, trackW, barH, 6);
                        ctx.fill();

                        if (barW > 0) {
                            ctx.fillStyle = cols[i] || '#0d9488';
                            ctx.beginPath();
                            this._roundRect(ctx, padL, y, barW, barH, 6);
                            ctx.fill();
                        }

                        // 标签：右对齐到条形左端
                        ctx.fillStyle = '#64748b';
                        ctx.font = '11px Inter, system-ui, sans-serif';
                        ctx.textAlign = 'right';
                        ctx.fillText(fitLabel(label), padL - LABEL_GAP, y + 14);

                        // 百分比：固定在右端成一列。
                        // 原先跟着条形末端跑（50% 紧跟条形、100% 顶到最右），
                        // 三个数字不在一条竖线上，没法纵向比较。
                        // 0 值代表「没有数据」，显示「—」而不是空槽 + 0%，避免看起来像渲染失败。
                        ctx.fillStyle = isDarkMode ? '#f8fafc' : '#0f172a';
                        ctx.font = 'bold 11px Inter';
                        ctx.textAlign = 'right';
                        ctx.fillText(hasValue && val > 0 ? val + '%' : '—', w - 4, y + 14);
                    });
                },

                // ===== 环形图 =====

                drawDonut(canvasId, values, labels, colors) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs || !cvs.parentElement) return;
                    if (!Array.isArray(values)) return;
                    const vals = values.map(v => this._num(v));
                    const cols = Array.isArray(colors) ? colors : [];

                    const ctx = cvs.getContext && cvs.getContext('2d');
                    if (!ctx) return;

                    const parent = cvs.parentElement;
                    if (parent.clientWidth === 0) {
                        this._retryDraw('drawDonut', canvasId, [values, labels, colors]);
                        return;
                    }
                    this._resetRetry(cvs);

                    const size = Math.max(Math.min(parent.clientWidth, 160), 32);
                    this._sizeCanvas(cvs, size, size);
                    const cx = size / 2, cy = size / 2;
                    // ★ 半径必须为正：容器宽度为 0 时 size/2 - 12 会算成 -12，
                    //   ctx.arc 会抛 IndexSizeError（线上实际报过这个错）
                    const r = Math.max(size / 2 - 12, 1);
                    const innerR = Math.max(r * 0.58, 0);
                    const total = vals.reduce((a, b) => a + b, 0);
                    if (!(total > 0)) return;

                    let startAngle = -Math.PI / 2;
                    const bg = this._cardBg();
                    vals.forEach((v, i) => {
                        if (v <= 0) return;
                        const slice = (v / total) * 2 * Math.PI;
                        ctx.beginPath();
                        ctx.moveTo(cx, cy);
                        ctx.arc(cx, cy, r, startAngle, startAngle + slice);
                        ctx.closePath();
                        ctx.fillStyle = cols[i] || '#0d9488';
                        ctx.fill();
                        // 用卡片底色描边楔形：多段之间出现干净的分隔缝，不再糊成一整块饼
                        if (vals.filter(x => x > 0).length > 1) {
                            ctx.strokeStyle = bg;
                            ctx.lineWidth = 2;
                            ctx.stroke();
                        }
                        startAngle += slice;
                    });

                    ctx.beginPath();
                    ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
                    ctx.fillStyle = bg;
                    ctx.fill();

                    ctx.fillStyle = '#64748b';
                    ctx.font = `bold ${Math.round(size / 8)}px Inter`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(total + '次', cx, cy);
                },

                // ===== 热力图 =====

                drawHeatmap(canvasId, daily30) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs || !cvs.parentElement) return;
                    if (!Array.isArray(daily30) || daily30.length === 0) return;

                    const ctx = cvs.getContext && cvs.getContext('2d');
                    if (!ctx) return;

                    const parent = cvs.parentElement;
                    if (parent.clientWidth === 0) {
                        this._retryDraw('drawHeatmap', canvasId, [daily30]);
                        return;
                    }
                    this._resetRetry(cvs);

                    // 容器很窄时 (width-10)/30 会得到 0 或负数，格子尺寸不能小于 1
                    const cssW = parent.clientWidth;
                    const cellW = Math.max(Math.floor((cssW - 10) / daily30.length), 1);
                    const cssH = cellW + 27;   // 给下方 11px 的日期标签留够高度
                    const { w } = this._sizeCanvas(cvs, cssW, cssH);

                    ctx.clearRect(0, 0, w, cssH);
                    const isDark = document.documentElement.classList.contains('dark');
                    // 窄屏自适应：格子在手机上只有 ~10px，间隙和圆角跟着缩小，
                    // 否则一格只剩几个像素、看起来全是缝
                    const gap = cellW >= 14 ? 2 : 1;
                    const radius = cellW >= 14 ? 3 : 2;

                    daily30.forEach((day, i) => {
                        const x = 5 + i * cellW;
                        const attempts = this._num(day && day.attempts);
                        const hasData = attempts > 0;
                        const intensity = hasData ? Math.min(attempts / 20, 1) : 0;

                        if (!hasData) {
                            ctx.fillStyle = isDark ? 'rgba(51,65,85,0.4)' : 'rgba(148,163,184,0.2)';
                        } else {
                            const g = Math.round(148 - intensity * 60);
                            ctx.fillStyle = `rgba(13, ${g + 80}, 136, ${0.3 + intensity * 0.7})`;
                        }
                        ctx.beginPath();
                        this._roundRect(ctx, x, 4, cellW - gap, cellW - gap, radius);
                        ctx.fill();
                    });

                    // 日期标签：每 7 格一个 + 强制最后一个。最后一个常和每周标签挤在
                    // 一起（中心只差 1-2 格，文字比格距宽就叠字，手机上「9/269/27」
                    // 糊成一团）。从右往左贪心保留：最后的日期最重要，与已保留标签
                    // 中心距不足 minGap 的丢弃。格子小的时候字号也跟着缩。
                    const labelFont = cellW < 14 ? '9px Inter, system-ui, sans-serif' : '11px Inter, system-ui, sans-serif';
                    const minGap = cellW < 14 ? 22 : 28;
                    const cands = [];
                    daily30.forEach((day, i) => {
                        const weekly = i % 7 === 0;
                        const last = i === daily30.length - 1;
                        if ((weekly || last) && day && day.label !== undefined) {
                            cands.push({ x: 5 + i * cellW + cellW / 2, label: String(day.label) });
                        }
                    });
                    const kept = [];
                    for (let k = cands.length - 1; k >= 0; k--) {
                        if (kept.every(p => Math.abs(p.x - cands[k].x) >= minGap)) kept.push(cands[k]);
                    }
                    ctx.font = labelFont;
                    ctx.textAlign = 'center';
                    kept.forEach(p => {
                        ctx.fillStyle = '#94a3b8';
                        ctx.fillText(p.label, p.x, cssH - 6);
                    });
                }

};
