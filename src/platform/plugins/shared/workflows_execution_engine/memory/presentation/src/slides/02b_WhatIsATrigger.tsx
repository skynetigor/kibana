import React from 'react';
import { ContentSlide, Card } from '../components';

export const WhatIsATrigger: React.FC = () => (
  <ContentSlide title="What Is a Trigger?" centered>
    <p className="text-slide-body text-slide-secondary mb-3">
      <strong>Trigger</strong> — a declarative entry point that fires a workflow
      in response to an event (alert, schedule, or manual invocation),
      optionally filtered by a condition.
    </p>
    <p className="text-slide-body text-slide-secondary mb-6">
      A real trigger is:
    </p>
    <div className="grid grid-cols-2 gap-6 w-full">
      <Card variant="success">
        <h3 className="text-xl font-bold text-slide-text mb-2">Autonomous</h3>
        <p className="text-slide-sm text-slide-secondary">
          Fires on its own, without human intervention. You configure it once in
          YAML — it starts working automatically.
        </p>
      </Card>
      <Card variant="success">
        <h3 className="text-xl font-bold text-slide-text mb-2">
          Self-contained
        </h3>
        <p className="text-slide-sm text-slide-secondary">
          Carries all the context the workflow needs. Defines the event shape,
          the data contract, and the invocation mechanism in one place.
        </p>
      </Card>
    </div>
    <Card variant="info" className="mt-6">
      <p className="text-slide-sm text-slide-secondary">
        <strong>You configure it in YAML, and it starts working.</strong> No
        manual wiring in other UIs, no external setup required.
      </p>
    </Card>
  </ContentSlide>
);
