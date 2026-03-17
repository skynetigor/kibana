import React from 'react';
import {
  ContentSlide,
  SlideTable,
  Card,
} from '../components';

export const Visibility: React.FC = () => (
  <ContentSlide title="From Manual Wiring to Automatic Routing">
    <Card variant="success" className="mb-5">
      <p className="text-slide-body text-slide-secondary">
        With fully <strong>autonomous</strong> triggers, manual wiring (e.g.,
        connecting workflows to rules from the Rules UI) can likely be{' '}
        <strong>omitted entirely</strong> — the system reads the trigger config
        and does the routing. If manual wiring is still needed for some cases,
        visibility gating ensures only workflows with the right trigger type
        appear:
      </p>
    </Card>
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
  </ContentSlide>
);
