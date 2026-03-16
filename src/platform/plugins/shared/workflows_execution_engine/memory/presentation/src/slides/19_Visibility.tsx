import React from 'react';
import {
  ContentSlide,
  SlideTable,
} from '../components';

export const Visibility: React.FC = () => (
  <ContentSlide title="Triggers Gate Where Workflows Surface">
    <SlideTable
      headers={['Context', 'Trigger filter', 'Result']}
      rows={[
        ['Rule actions dropdown', 'alert', 'Only alert workflows appear'],
        ['Case automation', 'cases.*', 'Only matching workflows appear'],
        ['Agent Builder tools', 'manual', 'Only manual-trigger workflows appear'],
        ['Scheduled execution', 'scheduled', 'Task Manager registers these only'],
        [
          'Editor "Run" (production)',
          'manual',
          'Only if manual trigger exists',
        ],
        ['Editor "Test"', 'Any trigger', 'Always available'],
      ]}
    />
    <p className="text-slide-sm text-slide-muted mt-4">
      Right workflows in right contexts — no alert workflows in Case automation,
      no manual-only workflows in rule actions.
    </p>
  </ContentSlide>
);
