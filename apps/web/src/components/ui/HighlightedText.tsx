import React from 'react';
import { highlightSegments } from '@/lib/text';

export const HighlightedText: React.FC<{ text: string; query?: string }> = ({
  text,
  query = '',
}) => {
  if (!query.trim()) return <>{text}</>;
  const segs = highlightSegments(text, query);
  return (
    <>
      {segs.map((seg, i) =>
        seg.hit ? (
          <mark
            key={i}
            className="bg-amber-200/80 dark:bg-amber-600/40 text-inherit rounded px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </>
  );
};
