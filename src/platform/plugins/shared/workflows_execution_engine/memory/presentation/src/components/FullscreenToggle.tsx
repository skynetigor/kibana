import { useState, useEffect, useCallback, type FC } from 'react';

const ExpandIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

const CollapseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" y1="10" x2="21" y2="3" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

export const FullscreenToggle: FC = () => {
  const [visible, setVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  return (
    <div
      className="fixed bottom-0 right-0 w-20 h-20 z-[60]"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <button
        onClick={toggle}
        className={`absolute bottom-4 right-4 w-9 h-9 rounded-lg bg-gray-900/80 backdrop-blur-sm
          text-white/70 hover:text-white hover:bg-gray-900 flex items-center justify-center
          transition-opacity duration-150 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
      >
        {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
      </button>
    </div>
  );
};
