import React, { useEffect, useState } from 'react';
import { useUiStore } from '@/store/useUiStore';
import { Modal } from './Modal';
import { Button } from './Button';
import { useBi } from '@/i18n/useBi';

export const ConfirmDialog: React.FC = () => {
  const { dialog, closeDialog } = useUiStore();
  const { bi } = useBi();
  const [val, setVal] = useState('');

  useEffect(() => {
    if (dialog?.mode === 'prompt') {
      setVal(dialog.defaultValue ?? '');
    }
  }, [dialog]);

  if (!dialog) return null;

  const isPrompt = dialog.mode === 'prompt';
  const cancelVal = isPrompt ? null : false;
  const okVal = isPrompt ? val : true;

  return (
    <Modal
      open={true}
      onClose={() => closeDialog(cancelVal)}
      title={dialog.title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => closeDialog(cancelVal)}>
            {dialog.cancelText || bi('取消', 'Cancel')}
          </Button>
          <Button
            variant={dialog.danger ? 'danger' : 'primary'}
            size="sm"
            onClick={() => closeDialog(okVal)}
          >
            {dialog.confirmText || bi('确定', 'Confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink whitespace-pre-line leading-relaxed">{dialog.message}</p>
      {isPrompt && (
        <input
          autoFocus
          type={dialog.inputType || 'text'}
          value={val}
          placeholder={dialog.placeholder}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              closeDialog(val);
            }
          }}
          className="mt-3 w-full h-10 px-3 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
        />
      )}
    </Modal>
  );
};
