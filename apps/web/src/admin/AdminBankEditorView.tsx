import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Plus, Save, Search, Trash2 } from 'lucide-react';
import type { Question, QuestionType } from '@qs/shared';
import { adminApi, type AdminUserRow } from '@/lib/api';
import { useUiStore } from '@/store/useUiStore';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface AdminBankEditorViewProps {
  initialUserId?: string;
}

export const AdminBankEditorView: React.FC<AdminBankEditorViewProps> = ({ initialUserId }) => {
  const { pushToast } = useUiStore();

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [selectedUid, setSelectedUid] = useState(initialUserId || '');
  const [setId, setSetId] = useState<number | null>(null);
  const [bankName, setBankName] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [rawJson, setRawJson] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void adminApi.usersList(1, 100, '').then((r) => {
      setUsers(r.users);
      if (!selectedUid && r.users.length) {
        setSelectedUid(initialUserId || r.users[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedUid) return;
    void (async () => {
      try {
        const setsRes = await adminApi.usersSets(selectedUid);
        const first = setsRes.sets[0];
        if (!first) {
          setSetId(null);
          setBankName('');
          setQuestions([]);
          setRawJson('[]');
          return;
        }
        const detail = await adminApi.setDetails(first.id);
        setSetId(first.id);
        setBankName(detail.bank_info.name);
        setQuestions(detail.questions || []);
        setRawJson(JSON.stringify(detail.questions || [], null, 2));
      } catch (e) {
        pushToast(e instanceof Error ? e.message : String(e), 'error');
      }
    })();
  }, [selectedUid, pushToast]);

  const filtered = useMemo(() => {
    const qLower = search.trim().toLowerCase();
    return questions
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (typeFilter !== 'all' && item.type !== typeFilter) return false;
        if (
          qLower &&
          !`${item.q} ${item.sub} ${item.chap} ${item.a}`.toLowerCase().includes(qLower)
        ) {
          return false;
        }
        return true;
      });
  }, [questions, search, typeFilter]);

  // Fixed TF-aware quality audit
  const auditIssues = useMemo(() => {
    const issues: string[] = [];
    const seenStem = new Map<string, number>();
    questions.forEach((q, idx) => {
      if (!q.q?.trim()) issues.push(`#${idx + 1} (${q.id}): 题干为空`);
      if (q.type === 'mcq' || q.type === 'multi') {
        if (!Array.isArray(q.o) || q.o.length < 2) {
          issues.push(`#${idx + 1} (${q.id}): 选择题选项不足 2 个`);
        }
      } else if (q.type === 'tf') {
        const up = String(q.a || '').trim().toUpperCase();
        if (up !== 'T' && up !== 'F') {
          issues.push(`#${idx + 1} (${q.id}): 判断题答案 "${q.a}" 不是 T 或 F`);
        }
      } else if (q.type === 'fill') {
        if (!String(q.a || '').trim()) {
          issues.push(`#${idx + 1} (${q.id}): 填空题缺少答案`);
        }
      }
      const key = `${q.sub}::${q.q.trim()}`;
      if (seenStem.has(key)) {
        issues.push(`#${idx + 1} 与 #${seenStem.get(key)! + 1} 同科题干疑似重复`);
      } else {
        seenStem.set(key, idx);
      }
    });
    return issues;
  }, [questions]);

  const updateQuestionAt = (idx: number, patch: Partial<Question>) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch, _editedAt: Date.now() };
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedUid || !setId) {
      pushToast('该用户尚未建立题库', 'warning');
      return;
    }
    let payloadQs = questions;
    if (mode === 'json') {
      try {
        const parsed = JSON.parse(rawJson) as Question[];
        if (!Array.isArray(parsed)) throw new Error('JSON 必须是题目数组 [...]');
        payloadQs = parsed;
        setQuestions(parsed);
      } catch (e) {
        pushToast(e instanceof Error ? e.message : 'JSON 解析失败', 'error');
        return;
      }
    }
    setSaving(true);
    try {
      await adminApi.updateUserBank(selectedUid, setId, bankName || '默认题库', payloadQs);
      pushToast(`已保存 ${payloadQs.length} 道题目并递增同步序列`, 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">用户题库在线编辑与质检</h1>
          <p className="text-xs text-ink-muted mt-0.5">
            支持单/多/判/填四类题型过滤，完整保留 media/psg/大小写
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex p-0.5 rounded-xl bg-surface-muted border border-line text-xs">
            <button
              type="button"
              onClick={() => setMode('visual')}
              className={`px-3 py-1.5 rounded-lg ${
                mode === 'visual' ? 'bg-surface text-ink font-medium shadow-sm' : 'text-ink-muted'
              }`}
            >
              可视化编辑
            </button>
            <button
              type="button"
              onClick={() => {
                setRawJson(JSON.stringify(questions, null, 2));
                setMode('json');
              }}
              className={`px-3 py-1.5 rounded-lg ${
                mode === 'json' ? 'bg-surface text-ink font-medium shadow-sm' : 'text-ink-muted'
              }`}
            >
              Raw JSON
            </button>
          </div>
          <Button size="sm" variant="primary" loading={saving} onClick={() => void handleSave()}>
            <Save className="w-3.5 h-3.5" />
            保存推送
          </Button>
        </div>
      </div>

      <Card padding="sm" className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
        <select
          value={selectedUid}
          onChange={(e) => setSelectedUid(e.target.value)}
          className="sm:col-span-4 h-9 px-2.5 rounded-xl bg-canvas border border-line text-xs text-ink outline-none"
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username} ({u.question_count} 题)
            </option>
          ))}
        </select>

        <div className="sm:col-span-5 relative">
          <Search className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索题干 / 科目 / 章节…"
            className="w-full h-9 pl-9 pr-3 rounded-xl bg-canvas border border-line text-xs text-ink outline-none"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as 'all' | QuestionType)}
          className="sm:col-span-3 h-9 px-2.5 rounded-xl bg-canvas border border-line text-xs text-ink outline-none"
        >
          <option value="all">全部题型 ({questions.length})</option>
          <option value="mcq">单选 (mcq)</option>
          <option value="multi">多选 (multi)</option>
          <option value="tf">判断 (tf)</option>
          <option value="fill">填空 (fill)</option>
        </select>
      </Card>

      {auditIssues.length > 0 ? (
        <details className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-200">
          <summary className="cursor-pointer font-semibold inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            发现 {auditIssues.length} 处质量隐患
          </summary>
          <ul className="mt-2 space-y-1 list-disc pl-5 max-h-36 overflow-y-auto">
            {auditIssues.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </details>
      ) : (
        questions.length > 0 && (
          <div className="px-3 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
            <Check className="w-4 h-4" />
            质量巡检通过（0 异常）
          </div>
        )
      )}

      {mode === 'json' ? (
        <textarea
          rows={20}
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          className="w-full p-4 rounded-2xl bg-surface border border-line font-mono text-xs text-ink outline-none focus:border-accent"
        />
      ) : (
        <div className="space-y-3">
          {filtered.slice(0, 60).map(({ item, index }) => (
            <Card key={item.id} padding="sm" className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{item.type}</Badge>
                  <input
                    value={item.sub}
                    onChange={(e) => updateQuestionAt(index, { sub: e.target.value })}
                    className="h-7 px-2 rounded-lg bg-canvas border border-line text-xs text-ink w-28"
                  />
                  <input
                    value={item.chap}
                    onChange={(e) => updateQuestionAt(index, { chap: e.target.value })}
                    className="h-7 px-2 rounded-lg bg-canvas border border-line text-xs text-ink w-32"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== index))}
                  className="p-1.5 text-ink-muted hover:text-red-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <textarea
                rows={2}
                value={item.q}
                onChange={(e) => updateQuestionAt(index, { q: e.target.value })}
                className="w-full p-2.5 rounded-xl bg-canvas border border-line text-xs text-ink outline-none"
              />
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-ink-muted">答案：</span>
                <input
                  value={item.a}
                  onChange={(e) => updateQuestionAt(index, { a: e.target.value })}
                  className="h-7 px-2 rounded-lg bg-canvas border border-line font-mono text-xs text-ink w-40"
                />
                {item.media && item.media.length > 0 && (
                  <Badge tone="neutral">media: {item.media.length}</Badge>
                )}
                {item.psg && <Badge tone="neutral">含阅读材料</Badge>}
              </div>
            </Card>
          ))}
          {filtered.length > 60 && (
            <div className="text-center text-xs text-ink-muted py-2">
              仅显示前 60 题，可使用上方筛选或 Raw JSON 模式。
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setQuestions((prev) => [
                ...prev,
                {
                  id: `q-${Date.now()}`,
                  type: 'mcq',
                  sub: '默认科目',
                  chap: '默认章节',
                  q: '新题目题干',
                  o: ['选项 A', '选项 B', '选项 C', '选项 D'],
                  a: 'A',
                  d: '',
                },
              ])
            }
          >
            <Plus className="w-3.5 h-3.5" />
            追加一道新题
          </Button>
        </div>
      )}
    </div>
  );
};
