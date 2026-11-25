import React, { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useBi } from '@/i18n/useBi';

export const BackToTop: React.FC<{ threshold?: number }> = ({ threshold = 320 }) => {
  const { bi } = useBi();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      setVisible(y > threshold);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return (
    <button
      type="button"
      data-testid="back-to-top-btn"
      aria-label={bi('回到顶部', 'Back to top')}
      title={bi('回到顶部', 'Back to top')}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={`fixed bottom-20 right-4 md:bottom-7 md:right-7 z-40 w-10 h-10 rounded-full bg-surface/95 backdrop-blur border border-line text-ink hover:text-accent hover:border-accent/60 shadow-lg flex items-center justify-center anim-fab hover:-translate-y-0.5 active:scale-95 ${
        visible
          ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
          : 'opacity-0 translate-y-3 scale-90 pointer-events-none'
      }`}
    >
      <ArrowUp className="w-4 h-4" />
    </button>
  );
};
