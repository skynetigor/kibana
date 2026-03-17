import { useState, useEffect, useCallback, type FC, type ReactNode } from 'react';
import {
  Title, Agenda, WhatIsATrigger, Ch1Title, CurrentTriggers, ValidationGap, ManualBypass, Opportunities,
  Ch2Title, GithubN8n, DatadogTines, CommonPatterns,
  Ch3Title, RealTriggers, MentalModel, HybridGate, EditorUx, EventFlow, TriggersNamespace, Schemas, Visibility, Discussion,
} from './slides';
import { TableOfContents, FullscreenToggle } from './components';

const SLIDES: FC[] = [
  Title, Agenda, WhatIsATrigger,
  Ch1Title, CurrentTriggers, ValidationGap, ManualBypass, Opportunities,
  Ch2Title, GithubN8n, DatadogTines, CommonPatterns,
  Ch3Title, RealTriggers, MentalModel, HybridGate, EditorUx, Schemas, EventFlow, TriggersNamespace, Visibility,
  Discussion,
];

export interface SlideMeta { label: string; chapter: string }

export const SLIDE_META: SlideMeta[] = [
  { label: 'Title',                           chapter: 'Opening' },
  { label: 'Agenda',                          chapter: 'Opening' },
  { label: 'What Is a Trigger',               chapter: 'Opening' },
  { label: 'Where We Are Today',              chapter: 'Ch 1 — Where We Are Today' },
  { label: 'Current Triggers',                chapter: 'Ch 1 — Where We Are Today' },
  { label: 'Inputs & Triggers Gap',           chapter: 'Ch 1 — Where We Are Today' },
  { label: "Invocation Isn't Trigger-Aware",  chapter: 'Ch 1 — Where We Are Today' },
  { label: 'Opportunities',                   chapter: 'Ch 1 — Where We Are Today' },
  { label: 'What the Industry Does',          chapter: 'Ch 2 — What the Industry Does' },
  { label: 'GitHub / n8n / Tines',            chapter: 'Ch 2 — What the Industry Does' },
  { label: 'Datadog',                         chapter: 'Ch 2 — What the Industry Does' },
  { label: 'Patterns We Can Adopt',           chapter: 'Ch 2 — What the Industry Does' },
  { label: 'How We Can Improve',              chapter: 'Ch 3 — How We Can Improve' },
  { label: 'Real Triggers',                   chapter: 'Ch 3 — How We Can Improve' },
  { label: 'New Mental Model',                chapter: 'Ch 3 — How We Can Improve' },
  { label: 'Hybrid Gate',                     chapter: 'Ch 3 — How We Can Improve' },
  { label: 'Editor UX',                       chapter: 'Ch 3 — How We Can Improve' },
  { label: 'Schemas',                         chapter: 'Ch 3 — How We Can Improve' },
  { label: 'Event Flow',                      chapter: 'Ch 3 — How We Can Improve' },
  { label: 'triggers.* Namespace',            chapter: 'Ch 3 — How We Can Improve' },
  { label: 'Visibility / Routing',            chapter: 'Ch 3 — How We Can Improve' },
  { label: 'Discussion',                      chapter: 'Next Steps' },
];

const isTitleSlide = (idx: number) => [0, 3, 8, 12, 21].includes(idx);

const SlideWrapper = ({ children, isTitle, active }: { children: ReactNode; isTitle: boolean; active: boolean }) => (
  <div
    className={`slide-wrapper absolute inset-0 flex flex-col justify-center items-center transition-opacity duration-300
      ${active ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
      ${isTitle ? 'bg-elastic-blue text-white' : 'bg-white text-slide-text'}
    `}
    style={{ padding: '60px 80px' }}
  >
    {children}
  </div>
);

const ElasticWatermark = () => (
  <div className="fixed bottom-4 right-16 z-50 flex items-center gap-1.5 opacity-40">
    <img src="/icons/elastic-logo.svg" width={18} height={18} alt="Elastic" />
    <span className="text-xs font-semibold text-slide-muted">elastic</span>
  </div>
);

const readHash = (total: number): number => {
  const n = parseInt(window.location.hash.replace('#', ''), 10);
  return Number.isFinite(n) && n >= 0 && n < total ? n : 0;
};

export const App = () => {
  const total = SLIDES.length;
  const [current, setCurrent] = useState(() => readHash(total));

  const go = useCallback((n: number) => {
    if (n >= 0 && n < total) {
      setCurrent(n);
      window.location.hash = String(n);
    }
  }, [total]);

  useEffect(() => {
    const onHashChange = () => setCurrent(readHash(total));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [total]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(current + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(current - 1); }
      if (e.key === 'Home') { e.preventDefault(); go(0); }
      if (e.key === 'End') { e.preventDefault(); go(total - 1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current, go, total]);

  return (
    <div className="relative w-full h-full">
      {SLIDES.map((Slide, i) => (
        <SlideWrapper key={i} isTitle={isTitleSlide(i)} active={i === current}>
          <Slide />
        </SlideWrapper>
      ))}

      <div className="nav-chrome">
        <ElasticWatermark />
        <TableOfContents slides={SLIDE_META} current={current} onNavigate={go} />
        <FullscreenToggle />

        {/* Progress bar */}
        <div
          className="fixed bottom-0 left-0 h-[3px] bg-elastic-blue z-50 transition-all duration-300"
          style={{ width: `${total > 1 ? (current / (total - 1)) * 100 : 0}%` }}
        />

        {/* Slide counter */}
        <div className="fixed bottom-4 right-6 text-xs font-medium text-slide-muted z-50">
          {current + 1} / {total}
        </div>
      </div>
    </div>
  );
};
