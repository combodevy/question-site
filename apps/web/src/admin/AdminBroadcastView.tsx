import React, { useEffect, useRef, useState } from 'react';
import { FileUp, Send } from 'lucide-react';
import type { Question } from '@qs/shared';
import { adminApi, type AdminUserRow } from '@/lib/api';
import {
  extractTextFromFile,
  parseLooseJson,
  parsePlainTextQuestions,
  sanitizeImportedBank,
} from '@/lib/parsers';
import { useUiStore } from '@/store/useUiStore';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export const AdminBroadcastView: React.FC = () => {
  const { confirm, pushToast } = useUiStore();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [target, setTarget] = useState<'all' | 'user' | 'multi'>('all');
  const [singleUid, setSingleUid] = useState('');
  const [multiUids, setMultiUids] = useState<Set<string>>(new Set());
  const [bankName, setBankName] = useState('官方推荐题库');
  const [rawInput, setRawInput] = useState('');
  const [parsedQs, setParsedQs] = useState<Question[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{
    total: number;
    success: number;
    failed: number;
    skippedDuplicate: number;
  } | null>(null);

  useEffect(() => {
    void adminApi.usersList(1, 100, '').then((r) => {
      setUsers(r.users);
      if (r.users.length) setSingleUid(r.users[0].id);
    });
  }, []);

  const parseContent = (text: string, kind: 'json' | 'text' = 'json') => {
    setRawInput(text);
    setSummary(null);
    if (kind === 'text') {
      const res = parsePlainTextQuestions(text, bankName || '公共题库', '导入章节');
      setParsedQs(res.questions);
      return;
    }
    const loose = parseLooseJson(text);
    if (loose.data) {
      const san = sanitizeImportedBank(loose.data, bankName || '公共题库', '导入章节');
      setParsedQs(san.questions);
    } else {
      // Fall back to plain text heuristic if not JSON
      const res = parsePlainTextQuestions(text, bankName || '公共题库', '导入章节');
      setParsedQs(res.questions);
    }
  };

  const handleFile = async (f: File) => {
    setBusy(true);
    try {
      const ext = await extractTextFromFile(f);
      parseContent(ext.text, ext.kind);
      pushToast(`已从 ${f.name} 解析题库`, 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handlePush = async () => {
    if (!parsedQs.length) {
      pushToast('请先解析出至少 1 道有效题目', 'warning');
      return;
    }
    if (target === 'multi' && multiUids.size === 0) {
      pushToast('请至少选择一个目标用户', 'warning');
      return;
    }
    const ok = await confirm({
      title: '确认广播题库',
      message: `即将向 ${
        target === 'all' ? '全部用户' : target === 'user' ? '指定用户' : `${multiUids.size} 名用户`
      } 下发 ${parsedQs.length} 道题（服务端自动内容去重）。确认推送吗？`,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await adminApi.pushBroadcast({
        target,
        userId: target === 'user' ? singleUid : undefined,
        userIds: target === 'multi' ? Array.from(multiUids) : undefined,
        bankName: bankName.trim() || 'Global Broadcast Bank',
        questions: parsedQs,
      });
      setSummary(res.summary);
      pushToast('全量广播下发完成', 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">题库广播下发</h1>
        <p className="text-xs text-ink-muted mt-0.5">
          同时支持 JSON、TXT、Word (.docx) 与 PDF 解析预览后下发至指定用户或全员
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="lg:col-span-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">默认归属题库/科目名称</label>
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full h-9 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1.5">下发对象</label>
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              {[
                { k: 'all', label: '全站用户' },
                { k: 'user', label: '指定单人' },
                { k: 'multi', label: '多选用户' },
              ].map((m) => (
                <button
                  key={m.k}
                  type="button"
                  onClick={() => setTarget(m.k as typeof target)}
                  className={`py-2 rounded-xl border font-medium ${
                    target === m.k
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line bg-canvas text-ink-muted'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {target === 'user' && (
            <select
              value={singleUid}
              onChange={(e) => setSingleUid(e.target.value)}
              className="w-full h-9 px-2.5 rounded-xl bg-canvas border border-line text-xs text-ink"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
          )}

          {target === 'multi' && (
            <div className="max-h-48 overflow-y-auto custom-scroll border border-line rounded-xl p-2 space-y-1">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-xs px-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={multiUids.has(u.id)}
                    onChange={(e) => {
                      const next = new Set(multiUids);
                      if (e.target.checked) next.add(u.id);
                      else next.delete(u.id);
                      setMultiUids(next);
                    }}
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-ink">{u.username}</span>
                </label>
              ))}
            </div>
          )}

          <div className="pt-2 border-t border-line flex items-center justify-between">
            <Badge tone={parsedQs.length ? 'success' : 'neutral'}>
              已就绪 {parsedQs.length} 题
            </Badge>
            <Button size="sm" variant="primary" loading={busy} onClick={() => void handlePush()}>
              <Send className="w-3.5 h-3.5" />
              执行下发
            </Button>
          </div>

          {summary && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 space-y-1">
              <div className="font-semibold">下发完成汇总：</div>
              <div>
                目标 {summary.total} 人 · 成功 {summary.success} · 失败 {summary.failed} · 去重跳过{' '}
                {summary.skippedDuplicate} 题
              </div>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">上传或粘贴题源</span>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.txt,.docx,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = '';
                }}
              />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} loading={busy}>
                <FileUp className="w-3.5 h-3.5" />
                导入 .json / .txt / .docx / .pdf
              </Button>
            </div>
          </div>

          <textarea
            rows={10}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder="在此粘贴 JSON 题库或带「答案：」行的纯文本试卷…"
            className="w-full p-3 rounded-xl bg-canvas border border-line font-mono text-xs text-ink outline-none focus:border-accent"
          />

          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => parseContent(rawInput)}>
              解析并预览 ({rawInput.length} chars)
            </Button>
          </div>

          {parsedQs.length > 0 && (
            <div className="max-h-44 overflow-y-auto custom-scroll border border-line rounded-xl divide-y divide-line">
              {parsedQs.slice(0, 20).map((q, i) => (
                <div key={q.id} className="p-2.5 text-xs">
                  <span className="font-mono text-ink-muted mr-2">
                    #{i + 1} [{q.type}]
                  </span>
                  <span className="text-ink">{q.q}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
