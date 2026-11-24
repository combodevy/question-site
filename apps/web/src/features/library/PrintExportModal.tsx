import React, { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import type { LocalQuestion } from '@/db';
import { exportBankJson, openPrintableSheet } from '@/lib/parsers';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface PrintExportModalProps {
  open: boolean;
  questions: LocalQuestion[];
  subjects: string[];
  onClose: () => void;
}

export const PrintExportModal: React.FC<PrintExportModalProps> = ({
  open,
  questions,
  subjects,
  onClose,
}) => {
  const { bi } = useBi();
  const pushToast = useUiStore((s) => s.pushToast);

  const [scopeSub, setScopeSub] = useState('all');
  const [showAnswers, setShowAnswers] = useState(true);
  const [showExplanations, setShowExplanations] = useState(true);

  const filtered = scopeSub === 'all' ? questions : questions.filter((q) => q.sub === scopeSub);

  const handlePrint = () => {
    if (!filtered.length) {
      pushToast(bi('没有可导出的题目', 'No questions to export'), 'warning');
      return;
    }
    const ok = openPrintableSheet(filtered, {
      title: scopeSub === 'all' ? bi('完整题库打印卷', 'Question Bank Sheet') : scopeSub,
      showAnswers,
      showExplanations,
    });
    if (!ok) {
      pushToast(bi('弹出窗口被浏览器拦截，请允许弹窗后重试', 'Popup blocked by browser'), 'warning');
    }
  };

  const handleExportJson = () => {
    if (!filtered.length) {
      pushToast(bi('没有可导出的题目', 'No questions to export'), 'warning');
      return;
    }
    exportBankJson(filtered, `QuestionBank_${scopeSub === 'all' ? 'All' : scopeSub}.json`);
    pushToast(bi(`已导出 ${filtered.length} 道题为 JSON`, `Exported ${filtered.length} questions`), 'success');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={bi('导出与打印试卷', 'Export & Print')}
      size="sm"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1.5">{bi('导出范围', 'Scope')}</label>
          <select
            value={scopeSub}
            onChange={(e) => setScopeSub(e.target.value)}
            className="w-full h-9 px-2.5 rounded-xl bg-canvas border border-line text-sm text-ink outline-none"
          >
            <option value="all">{bi(`全部科目 (${questions.length} 题)`, `All Subjects (${questions.length})`)}</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAnswers}
              onChange={(e) => setShowAnswers(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span>{bi('打印版包含标准答案', 'Include answer key in print')}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showExplanations}
              disabled={!showAnswers}
              onChange={(e) => setShowExplanations(e.target.checked)}
              className="accent-[var(--accent)] disabled:opacity-50"
            />
            <span className={!showAnswers ? 'text-ink-muted' : ''}>
              {bi('包含题目解析', 'Include explanations')}
            </span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-2">
          <Button variant="outline" onClick={handleExportJson}>
            <Download className="w-4 h-4" />
            {bi('导出 JSON', 'Export JSON')}
          </Button>
          <Button variant="primary" onClick={handlePrint}>
            <Printer className="w-4 h-4" />
            {bi('A4 打印 / PDF', 'Print / PDF')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
