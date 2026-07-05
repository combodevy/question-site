export const ai = {

                _messages: [],
                _currentQ: null,
                _isLoading: false,
                _apiKey: '',
                _provider: 'glm',
                _queue: [],
                _isProcessingQueue: false,
                _lastCallAt: 0,
                _minIntervalMs: 1000,
                _monitorEnabled: false,
                _stats: {
                    totalRequests: 0,
                    totalErrors: 0,
                    totalPromptTokens: 0,
                    totalCompletionTokens: 0,
                    lastLatency: 0,
                    lastStatus: null,
                    lastError: '',
                    recent: []
                },

                _providers: {
                    glm: {
                        name: 'GLM-4-Flash (智谱)',
                        endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
                        model: 'glm-4-flash',
                        storageKey: 'lms_api_key_glm',
                        modelStorageKey: 'lms_model_glm',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys'
                    },
                    deepseek: {
                        name: 'DeepSeek-Chat',
                        endpoint: 'https://api.deepseek.com/chat/completions',
                        model: 'deepseek-chat',
                        storageKey: 'lms_api_key_deepseek',
                        modelStorageKey: 'lms_model_deepseek',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://platform.deepseek.com/api_keys'
                    },
                    openai: {
                        name: 'GPT-4o-mini (OpenAI)',
                        endpoint: 'https://api.openai.com/v1/chat/completions',
                        model: 'gpt-4o-mini',
                        storageKey: 'lms_api_key_openai',
                        modelStorageKey: 'lms_model_openai',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://platform.openai.com/api-keys'
                    },
                    gemini: {
                        name: 'Gemini 2.0 Flash (Google)',
                        endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
                        model: 'gemini-2.0-flash',
                        storageKey: 'lms_api_key_gemini',
                        modelStorageKey: 'lms_model_gemini',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://aistudio.google.com/app/apikey'
                    },
                    moonshot: {
                        name: 'Moonshot (Kimi)',
                        endpoint: 'https://api.moonshot.cn/v1/chat/completions',
                        model: 'moonshot-v1-8k',
                        storageKey: 'lms_api_key_moonshot',
                        modelStorageKey: 'lms_model_moonshot',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://platform.moonshot.cn/console/api-keys'
                    },
                    qwen: {
                        name: '通义千问 (Qwen)',
                        endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                        model: 'qwen-plus',
                        storageKey: 'lms_api_key_qwen',
                        modelStorageKey: 'lms_model_qwen',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://dashscope.aliyun.com/apiKey'
                    },
                    baichuan: {
                        name: '百川 Baichuan',
                        endpoint: 'https://api.baichuan-ai.com/v1/chat/completions',
                        model: 'Baichuan4',
                        storageKey: 'lms_api_key_baichuan',
                        modelStorageKey: 'lms_model_baichuan',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://platform.baichuan-ai.com/console/apikey'
                    },
                    minimax: {
                        name: 'MiniMax',
                        endpoint: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
                        model: 'abab6.5-chat',
                        storageKey: 'lms_api_key_minimax',
                        modelStorageKey: 'lms_model_minimax',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'https://www.minimax.chat/document/guides/document_dev_landing'
                    },
                    custom: {
                        name: '自定义 OpenAI 兼容 API',
                        endpoint: '',
                        model: 'gpt-4o-mini',
                        storageKey: 'lms_api_key_custom',
                        modelStorageKey: 'lms_model_custom',
                        authHeader: (key) => `Bearer ${key}`,
                        docsUrl: 'about:blank'
                    }
                },

                init() {
                    this._provider = localStorage.getItem('lms_ai_provider') || 'glm';
                    const cfg = this._providers[this._provider];
                    this._apiKey = cfg ? (localStorage.getItem(cfg.storageKey) || '') : '';

                    const sel = App.dom.get('config-provider-select');
                    if (sel) sel.value = this._provider;

                    const keyInput = App.dom.get('config-api-key');
                    if (keyInput) keyInput.value = this._apiKey;

                    this.updateProviderUI();

                    const monitorFlag = localStorage.getItem('lms_ai_monitor') === '1';
                    this._monitorEnabled = monitorFlag;
                    const monitorToggle = App.dom.get('ai-monitor-toggle');
                    if (monitorToggle) monitorToggle.checked = monitorFlag;
                    this.updateMonitorUI();
                },

                getActiveModelName() {
                    const cfg = this._providers[this._provider];
                    if (!cfg) return '';
                    const key = cfg.modelStorageKey;
                    const saved = key ? (localStorage.getItem(key) || '') : '';
                    return saved || cfg.model;
                },

                getAdvancedParams() {
                    const temp = parseFloat(localStorage.getItem('lms_ai_param_temperature') || '');
                    const topP = parseFloat(localStorage.getItem('lms_ai_param_top_p') || '');
                    const maxTokens = parseInt(localStorage.getItem('lms_ai_param_max_tokens') || '', 10);
                    const presence = parseFloat(localStorage.getItem('lms_ai_param_presence') || '');
                    const frequency = parseFloat(localStorage.getItem('lms_ai_param_frequency') || '');
                    const timeout = parseInt(localStorage.getItem('lms_ai_param_timeout') || '', 10);
                    return {
                        temperature: isFinite(temp) ? temp : 0.7,
                        top_p: isFinite(topP) ? topP : 1.0,
                        max_tokens: isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 1024,
                        presence_penalty: isFinite(presence) ? presence : 0.0,
                        frequency_penalty: isFinite(frequency) ? frequency : 0.0,
                        timeoutMs: isFinite(timeout) ? (timeout > 0 ? timeout : 0) : 60000
                    };
                },

                updateProviderUI() {
                    const cfg = this._providers[this._provider];
                    if (!cfg) return;

                    const keyInput = App.dom.get('config-api-key');
                    if (keyInput) keyInput.placeholder = `输入 ${cfg.name} API Key，可换行填写多个`;

                    const link = App.dom.get('config-docs-link');
                    if (link) {
                        link.href = cfg.docsUrl;
                        link.textContent = `获取 ${cfg.name} Key →`;
                    }

                    const savedKey = localStorage.getItem(cfg.storageKey) || '';
                    this._apiKey = savedKey;
                    if (keyInput) keyInput.value = savedKey;

                    const modelInput = App.dom.get('config-model-name');
                    const activeModel = this.getActiveModelName();
                    if (modelInput) modelInput.value = activeModel;

                    const modelLabel = App.dom.get('config-current-model');
                    if (modelLabel) modelLabel.textContent = activeModel || cfg.model;

                    const adv = this.getAdvancedParams();
                    const tInput = App.dom.get('ai-param-temperature');
                    const pInput = App.dom.get('ai-param-top-p');
                    const mInput = App.dom.get('ai-param-max-tokens');
                    const prInput = App.dom.get('ai-param-presence');
                    const fInput = App.dom.get('ai-param-frequency');
                    const toInput = App.dom.get('ai-param-timeout');
                    if (tInput) tInput.value = String(adv.temperature);
                    if (pInput) pInput.value = String(adv.top_p);
                    if (mInput) mInput.value = String(adv.max_tokens);
                    if (prInput) prInput.value = String(adv.presence_penalty);
                    if (fInput) fInput.value = String(adv.frequency_penalty);
                    if (toInput) toInput.value = String(adv.timeoutMs);
                },

                onProviderChange(val) {
                    this._provider = val;
                    localStorage.setItem('lms_ai_provider', val);
                    this.updateProviderUI();
                },

                saveApiKey() {
                    const keyInput = App.dom.get('config-api-key');
                    const modelInput = App.dom.get('config-model-name');
                    const cfg = this._providers[this._provider];
                    if (keyInput && cfg) {
                        this._apiKey = keyInput.value.trim();
                        localStorage.setItem(cfg.storageKey, this._apiKey);
                    }
                    if (modelInput && cfg) {
                        const val = modelInput.value.trim();
                        if (cfg.modelStorageKey) {
                            if (val) localStorage.setItem(cfg.modelStorageKey, val);
                            else localStorage.removeItem(cfg.modelStorageKey);
                        }
                    }
                    const tInput = App.dom.get('ai-param-temperature');
                    const pInput = App.dom.get('ai-param-top-p');
                    const mInput = App.dom.get('ai-param-max-tokens');
                    const prInput = App.dom.get('ai-param-presence');
                    const fInput = App.dom.get('ai-param-frequency');
                    const toInput = App.dom.get('ai-param-timeout');
                    if (tInput && tInput.value) localStorage.setItem('lms_ai_param_temperature', tInput.value);
                    if (pInput && pInput.value) localStorage.setItem('lms_ai_param_top_p', pInput.value);
                    if (mInput && mInput.value) localStorage.setItem('lms_ai_param_max_tokens', mInput.value);
                    if (prInput && prInput.value) localStorage.setItem('lms_ai_param_presence', prInput.value);
                    if (fInput && fInput.value) localStorage.setItem('lms_ai_param_frequency', fInput.value);
                    if (toInput && toInput.value) localStorage.setItem('lms_ai_param_timeout', toInput.value);
                    this.updateProviderUI();
                    alert(`${cfg?.name || 'API 配置'} 保存成功！支持填写多个 Key，并自定义模型名称。`);
                },

                saveAdvancedParams() {
                    const tInput = App.dom.get('ai-param-temperature');
                    const pInput = App.dom.get('ai-param-top-p');
                    const mInput = App.dom.get('ai-param-max-tokens');
                    const prInput = App.dom.get('ai-param-presence');
                    const fInput = App.dom.get('ai-param-frequency');
                    const toInput = App.dom.get('ai-param-timeout');
                    if (tInput && tInput.value !== '') localStorage.setItem('lms_ai_param_temperature', tInput.value);
                    else localStorage.removeItem('lms_ai_param_temperature');
                    if (pInput && pInput.value !== '') localStorage.setItem('lms_ai_param_top_p', pInput.value);
                    else localStorage.removeItem('lms_ai_param_top_p');
                    if (mInput && mInput.value !== '') localStorage.setItem('lms_ai_param_max_tokens', mInput.value);
                    else localStorage.removeItem('lms_ai_param_max_tokens');
                    if (prInput && prInput.value !== '') localStorage.setItem('lms_ai_param_presence', prInput.value);
                    else localStorage.removeItem('lms_ai_param_presence');
                    if (fInput && fInput.value !== '') localStorage.setItem('lms_ai_param_frequency', fInput.value);
                    else localStorage.removeItem('lms_ai_param_frequency');
                    if (toInput && toInput.value !== '') localStorage.setItem('lms_ai_param_timeout', toInput.value);
                    else localStorage.removeItem('lms_ai_param_timeout');
                    this.updateProviderUI();
                    alert('AI 高级参数已保存。');
                },

                async call(messages, maxTokens = 1024, temperature = 0.7) {
                    return new Promise((resolve, reject) => {
                        this._queue.push({ messages, maxTokens, temperature, resolve, reject });
                        this._drainQueue();
                    });
                },

                async _drainQueue() {
                    if (this._isProcessingQueue) return;
                    this._isProcessingQueue = true;
                    while (this._queue.length) {
                        const job = this._queue.shift();
                        const now = Date.now();
                        const diff = now - this._lastCallAt;
                        if (this._lastCallAt && diff < this._minIntervalMs) {
                            await new Promise(r => setTimeout(r, this._minIntervalMs - diff));
                        }
                        try {
                            const result = await this._executeAPICall(job.messages, job.maxTokens, job.temperature);
                            job.resolve(result.content);
                        } catch (e) {
                            job.reject(e);
                        } finally {
                            this._lastCallAt = Date.now();
                        }
                    }
                    this._isProcessingQueue = false;
                },

                async _executeAPICall(messages, maxTokens, temperature) {
                    const cfg = this._providers[this._provider];
                    if (!cfg) throw new Error('未知的模型提供商 (Unknown Provider)');
                    if (!this._apiKey) throw new Error('请先在设置中配置 API Key (API Key missing)');

                    const adv = this.getAdvancedParams();
                    const finalTemp = Number.isFinite(temperature) ? temperature : adv.temperature;
                    const bodyMax = typeof maxTokens === 'number' ? maxTokens : adv.max_tokens;
                    const topP = adv.top_p;
                    const presencePenalty = adv.presence_penalty;
                    const frequencyPenalty = adv.frequency_penalty;
                    const timeoutMs = adv.timeoutMs;

                    const start = Date.now();
                    let status = 0;
                    let abortId = null;
                    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                    try {
                        const rawKey = this._apiKey || '';
                        const keyList = rawKey
                            .split(/[\n,;]/)
                            .map(s => s.trim())
                            .filter(Boolean);
                        if (!keyList.length) throw new Error('API Key 为空，请在设置中填写至少一个 Key');
                        const keyIndex = Math.floor(Math.random() * keyList.length);
                        const useKey = keyList[keyIndex];
                        const endpoint = cfg.endpoint || localStorage.getItem('lms_ai_custom_endpoint') || '';
                        if (controller && typeof timeoutMs === 'number' && timeoutMs > 0) {
                            abortId = setTimeout(() => controller.abort(), timeoutMs);
                        }
                        const response = await fetch(endpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': cfg.authHeader(useKey)
                            },
                            signal: controller ? controller.signal : undefined,
                            body: JSON.stringify({
                                model: this.getActiveModelName(),
                                messages,
                                stream: false,
                                max_tokens: bodyMax,
                                temperature: finalTemp,
                                top_p: topP,
                                presence_penalty: presencePenalty,
                                frequency_penalty: frequencyPenalty
                            })
                        });
                        status = response.status;
                        const latency = Date.now() - start;
                        if (!response.ok) {
                            if (status === 429 || status === 503) {
                                this._minIntervalMs = Math.min(this._minIntervalMs * 2, 10000);
                            }
                            const errBody = await response.text();
                            this._updateMetrics({
                                ok: false,
                                status,
                                latency,
                                usage: null,
                                provider: this._provider,
                                model: cfg.model,
                                errorMessage: errBody.slice(0, 200)
                            });
                            throw new Error(`API Error ${status}: ${errBody.slice(0, 200)}`);
                        }
                        const data = await response.json();
                        const usage = data && data.usage ? data.usage : null;
                        this._updateMetrics({
                            ok: true,
                            status,
                            latency,
                            usage,
                            provider: this._provider,
                            model: cfg.model,
                            errorMessage: ''
                        });
                        const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content ? data.choices[0].message.content : '';
                        return { content, usage };
                    } catch (e) {
                        if (!status) {
                            const latency = Date.now() - start;
                            this._updateMetrics({
                                ok: false,
                                status: status || 0,
                                latency,
                                usage: null,
                                provider: this._provider,
                                model: cfg.model,
                                errorMessage: e && e.message ? e.message : String(e)
                            });
                        }
                        if (e && e.name === 'AbortError') {
                            throw new Error('请求超时，请稍后重试。');
                        }
                        throw e;
                    } finally {
                        if (abortId) clearTimeout(abortId);
                    }
                },

                _updateMetrics(info) {
                    if (!this._stats) {
                        this._stats = {
                            totalRequests: 0,
                            totalErrors: 0,
                            totalPromptTokens: 0,
                            totalCompletionTokens: 0,
                            lastLatency: 0,
                            lastStatus: null,
                            lastError: '',
                            recent: []
                        };
                    }
                    this._stats.totalRequests++;
                    if (!info.ok) this._stats.totalErrors++;
                    const pt = info.usage && typeof info.usage.prompt_tokens === 'number' ? info.usage.prompt_tokens : 0;
                    const ct = info.usage && typeof info.usage.completion_tokens === 'number' ? info.usage.completion_tokens : 0;
                    this._stats.totalPromptTokens += pt;
                    this._stats.totalCompletionTokens += ct;
                    this._stats.lastLatency = info.latency;
                    this._stats.lastStatus = info.status;
                    this._stats.lastError = info.errorMessage || '';
                    const now = Date.now();
                    const record = {
                        ts: now,
                        provider: info.provider,
                        model: info.model,
                        ok: info.ok,
                        status: info.status,
                        latency: info.latency,
                        promptTokens: pt || null,
                        completionTokens: ct || null
                    };
                    this._stats.recent.push(record);
                    if (this._stats.recent.length > 20) this._stats.recent.shift();
                    this.updateMonitorUI();
                },

                getLastUsageRecord() {
                    if (!this._stats || !this._stats.recent || !this._stats.recent.length) return null;
                    const last = this._stats.recent[this._stats.recent.length - 1];
                    if (last && (last.promptTokens != null || last.completionTokens != null)) return last;
                    return null;
                },

                toggleMonitor(enabled) {
                    this._monitorEnabled = !!enabled;
                    localStorage.setItem('lms_ai_monitor', this._monitorEnabled ? '1' : '0');
                    this.updateMonitorUI();
                },

                updateMonitorUI() {
                    const panel = App.dom.get('ai-monitor-panel');
                    const summaryEl = App.dom.get('ai-monitor-summary');
                    const listEl = App.dom.get('ai-monitor-requests');
                    const toggle = App.dom.get('ai-monitor-toggle');
                    if (!panel || !summaryEl || !listEl || !toggle) return;
                    if (this._monitorEnabled) {
                        panel.classList.remove('hidden');
                        toggle.checked = true;
                    } else {
                        panel.classList.add('hidden');
                        toggle.checked = false;
                        return;
                    }
                    const s = this._stats || {
                        totalRequests: 0,
                        totalErrors: 0,
                        totalPromptTokens: 0,
                        totalCompletionTokens: 0,
                        lastLatency: 0,
                        lastStatus: null
                    };
                    const cfg = this._providers[this._provider];
                    const providerName = cfg ? cfg.name : this._provider;
                    const totalTokens = s.totalPromptTokens + s.totalCompletionTokens;
                    let tokenText = '';
                    if (totalTokens > 0) {
                        tokenText = `，Token 用量：提示 ${s.totalPromptTokens}，回答 ${s.totalCompletionTokens}，合计 ${totalTokens}`;
                    }
                    const statusText = typeof s.lastStatus === 'number' && s.lastStatus > 0 ? `，最近状态码：${s.lastStatus}` : '';
                    const latencyText = s.lastLatency ? `，最近延迟：${s.lastLatency}ms` : '';
                    summaryEl.textContent = `${providerName} · 最小间隔 ${this._minIntervalMs}ms · 请求 ${s.totalRequests} 次，错误 ${s.totalErrors} 次${statusText}${latencyText}${tokenText}`;
                    const records = (s.recent || []).slice().reverse();
                    if (!records.length) {
                        listEl.innerHTML = '<div class="text-[10px] text-[var(--sub)]">暂无调用记录。</div>';
                        return;
                    }
                    const rows = records.slice(0, 10).map(r => {
                        const date = new Date(r.ts);
                        const time = date.toLocaleTimeString();
                        const status = r.ok ? 'OK' : 'ERR';
                        const tokens = r.promptTokens != null || r.completionTokens != null ? `${r.promptTokens || 0}/${r.completionTokens || 0}` : '无';
                        return `<div class="flex justify-between gap-2"><span class="flex-1 truncate">${time} · ${r.model}</span><span class="w-10 text-right">${status}</span><span class="w-14 text-right">${r.latency}ms</span><span class="w-16 text-right">${tokens}</span></div>`;
                    });
                    listEl.innerHTML = rows.join('');
                },

                setContext(q) {
                    this._currentQ = q;
                    this._messages = [];
                    const msgArea = App.dom.get('ai-chat-messages');
                    if (msgArea) msgArea.innerHTML = `
                        <div id="ai-chat-welcome" class="text-xs text-[var(--sub)] text-center py-4">
                            ✨ 对这道题有疑问？向 AI 提问吧 (Ask AI about this question)
                        </div>`;
                    const input = App.dom.get('ai-chat-input');
                    if (input) { input.value = ''; input.style.height = 'auto'; }
                },

                buildSystemPrompt(q) {
                    let optionsText = '';
                    if (q.type === 'mcq' || q.type === 'multi') {
                        optionsText = '\n选项：\n' + (q.o || []).map((o, i) =>
                            `${String.fromCharCode(65 + i)}. ${o}`
                        ).join('\n');
                    }
                    const typeMap = { mcq: '单选题', tf: '判断题', multi: '多选题' };
                    const answerText = q.type === 'tf'
                        ? (q.a === 'T' ? '正确' : '错误')
                        : q.a;

                    return `你是一个专业的学习助手。用户正在学习以下题目，请基于题目内容回答用户的问题，解释知识点，帮助用户理解。回答请简洁清晰，使用中文。

            题目信息：
            科目：${q.sub}
            章节：${q.chap}
            题型：${typeMap[q.type] || q.type}
            题目：${q.q}${optionsText}
            正确答案：${answerText}

            请根据以上题目内容回答用户的问题。如果用户的问题与题目无关，也可以适当回答，但优先聚焦在题目知识点上。`;
                },

                buildMistakeProfile(pool) {
                    return pool.map(q => {
                        const records = App.data.history.filter(h => h.id === q.id);
                        const totalAttempts = records.length;
                        const wrongAttempts = records.filter(h => !h.r).length;
                        const errorRate = totalAttempts > 0 ? Math.round((wrongAttempts / totalAttempts) * 100) : 100;

                        const durRecords = records.filter(h => h.d > 0);
                        const avgDuration = durRecords.length > 0
                            ? Math.round(durRecords.reduce((s, h) => s + h.d, 0) / durRecords.length / 1000)
                            : null;

                        const lastRecord = records[records.length - 1];
                        const lastCorrect = lastRecord ? lastRecord.r : false;

                        let consecutiveWrong = 0;
                        for (let i = records.length - 1; i >= 0; i--) {
                            if (!records[i].r) consecutiveWrong++;
                            else break;
                        }

                        const daysSinceLastAttempt = lastRecord
                            ? Math.round((Date.now() - lastRecord.t) / 86400000)
                            : 999;

                        return {
                            id: q.id,
                            q: q.q.slice(0, 30),
                            sub: q.sub,
                            errorRate,
                            avgDuration,
                            consecutiveWrong,
                            lastCorrect,
                            daysSinceLastAttempt,
                            totalAttempts
                        };
                    });
                },

                buildAnalysisPrompt(profiles) {
                    const profileText = profiles.map((p, i) =>
                        `${i + 1}. [${p.sub}] "${p.q}..." | 错误率:${p.errorRate}% | 连续答错:${p.consecutiveWrong}次 | 平均用时:${p.avgDuration ?? '未知'}秒 | 上次答题:${p.daysSinceLastAttempt}天前 | 最近一次:${p.lastCorrect ? '✓正确' : '✗错误'} | 共答:${p.totalAttempts}次`
                    ).join('\n');

                    return `你是一个基于认知心理学和记忆科学的学习分析助手。以下是学生的错题数据，请根据以下原则分析并给出最优的复习顺序：

分析原则：
1. 遗忘曲线：距上次作答越久且当时答错的题，遗忘风险越高，优先级越高
2. 顽固错题：连续答错次数越多，说明知识点越薄弱，需要优先强化
3. 作答时长：用时极短但答错（可能是猜的）和用时极长但答错（理解困难），都需要重点关注
4. 近期状态：最近一次仍答错的题比已答对的更紧迫
5. 错误率权重：错误率越高，越需要优先复习

题目数据（共${profiles.length}道）：
${profileText}

请返回一个JSON数组，格式如下，按复习优先级从高到低排列：
[
  { "id": "题目id", "priority": "high/medium/low", "reason": "简短的分析原因（20字内）", "strategy": "quick_review/deep_study/reinforce" }
]

strategy含义：quick_review=快速过一遍即可, deep_study=需要深入理解, reinforce=需要反复强化

只返回JSON，不要其他文字。`;
                },

                _extractJson(text) {
                    if (typeof text !== 'string') return text;
                    const arrMatch = text.match(/\[[\s\S]*\]/);
                    const objMatch = text.match(/\{[\s\S]*\}/);
                    if (arrMatch && objMatch) {
                        return arrMatch.index < objMatch.index ? arrMatch[0] : objMatch[0];
                    }
                    return arrMatch ? arrMatch[0] : (objMatch ? objMatch[0] : text);
                },

                async analyzeMistakes(pool) {
                    let analysisPool = pool;
                    if (pool.length > 50) {
                        analysisPool = [...pool].sort((a, b) => App.data.getMistakeCount(b.id) - App.data.getMistakeCount(a.id)).slice(0, 50);
                    }

                    const profiles = this.buildMistakeProfile(analysisPool);

                    const raw = await this.call(
                        [{ role: 'user', content: this.buildAnalysisPrompt(profiles) }],
                        2048, 0.3
                    );

                    const cleaned = this._extractJson(raw);
                    const parsed = JSON.parse(cleaned);
                    const usage = this.getLastUsageRecord && this.getLastUsageRecord();
                    if (usage) {
                        const total = (usage.promptTokens || 0) + (usage.completionTokens || 0);
                        console.info(`[AI Mistake Analysis] tokens: prompt=${usage.promptTokens || 0}, completion=${usage.completionTokens || 0}, total=${total}`);
                    }
                    return parsed;
                },

                // 基于原始文本构造题库导入提示词
                buildImportPrompt(rawText) {
                    const example = `{
  "示例科目": {
    "第1章 示例章节": [
      {
        "id": "ex-001",
        "type": "mcq",
        "q": "示例单选题：下面哪一项是……？",
        "o": ["选项A", "选项B", "选项C", "选项D"],
        "a": "B"
      },
      {
        "id": "ex-002",
        "type": "tf",
        "q": "示例判断题：下列说法是否正确？",
        "a": "T"
      },
      {
        "id": "ex-003",
        "type": "multi",
        "q": "示例多选题：下面哪些选项是正确的？",
        "o": ["选项A", "选项B", "选项C"],
        "a": "AC"
      }
    ]
  }
}`;

                    return `你是一名专业的试题结构化助手，任务是从原始文档文本中自动识别出客观题并整理成统一的 JSON 题库格式。

【题型范围（非常重要）】
只抽取以下三种题型，其他类型（如填空题、简答题、主观题、计算题、证明题等）一律忽略、不要出现在 JSON 中：
1. 单选题（mcq）：只有一个正确选项
2. 多选题（multi）：有多个正确选项
3. 判断题（tf）：对/错、是/否、正确/错误

【JSON 目标结构】
根对象是一个字典：键为科目名称（字符串），值为「章节字典」。
章节字典的键为章节名称（字符串），值为题目数组。
每个题目对象必须满足下面模式（不要增加多余字段）：
- id: 字符串，题目标识，保证在全局范围内唯一（可以用「科目简写 + 序号」等方式生成）
- type: "mcq" | "multi" | "tf"
- q: 题干文本（不含选项字母）
- o: 仅对 mcq 和 multi 必须，为选项数组，例如 ["选项A","选项B","选项C","选项D"]
- a:
  - 对 mcq：正确选项的字母，例如 "A"
  - 对 multi：所有正确选项的字母按字母顺序拼接，例如 "AC"、"BD"
  - 对 tf：正确为 "T"，错误为 "F"

【JSON 示例】
${example}

【解析规则建议】
- 尝试识别原文中的科目名称和章节标题（如「一、微观经济学」「第1章 需求与供给」），据此进行分组；如果无法可靠识别，可以将所有题目放入同一个科目和章节下，例如科目名为「默认科目」、章节名为「默认章节」。
- 单选 / 多选选项前通常带有「A.」「B.」「C.」或「A、」「B、」等前缀，请去掉这些前缀，仅保留选项内容。
- 多选题的答案可能以「ABCD」「AC」「B、C」等形式出现，请自动规范为按字母顺序排列且不带分隔符的形式，例如 "AC"。
- 判断题的答案如果是「正确/错误」「对/错」「T/F」，请统一转换为 "T" 或 "F"。
- 严格保证输出是合法的 JSON，键名用双引号包裹，不要在 JSON 外多输出任何说明性文字。

【待解析原始内容】
${rawText}

请直接输出最终 JSON 对象，不要添加解释或注释。`;
                },

                // 只保留单选 / 多选 / 判断题，过滤掉其他类型
                sanitizeImportedBank(obj) {
                    const allowed = new Set(['mcq', 'multi', 'tf']);
                    const result = {};
                    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return result;

                    for (const [sub, chapDict] of Object.entries(obj)) {
                        if (!chapDict || typeof chapDict !== 'object' || Array.isArray(chapDict)) continue;
                        const cleanedChaps = {};
                        for (const [chap, arr] of Object.entries(chapDict)) {
                            if (!Array.isArray(arr)) continue;
                            const cleanedQs = arr
                                .filter(q => q && allowed.has(q.type))
                                .map(q => {
                                    const copy = { ...q };
                                    if ((copy.type === 'mcq' || copy.type === 'multi') && Array.isArray(copy.o)) {
                                        copy.o = copy.o.map(opt => {
                                            if (typeof opt !== 'string') return opt;
                                            return opt.replace(/^\s*[A-ZＡ-Ｚ][\.\．、，\)\）]\s*/, '');
                                        });
                                    }
                                    return copy;
                                });
                            if (cleanedQs.length > 0) cleanedChaps[chap] = cleanedQs;
                        }
                        if (Object.keys(cleanedChaps).length > 0) result[sub] = cleanedChaps;
                    }
                    return result;
                },

                // 从 modal 文本框中读取原始内容，调用大模型生成题库 JSON（仅写入预览区，不直接导入）
                async importFromRawText() {
                    if (this._isLoading) return;

                    if (!this._apiKey) {
                        alert("请先在【设置】中选择模型并配置对应的 API Key。");
                        return;
                    }

                    const textarea = App.dom.get('ai-import-raw');
                    const previewEl = App.dom.get('ai-import-preview');
                    const statusEl = App.dom.get('ai-import-status');
                    const raw = textarea ? textarea.value.trim() : '';
                    if (!raw) {
                        alert("请先上传文档或在文本框中粘贴试题内容。");
                        return;
                    }

                    const maxLen = 20000;
                    const limited = raw.length > maxLen ? raw.slice(0, maxLen) : raw;
                    const segmentSize = 4000;
                    const segments = [];
                    for (let i = 0; i < limited.length; i += segmentSize) {
                        segments.push(limited.slice(i, i + segmentSize));
                    }

                    this._isLoading = true;
                    if (previewEl) previewEl.value = '';
                    if (statusEl) statusEl.textContent = "🧠 正在分段调用 AI 识别题目并生成题库 JSON，请稍候…";

                    try {
                        const merged = {};
                        let totalPrompt = 0;
                        let totalCompletion = 0;
                        for (let i = 0; i < segments.length; i++) {
                            const seg = segments[i];
                            const prompt = this.buildImportPrompt(seg);
                            if (statusEl) statusEl.textContent = `🧠 正在处理第 ${i + 1} / ${segments.length} 段文本…`;
                            const reply = await this.call(
                                [{ role: 'user', content: prompt }],
                                4096,
                                0.2
                            );
                            const lastUsage = this.getLastUsageRecord && this.getLastUsageRecord();
                            if (lastUsage) {
                                totalPrompt += lastUsage.promptTokens || 0;
                                totalCompletion += lastUsage.completionTokens || 0;
                            }
                            const cleaned = this._extractJson(reply);
                            const obj = JSON.parse(cleaned);
                            const sanitized = this.sanitizeImportedBank(obj);
                            for (const [sub, chapDict] of Object.entries(sanitized)) {
                                if (!merged[sub]) merged[sub] = {};
                                for (const [chap, arr] of Object.entries(chapDict)) {
                                    if (!merged[sub][chap]) merged[sub][chap] = [];
                                    merged[sub][chap] = merged[sub][chap].concat(arr);
                                }
                            }
                        }
                        if (!Object.keys(merged).length) {
                            if (statusEl) statusEl.textContent = "⚠️ AI 未识别到任何单选/多选/判断题，请检查原文格式后重试。";
                            alert("AI 未识别到任何符合要求的客观题（mcq/multi/tf）。");
                            return;
                        }
                        const pretty = JSON.stringify(merged, null, 2);
                        if (previewEl) previewEl.value = pretty;
                        if (statusEl) {
                            const tokenTip = totalPrompt + totalCompletion > 0
                                ? ` 本次 Token 用量：提示 ${totalPrompt}，回答 ${totalCompletion}，合计 ${totalPrompt + totalCompletion}。`
                                : '';
                            statusEl.textContent = "✅ 已生成 JSON 预览（仅包含单选/多选/判断题），请确认无误后再点击「导入预览 JSON 到题库」。" + tokenTip;
                        }
                    } catch (e) {
                        console.error("AI import error", e);
                        if (statusEl) statusEl.textContent = "❌ AI 识别或预览生成失败：" + (e.message || e.toString());
                        alert("AI 识别或预览生成失败，请检查状态栏中的错误信息。");
                    } finally {
                        this._isLoading = false;
                    }
                },

                // 从只读预览区读取 JSON 并导入题库
                importFromPreview() {
                    const previewEl = App.dom.get('ai-import-preview');
                    const statusEl = App.dom.get('ai-import-status');
                    const reportEl = App.dom.get('ai-import-report');
                    const text = previewEl ? previewEl.value.trim() : '';
                    if (!text) {
                        alert("预览区为空，请先生成 JSON 预览。");
                        return;
                    }
                    try {
                        const obj = JSON.parse(text);
                        const sanitized = this.sanitizeImportedBank(obj);
                        if (!Object.keys(sanitized).length) {
                            if (statusEl) statusEl.textContent = "⚠️ 预览 JSON 中没有单选/多选/判断题，未导入任何题目。";
                            alert("预览 JSON 中没有包含 type 为 mcq/multi/tf 的题目。");
                            return;
                        }
                        // 统计本次即将导入的题目数量，并进行二次确认
                        let questionCount = 0;
                        for (const sub in sanitized) {
                            const chapDict = sanitized[sub] || {};
                            for (const chap in chapDict) {
                                const arr = chapDict[chap];
                                if (Array.isArray(arr)) questionCount += arr.length;
                            }
                        }
                        const ok = confirm(`即将根据预览 JSON 导入约 ${questionCount} 道题（仅单选/多选/判断题），是否继续？`);
                        if (!ok) {
                            if (statusEl) statusEl.textContent = "已取消本次导入，请检查预览 JSON 是否符合预期。";
                            return;
                        }

                        const report = App.data.importBank(JSON.stringify(sanitized));
                        if (!report) {
                            if (statusEl) statusEl.textContent = "❌ 导入失败，请检查 JSON 格式或控制台错误信息。";
                            return;
                        }
                        if (statusEl) statusEl.textContent = "✅ 已根据预览 JSON 成功导入题库（仅包含单选/多选/判断题）。";

                        // 展示导入报告及疑似相似题提醒
                        if (reportEl) {
                            const r = App.data._lastImportReport;
                            if (r) {
                                let html = `<div class="font-bold mb-1">导入结果摘要：</div>
                                    <ul class="list-disc ml-4 space-y-0.5">
                                        <li>新增题目：${r.added}</li>
                                        <li>覆盖更新：${r.updated}</li>
                                        <li>完全重复跳过：${r.skippedSame}</li>
                                        <li>疑似相似题组：${r.similarPairs.length}</li>
                                    </ul>`;
                                if (r.similarPairs.length) {
                                    html += `<div class="mt-2 font-bold">疑似相似题预警（仅展示前 5 组）：</div>`;
                                    r.similarPairs.slice(0, 5).forEach((pair, idx) => {
                                        const subEsc = App.utils.escapeHTML(pair.sub || '');
                                        const chapEsc = App.utils.escapeHTML(pair.chap || '');
                                        const existQ = App.utils.escapeHTML(pair.existing?.q || '');
                                        const incomingQ = App.utils.escapeHTML(pair.incoming?.q || '');
                                        html += `<div class="mt-1.5 p-1.5 rounded border border-[var(--border)] bg-[var(--card)]">
                                            <div class="text-[10px] text-[var(--sub)] mb-1">#${idx + 1} [${subEsc} / ${chapEsc}] 相似度：${(pair.score * 100).toFixed(0)}%</div>
                                            <div class="text-[11px] text-emerald-700 mb-0.5">现有：${existQ}</div>
                                            <div class="text-[11px] text-sky-700">新题：${incomingQ}</div>
                                        </div>`;
                                    });
                                    html += `<div class="mt-1 text-[10px] text-[var(--sub)]">可以点击下方按钮进入「疑似相似题审查」界面，逐题决定是否保留。</div>
                                             <button onclick="App.ui.openSimilarReview()" class="mt-2 px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-700 text-[10px] hover:bg-amber-100 active:scale-95">
                                                打开疑似相似题审查
                                             </button>`;
                                }
                                reportEl.innerHTML = html;
                                reportEl.classList.remove('hidden');
                            }
                        }
                    } catch (e) {
                        console.error("Import from preview error", e);
                        if (statusEl) statusEl.textContent = "❌ 预览 JSON 解析失败：" + (e.message || e.toString());
                        alert("预览 JSON 不是合法的 JSON 格式，请检查后重试。");
                    }
                },

                async send() {
                    if (this._isLoading || !this._currentQ) return;
                    if (!this._apiKey) {
                        alert("请先在设置中选择模型并配置对应的 API Key。(Please select a model and configure API Key in Settings first.)");
                        return;
                    }

                    const input = App.dom.get('ai-chat-input');
                    const userText = input ? input.value.trim() : '';
                    if (!userText) return;

                    input.value = '';
                    input.style.height = 'auto';

                    this.appendMessage('user', userText);
                    this._messages.push({ role: 'user', content: userText });

                    const loadingId = `ai-msg-loading-${Date.now()}`;
                    this.appendMessage('assistant', '...', loadingId);

                    this._isLoading = true;
                    App.dom.get('ai-send-btn').disabled = true;

                    try {
                        const aiText = await this.call(
                            [{ role: 'system', content: this.buildSystemPrompt(this._currentQ) }, ...this._messages],
                            1024, 0.7
                        );
                        const usage = this.getLastUsageRecord && this.getLastUsageRecord();
                        let decorated = aiText;
                        if (usage && (usage.promptTokens || usage.completionTokens)) {
                            const p = usage.promptTokens || 0;
                            const c = usage.completionTokens || 0;
                            const total = p + c;
                            decorated = aiText + `\n\n—— 本次 Token：提示 ${p}，回答 ${c}，合计 ${total}`;
                        }
                        this.replaceMessage(loadingId, decorated);
                        this._messages.push({ role: 'assistant', content: aiText });

                    } catch (e) {
                        this.replaceMessage(loadingId, `❌ 请求失败：${e.message}`);
                    } finally {
                        this._isLoading = false;
                        const btn = App.dom.get('ai-send-btn');
                        if (btn) btn.disabled = false;
                    }
                },

                handleKeydown(e) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        this.send();
                    }
                },

                autoResize(el) {
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 96) + 'px';
                },

                appendMessage(role, content, id = '') {
                    const msgArea = App.dom.get('ai-chat-messages');
                    if (!msgArea) return;

                    const welcome = msgArea.querySelector('#ai-chat-welcome');
                    if (welcome) welcome.remove();

                    const div = document.createElement('div');
                    if (id) div.id = id;

                    if (role === 'user') {
                        div.className = 'flex justify-end';
                        div.innerHTML = `<div class="max-w-[85%] bg-primary-600 text-white text-xs rounded-2xl rounded-br-sm px-3 py-2 leading-relaxed whitespace-pre-wrap shadow-sm">${App.utils.escapeHTML(content)}</div>`;
                    } else {
                        div.className = 'flex justify-start';
                        div.innerHTML = `<div class="max-w-[85%] bg-[var(--card)] border border-[var(--border)] text-xs rounded-2xl rounded-bl-sm px-3 py-2 leading-relaxed text-[var(--text)] whitespace-pre-wrap shadow-sm">${content === '...' ? '<span class="animate-pulse">AI 正在思考...</span>' : App.utils.escapeHTML(content)}</div>`;
                    }

                    msgArea.appendChild(div);
                    msgArea.scrollTop = msgArea.scrollHeight;
                },

                replaceMessage(id, content) {
                    const el = App.dom.get(id);
                    if (!el) return;
                    el.querySelector('div').innerHTML = App.utils.escapeHTML(content);
                    const msgArea = App.dom.get('ai-chat-messages');
                    if (msgArea) msgArea.scrollTop = msgArea.scrollHeight;
                },

                clearChat() {
                    if (this._currentQ) this.setContext(this._currentQ);
                }
            },

            quiz: {
                queue: [], idx: 0, stats: { c: 0, w: 0 }, currentMultiSelection: new Set(), lastConfig: null,
                _questionStartTime: null,
                _isAnalyzing: false,
                _pendingNextTimer: null,

                init(mode, config = {}) {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    // 答题期间暂停云端同步，做完再一次性上传
                    App.data._suppressCloudSync = true;
                    let pool = App.data.getQuestions();
                    if (!pool.length) {
                        alert("当前题库为空，请先在设置中导入题库文件。\n(The question bank is empty. Please import a JSON file in settings.)");
                        return false;
                    }

                    this.lastConfig = { mode, options: { ...config } };

                    let typeConstraint = 'all';
                    let limit = 20;

                    if (mode === 'random') {
                        if (!config.type) typeConstraint = App.dom.getValue('smart-type', 'all');
                        else typeConstraint = config.type;

                        if (!config.limit) {
                            const l = App.dom.getValue('smart-limit', '20');
                            limit = l === 'all' ? pool.length : parseInt(l);
                        } else {
                            limit = config.limit;
                        }

                        const subChks = document.querySelectorAll('.smart-subject-chk:checked');
                        if (subChks.length > 0) {
                            const selectedSubs = Array.from(subChks).map(c => c.value);
                            pool = pool.filter(q => selectedSubs.includes(q.sub));
                        }
                    } else if (mode === 'custom') {
                        if (!config.type) typeConstraint = App.dom.getValue('setup-type', 'all');
                        else typeConstraint = config.type;
                    }

                    if (typeConstraint === 'mcq') pool = pool.filter(q => q.type === 'mcq');
                    if (typeConstraint === 'tf') pool = pool.filter(q => q.type === 'tf');
                    if (typeConstraint === 'multi') pool = pool.filter(q => q.type === 'multi');

                    if (pool.length === 0) {
                        alert("此筛选条件下没有符合的题目。请更改条件后重试。\n(No questions match your filter criteria.)");
                        return false;
                    }

                    if (mode === 'mistakes') {
                        const errIds = new Set(App.data.history.filter(h => !h.r).map(h => h.id));
                        pool = pool.filter(q => errIds.has(q.id));
                        if (!pool.length) { alert("太棒了！您的题库中暂无错题。\n(Great job! No mistakes found.)"); return false; }
                        this.queue = App.utils.shuffle(pool);
                    } else if (mode === 'random') {
                        this.queue = App.utils.shuffle(pool).slice(0, limit);
                    } else if (mode === 'custom') {
                        const chks = document.querySelectorAll('.setup-chk:checked');
                        if (chks.length > 0) {
                            const targets = Array.from(chks).map(c => c.value);
                            pool = pool.filter(q => targets.includes(`${q.sub}|${q.chap}`));
                        }
                        if (!pool.length) { alert("选中的章节下没有符合的题目。\n(No questions in the selected chapters.)"); return false; }

                        pool = App.utils.shuffle(pool);
                        const l = App.dom.getValue('setup-limit', '20');
                        this.queue = l === 'all' ? pool : pool.slice(0, parseInt(l));
                    }

                    this.idx = 0; this.stats = { c: 0, w: 0 };
                    App.router.go('quiz');
                    this.render();
                    return true;
                },

                async initWithAI() {
                    // 修复 3: 防重复并发锁 (Mutex Lock)
                    if (this._isAnalyzing) return;

                    const aiModeOn = document.getElementById('ai-mode-toggle')?.checked;

                    if (!aiModeOn) {
                        this.init('mistakes');
                        return;
                    }

                    if (!App.ai._apiKey) {
                        alert("AI 模式需要先在设置中选择模型并配置对应的 API Key。(AI mode requires API Provider configuration first.)");
                        return;
                    }

                    let pool = App.data.getQuestions();
                    const errIds = new Set(App.data.history.filter(h => !h.r).map(h => h.id));
                    pool = pool.filter(q => errIds.has(q.id));

                    if (!pool.length) {
                        alert("太棒了！暂无错题。(Great job! No mistakes found.)");
                        return;
                    }

                    this._isAnalyzing = true;
                    const btn = document.querySelector('[onclick="App.quiz.initWithAI()"]');
                    const originalText = btn?.innerHTML;
                    if (btn) btn.innerHTML = '🧠 分析中...';

                    try {
                        const analysisResult = await App.ai.analyzeMistakes(pool);

                        const priorityWeight = { high: 3, medium: 2, low: 1 };
                        const analysisMap = new Map(analysisResult.map(r => [r.id, r]));

                        pool.sort((a, b) => {
                            const wa = priorityWeight[analysisMap.get(a.id)?.priority] || 0;
                            const wb = priorityWeight[analysisMap.get(b.id)?.priority] || 0;
                            return wb - wa;
                        });

                        pool = pool.map(q => ({
                            ...q,
                            _aiAnalysis: analysisMap.get(q.id) || null
                        }));

                        this.lastConfig = { mode: 'mistakes', options: {} };
                        this.queue = pool;
                        this.idx = 0;
                        this.stats = { c: 0, w: 0 };
                        App.router.go('quiz');
                        this.render();

                    } catch (e) {
                        alert(`AI 分析失败：${e.message}\n将使用普通模式开始。(Falling back to normal mode.)`);
                        this.init('mistakes');
                    } finally {
                        this._isAnalyzing = false;
                        if (btn) btn.innerHTML = originalText;
                    }
                },

                restart() {
                    if (this.lastConfig) this.init(this.lastConfig.mode, this.lastConfig.options);
                    else this.init('random');
                },

                render() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    const q = this.queue[this.idx];
                    if (!q) return;
                    App.dom.setText('q-type', q.type === 'mcq' ? '单选' : (q.type === 'multi' ? '多选' : '判断'));
                    App.dom.setText('q-sub', q.sub);
                    App.dom.setText('q-text', q.q);
                    App.dom.setText('quiz-progress', `${this.idx + 1} / ${this.queue.length}`);

                    this._questionStartTime = Date.now();

                    const c = App.dom.get('q-options');
                    if (c) { c.innerHTML = ''; c.style.pointerEvents = 'auto'; }
                    App.dom.hide('quiz-feedback');

                    const aiTag = App.dom.get('q-ai-tag');
                    if (aiTag) {
                        if (q._aiAnalysis) {
                            const priorityColor = { high: 'text-red-500 bg-red-50 dark:bg-red-900/20', medium: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20', low: 'text-green-600 bg-green-50 dark:bg-green-900/20' };
                            const strategyLabel = { quick_review: '快速过', deep_study: '深入理解', reinforce: '反复强化' };
                            const p = q._aiAnalysis;
                            aiTag.className = `text-[9px] font-bold px-2 py-0.5 rounded border ${priorityColor[p.priority] || ''}`;
                            aiTag.textContent = `🧠 ${strategyLabel[p.strategy] || ''} · ${p.reason}`;
                            aiTag.classList.remove('hidden');
                        } else {
                            aiTag.classList.add('hidden');
                        }
                    }

                    this.currentMultiSelection = new Set();

                    if (q.type === 'multi') {
                        App.dom.show('multi-actions');
                        App.dom.show('multi-hint');

                        (q.o || []).forEach((opt, i) => {
                            const char = String.fromCharCode(65 + i);
                            const safeOpt = App.utils.escapeHTML(opt);
                            const b = document.createElement('div');
                            b.className = "opt-btn card p-4 cursor-pointer hover:border-primary-500 transition-all flex gap-3 items-center group mb-3 rounded-xl touch-manipulation";
                            b.dataset.val = char;
                            b.innerHTML = `<span class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-[var(--sub)] font-bold flex items-center justify-center transition-colors border border-transparent">${char}</span><span class="text-sm font-medium">${safeOpt}</span>`;
                            b.onclick = () => this.toggle(char, b);
                            if (c) c.appendChild(b);
                        });
                    } else {
                        App.dom.hide('multi-actions');
                        App.dom.hide('multi-hint');

                        if (q.type === 'mcq') {
                            (q.o || []).forEach((opt, i) => {
                                const char = String.fromCharCode(65 + i);
                                const safeOpt = App.utils.escapeHTML(opt);
                                const b = document.createElement('div');
                                b.className = "opt-btn card p-4 cursor-pointer hover:border-primary-500 transition-all flex gap-3 items-center group mb-3 rounded-xl touch-manipulation";
                                b.innerHTML = `<span class="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-[var(--sub)] font-bold flex items-center justify-center group-hover:text-primary-600 group-hover:bg-primary-50 transition-colors">${char}</span><span class="text-sm font-medium">${safeOpt}</span>`;
                                b.onclick = () => this.sub(char, b);
                                if (c) c.appendChild(b);
                            });
                        } else {
                            ['T', 'F'].forEach(v => {
                                const b = document.createElement('div');
                                b.className = "opt-btn card p-4 cursor-pointer hover:border-primary-500 transition-all text-center font-bold mb-3 rounded-xl text-lg touch-manipulation";
                                b.innerText = v === 'T' ? '正确 (True)' : '错误 (False)';
                                b.onclick = () => this.sub(v, b);
                                if (c) c.appendChild(b);
                            });
                        }
                    }
                },

                toggle(val, el) {
                    if (this.currentMultiSelection.has(val)) {
                        this.currentMultiSelection.delete(val);
                        el.classList.remove('selected');
                    } else {
                        this.currentMultiSelection.add(val);
                        el.classList.add('selected');
                    }
                },

                submitMulti() {
                    const q = this.queue[this.idx];
                    const selectedArr = Array.from(this.currentMultiSelection).sort();
                    const userAns = selectedArr.join('');

                    if (userAns.length === 0) { alert("请至少选择一个选项！(Select at least one option)"); return; }

                    // 修复 1: 在判题时也做一次安全兜底，避免脏数据引发错误 (Normalization Check)
                    const normalizedAnswer = (q.a || '').split('').sort().join('');
                    const ok = userAns === normalizedAnswer;

                    const duration = this._questionStartTime ? Math.min(Date.now() - this._questionStartTime, 300000) : 0;
                    App.data.record(q.id, ok, duration);

                    const c = App.dom.get('q-options');
                    if (c) c.style.pointerEvents = 'none';
                    App.dom.hide('multi-actions');
                    App.dom.show('quiz-feedback');

                    if (ok) {
                        this.stats.c++;
                        App.dom.setText('fb-icon', '🎉');
                        App.dom.setText('fb-title', '回答正确！');
                        App.dom.setText('fb-desc', '太棒了，完全匹配。');
                    } else {
                        this.stats.w++;
                        App.dom.setText('fb-icon', '✕');
                        App.dom.setText('fb-title', '回答错误 (Incorrect)');
                        const detailedHTML = App.utils.getDetailedOptionHTML(q, q.a);
                        App.dom.setHTML('fb-desc', `正确答案是：<span class="font-bold text-primary-600">${q.a}</span><br/>${detailedHTML}`);
                    }

                    if (c) {
                        Array.from(c.children).forEach(child => {
                            const val = child.dataset.val;
                            const isCorrect = (q.a && typeof q.a === 'string') ? q.a.includes(val) : false;
                            const isSelected = this.currentMultiSelection.has(val);

                            if (isCorrect && !isSelected) child.classList.add('missed');
                            else if (isCorrect) child.classList.add('correct');
                            if (isSelected && !isCorrect) child.classList.add('wrong');
                        });
                    }
                },

                sub(val, el) {
                    const q = this.queue[this.idx];
                    const ok = val === q.a;
                    const duration = this._questionStartTime ? Math.min(Date.now() - this._questionStartTime, 300000) : 0;
                    App.data.record(q.id, ok, duration);

                    const c = App.dom.get('q-options');
                    if (c) c.style.pointerEvents = 'none';

                    if (ok) {
                        this.stats.c++;
                        el.classList.add('correct');
                        App.dom.hide('quiz-feedback');
                        if (this._pendingNextTimer) clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = setTimeout(() => {
                            this._pendingNextTimer = null;
                            this.next();
                        }, 400);
                    } else {
                        this.stats.w++;
                        el.classList.add('wrong');
                        App.dom.show('quiz-feedback');
                        App.dom.setText('fb-icon', '✕');
                        App.dom.setText('fb-title', '回答错误 (Incorrect)');

                        if (q.type === 'mcq') {
                            const detailedHTML = App.utils.getDetailedOptionHTML(q, q.a);
                            App.dom.setHTML('fb-desc', `正确答案：<span class="font-bold text-primary-600">${q.a}</span><br/>${detailedHTML}`);
                        } else {
                            const ansText = q.a === 'T' ? '正确 (True)' : '错误 (False)';
                            App.dom.setText('fb-desc', `正确答案：${ansText}`);
                        }

                        if (q.type === 'mcq' && c) {
                            Array.from(c.children).forEach((child, idx) => {
                                if (String.fromCharCode(65 + idx) === q.a) child.classList.add('correct');
                            });
                        } else if (c) {
                            Array.from(c.children).forEach((child) => {
                                if ((q.a === 'T' && child.innerText.includes('True')) || (q.a === 'F' && child.innerText.includes('False'))) {
                                    child.classList.add('correct');
                                }
                            });
                        }
                    }
                },
                next() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    if (this.idx < this.queue.length - 1) { this.idx++; this.render(); } else this.finish();
                },
                finish() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    // 答题结束，恢复云端同步并触发一次保存
                    App.data._suppressCloudSync = false;
                    if (App.data.saveToCloudDebounced) App.data.saveToCloudDebounced();
                    App.router.go('result');
                    const total = this.queue.length;
                    const answered = this.stats.c + this.stats.w;
                    const unanswered = Math.max(0, total - answered);
                    const finalWrong = this.stats.w + unanswered;
                    const score = total === 0 ? 0 : Math.round((this.stats.c / total) * 100);
                    App.dom.setText('res-score', score + '%');
                    App.dom.setText('res-correct', this.stats.c);
                    App.dom.setText('res-wrong', finalWrong);
                },
                abort() {
                    if (this._pendingNextTimer) {
                        clearTimeout(this._pendingNextTimer);
                        this._pendingNextTimer = null;
                    }
                    // 提前退出，恢复云端同步并触发一次保存
                    App.data._suppressCloudSync = false;
                    if (App.data._historyAppendBuffer.length > 0 && App.data.saveToCloudDebounced) {
                        App.data.saveToCloudDebounced();
                    }
                    App.router.go('dashboard');
                }
            },

            router: {
                validViews: ['dashboard', 'setup', 'library', 'quiz', 'result', 'analytics'],
                currentView: 'dashboard',

                go(id) {
                    const targetId = id === 'mistake_book' ? 'library' : id;

                    if (!this.validViews.includes(targetId)) {
                        console.error(`[Router Error] Invalid view attempt: "${id}". Falling back to dashboard.`);
                        this.go('dashboard');
                        return;
                    }

                    const targetEl = App.dom.get(`view-${targetId}`);
                    if (!targetEl) return;

                    document.querySelectorAll('.view-section').forEach(e => e.classList.add('hidden'));

                    let libMode = 'all';
                    if (id === 'mistake_book') libMode = 'mistakes';

                    targetEl.classList.remove('hidden');
                    this.currentView = targetId;

                    if (id === 'dashboard') App.views.dashboard.render();
                    if (id === 'setup') App.views.setup.render();
                    if (id === 'library' || id === 'mistake_book') App.views.library.render(libMode);
                    if (id === 'analytics') App.views.analytics.render();
                },
                refresh() {
                    const view = this.currentView || 'dashboard';
                    if (view === 'quiz' || view === 'result') return;
                    this.go(view);
                },
                init() { this.go('dashboard'); }
            
};