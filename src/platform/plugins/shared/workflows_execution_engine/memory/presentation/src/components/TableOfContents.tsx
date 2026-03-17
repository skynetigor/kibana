import { useState, useMemo, type FC } from 'react';
import type { SlideMeta } from '../App';

interface TableOfContentsProps {
  slides: SlideMeta[];
  current: number;
  onNavigate: (index: number) => void;
}

interface ChapterGroup {
  chapter: string;
  items: { index: number; label: string }[];
}

export const TableOfContents: FC<TableOfContentsProps> = ({ slides, current, onNavigate }) => {
  const [open, setOpen] = useState(false);

  const chapters = useMemo<ChapterGroup[]>(() => {
    const groups: ChapterGroup[] = [];
    let last: ChapterGroup | null = null;
    slides.forEach((s, i) => {
      if (!last || last.chapter !== s.chapter) {
        last = { chapter: s.chapter, items: [] };
        groups.push(last);
      }
      last.items.push({ index: i, label: s.label });
    });
    return groups;
  }, [slides]);

  return (
    <>
      {/* Invisible hover zone along the left edge */}
      <div
        className="fixed top-0 left-0 w-10 h-full z-[60]"
        onMouseEnter={() => setOpen(true)}
      />

      {/* Sliding panel */}
      <div
        className={`fixed top-0 left-0 h-full w-72 z-[60] bg-gray-900/95 backdrop-blur-md
          shadow-2xl transition-transform duration-200 ease-out overflow-y-auto
          ${open ? 'translate-x-0' : '-translate-x-full'}`}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="px-5 pt-6 pb-2">
          <span className="text-[11px] font-semibold uppercase tracking-[2px] text-white/40">
            Contents
          </span>
        </div>

        <nav className="px-3 pb-6">
          {chapters.map((ch) => (
            <div key={ch.chapter} className="mb-4">
              <div className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-[1.5px] text-white/40">
                {ch.chapter}
              </div>
              {ch.items.map(({ index, label }) => {
                const isCurrent = index === current;
                return (
                  <button
                    key={index}
                    onClick={() => { onNavigate(index); setOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors duration-100
                      ${isCurrent
                        ? 'bg-elastic-blue/20 text-elastic-blue font-medium'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                      }`}
                  >
                    <span className="inline-block w-5 text-right mr-2 text-[11px] text-white/30 tabular-nums">
                      {index + 1}
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </>
  );
};
