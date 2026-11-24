import React, { useState } from 'react';
import type { MediaItem } from '@qs/shared';
import { parseMediaSegments } from '@/lib/text';
import { HighlightedText } from './HighlightedText';

export interface MediaContentProps {
  text: string;
  media?: MediaItem[];
  highlightQuery?: string;
  className?: string;
}

export const MediaContent: React.FC<MediaContentProps> = ({
  text,
  media,
  highlightQuery = '',
  className = '',
}) => {
  const [zoomSrc, setZoomSrc] = useState<{ src: string; alt: string } | null>(null);
  const segments = parseMediaSegments(text, media);

  return (
    <>
      <div className={`whitespace-pre-wrap break-words ${className}`}>
        {segments.map((seg, i) => {
          if (seg.kind === 'text') {
            return <HighlightedText key={i} text={seg.text} query={highlightQuery} />;
          }
          if (seg.kind === 'img') {
            return (
              <div key={i} className="my-2.5">
                <img
                  src={seg.src}
                  alt={seg.alt}
                  loading="lazy"
                  onClick={() => setZoomSrc({ src: seg.src, alt: seg.alt })}
                  className="max-w-full max-h-72 rounded-xl border border-line bg-white object-contain cursor-zoom-in"
                />
              </div>
            );
          }
          return (
            <div key={i} className="my-2.5">
              {seg.caption && (
                <div className="text-xs text-ink-muted mb-1 font-medium">{seg.caption}</div>
              )}
              <div
                className="media-table"
                dangerouslySetInnerHTML={{ __html: seg.html }}
              />
            </div>
          );
        })}
      </div>

      {zoomSrc && (
        <div
          className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setZoomSrc(null)}
        >
          <img
            src={zoomSrc.src}
            alt={zoomSrc.alt}
            className="max-w-full max-h-[90vh] rounded-xl bg-white object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
};
