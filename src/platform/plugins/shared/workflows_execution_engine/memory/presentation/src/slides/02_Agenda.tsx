import React from 'react';
import { ContentSlide } from '../components';

const agendaItems = [
  'Where We Are Today — opportunities to strengthen triggers',
  'What the Industry Does — patterns we can learn from',
  'How We Can Improve — 8 improvements, hybrid gate model',
  'Discussion — align on priorities and next steps',
];

export const Agenda: React.FC = () => (
  <ContentSlide title="Agenda" centered>
    <ol className="space-y-4 list-none pl-0">
      {agendaItems.map((item, i) => (
        <li key={i} className="flex items-start gap-3 text-slide-body text-slide-secondary">
          <span className="text-elastic-blue font-bold text-xl shrink-0">{i + 1}.</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  </ContentSlide>
);
