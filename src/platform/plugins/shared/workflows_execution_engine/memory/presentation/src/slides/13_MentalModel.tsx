import React from 'react';
import {
  ContentSlide,
  FlowDiagram,
} from '../components';

export const MentalModel: React.FC = () => (
  <ContentSlide title="New Mental Model: Call a Trigger, Not a Workflow">
    <p className="text-slide-body text-slide-secondary mb-6">
      Callers specify which trigger to invoke and provide data matching its schema.
      All data lands in event.
    </p>
    <h3 className="text-slide-h3 text-slide-muted mb-2">Today</h3>
    <FlowDiagram
      steps={[
        { label: 'Any caller', variant: 'caller' },
        { label: '{ inputs: anything }', variant: 'current' },
        { label: 'No validation', variant: 'current' },
        { label: 'executes', variant: 'current' },
      ]}
    />
    <h3 className="text-slide-h3 text-slide-muted mt-6 mb-2">Proposed</h3>
    <FlowDiagram
      steps={[
        { label: 'Invoke trigger', variant: 'caller' },
        { label: 'Validate against schema', variant: 'system' },
        { label: 'Inject into event', variant: 'system' },
        { label: 'execute', variant: 'result' },
      ]}
    />
    <FlowDiagram
      steps={[
        { label: 'No matching trigger', variant: 'caller' },
        { label: 'Rejected (400)', variant: 'current' },
      ]}
    />
  </ContentSlide>
);
