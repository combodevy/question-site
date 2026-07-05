export const chart = {

                draw(canvasId, dataPoints) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs || !cvs.parentElement) return;

                    const ctx = cvs.getContext('2d');
                    if (!ctx) return;

                    const parent = cvs.parentElement;
                    if (parent.clientWidth === 0 || parent.clientHeight === 0) {
                        if (!cvs.dataset.pendingDraw) {
                            cvs.dataset.pendingDraw = '1';
                            requestAnimationFrame(() => {
                                delete cvs.dataset.pendingDraw;
                                App.chart.draw(canvasId, dataPoints);
                            });
                        }
                        return;
                    }
                    cvs.width = parent.clientWidth;
                    cvs.height = parent.clientHeight;
                    const w = cvs.width, h = cvs.height;
                    const pad = 10;

                    ctx.clearRect(0, 0, w, h);

                    if (!dataPoints || dataPoints.length === 0) return;
                    if (dataPoints.length === 1) {
                        ctx.fillStyle = '#64748b'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
                        ctx.fillText(dataPoints[0] + '%', w / 2, h / 2);
                        return;
                    }

                    ctx.strokeStyle = '#0d9488'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                    ctx.beginPath();
                    const step = (w - pad * 2) / (dataPoints.length - 1);

                    dataPoints.forEach((val, i) => {
                        const x = pad + i * step;
                        const y = h - pad - (val / 100 * (h - pad * 2));
                        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                        ctx.fillStyle = '#64748b'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
                        ctx.fillText(val + '%', x, y - 8);
                    });
                    ctx.stroke();

                    const grad = ctx.createLinearGradient(0, 0, 0, h);
                    grad.addColorStop(0, 'rgba(13, 148, 136, 0.2)');
                    grad.addColorStop(1, 'rgba(13, 148, 136, 0)');
                    ctx.fillStyle = grad;
                    ctx.lineTo(pad + (dataPoints.length - 1) * step, h);
                    ctx.lineTo(pad, h);
                    ctx.fill();
                },

                drawBar(canvasId, labels, values, colors) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs) return;
                    const ctx = cvs.getContext('2d');
                    const parent = cvs.parentElement;
                    if (!parent || parent.clientWidth === 0) {
                        if (!cvs.dataset.pendingDrawBar) {
                            cvs.dataset.pendingDrawBar = '1';
                            requestAnimationFrame(() => {
                                delete cvs.dataset.pendingDrawBar;
                                App.chart.drawBar(canvasId, labels, values, colors);
                            });
                        }
                        return;
                    }
                    cvs.width = parent.clientWidth;
                    cvs.height = Math.max(labels.length * 36 + 20, 100);
                    const w = cvs.width, barH = 20, padL = 60, padR = 40;

                    ctx.clearRect(0, 0, w, cvs.height);

                    labels.forEach((label, i) => {
                        const y = 10 + i * 36;
                        const val = values[i] || 0;
                        const barW = (val / 100) * (w - padL - padR);

                        ctx.fillStyle = 'rgba(148,163,184,0.15)';
                        ctx.beginPath();
                        ctx.roundRect(padL, y, w - padL - padR, barH, 6);
                        ctx.fill();

                        if (barW > 0) {
                            ctx.fillStyle = colors[i] || '#0d9488';
                            ctx.beginPath();
                            ctx.roundRect(padL, y, barW, barH, 6);
                            ctx.fill();
                        }

                        ctx.fillStyle = '#64748b';
                        ctx.font = '11px Inter';
                        ctx.textAlign = 'right';
                        ctx.fillText(label.slice(0, 5), padL - 8, y + 14);

                        ctx.textAlign = 'left';
                        const isDarkMode = document.documentElement.classList.contains('dark');
                        ctx.fillStyle = isDarkMode ? '#f8fafc' : '#0f172a';
                        ctx.font = 'bold 11px Inter';
                        ctx.fillText(val + '%', padL + barW + 8, y + 14);
                    });
                },

                drawDonut(canvasId, values, labels, colors) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs) return;
                    const ctx = cvs.getContext('2d');
                    const size = Math.min(cvs.parentElement.clientWidth, 160);
                    cvs.width = size; cvs.height = size;
                    const cx = size / 2, cy = size / 2, r = size / 2 - 12, innerR = r * 0.58;
                    const total = values.reduce((a, b) => a + b, 0);
                    if (total === 0) return;

                    let startAngle = -Math.PI / 2;
                    values.forEach((v, i) => {
                        if (v === 0) return;
                        const slice = (v / total) * 2 * Math.PI;
                        ctx.beginPath();
                        ctx.moveTo(cx, cy);
                        ctx.arc(cx, cy, r, startAngle, startAngle + slice);
                        ctx.closePath();
                        ctx.fillStyle = colors[i];
                        ctx.fill();
                        startAngle += slice;
                    });

                    ctx.beginPath();
                    ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
                    const isDarkMode = document.documentElement.classList.contains('dark');
                    ctx.fillStyle = isDarkMode ? '#1e293b' : '#ffffff';
                    ctx.fill();

                    ctx.fillStyle = '#64748b';
                    ctx.font = `bold ${Math.round(size / 8)}px Inter`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(total + '次', cx, cy);
                },

                drawHeatmap(canvasId, daily30) {
                    const cvs = App.dom.get(canvasId);
                    if (!cvs) return;
                    const ctx = cvs.getContext('2d');
                    const parent = cvs.parentElement;
                    cvs.width = parent.clientWidth;
                    const cellW = Math.floor((cvs.width - 10) / 30);
                    cvs.height = cellW + 24;

                    ctx.clearRect(0, 0, cvs.width, cvs.height);

                    daily30.forEach((day, i) => {
                        const x = 5 + i * cellW;
                        const hasData = day.attempts > 0;
                        const intensity = hasData ? Math.min(day.attempts / 20, 1) : 0;

                        if (!hasData) {
                            ctx.fillStyle = document.documentElement.classList.contains('dark') ? 'rgba(51,65,85,0.4)' : 'rgba(148,163,184,0.2)';
                        } else {
                            const g = Math.round(148 - intensity * 60);
                            ctx.fillStyle = `rgba(13, ${g + 80}, 136, ${0.3 + intensity * 0.7})`;
                        }
                        ctx.beginPath();
                        ctx.roundRect(x, 4, cellW - 2, cellW - 2, 3);
                        ctx.fill();

                        if (i % 7 === 0 || i === 29) {
                            ctx.fillStyle = '#94a3b8';
                            ctx.font = '9px Inter';
                            ctx.textAlign = 'center';
                            ctx.fillText(day.label, x + cellW / 2, cvs.height - 4);
                        }
                    });
                }
            
};