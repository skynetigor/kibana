import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  BulletList,
  Card,
} from '../components';

const leftItems: React.ReactNode[] = [
  <>
    <strong>Triggers are autonomous</strong> — fire on their own once configured,
    no manual wiring needed
  </>,
  <>
    <strong>Triggers are self-contained</strong> — carry all context the workflow
    needs in one place
  </>,
  <>
    <strong>Triggers are contracts</strong> — enforced at runtime, not decorative
  </>,
  <>
    <strong>Invoke a trigger, not a workflow</strong> — callers interact with typed
    entry points
  </>,
];

const rightItems: React.ReactNode[] = [
  <>
    <strong>Manual invocation needs a mechanism</strong> — explicit opt-in or
    trigger-aware form
  </>,
  <>
    <strong>Consistent event path</strong> — all triggers produce events the same
    way
  </>,
  <>
    <strong>Triggers gate visibility</strong> — workflows surface where triggers
    match
  </>,
  <>
    <strong>Trigger type determines shape</strong> — system derives forms and
    autocomplete
  </>,
];

export const CommonPatterns: React.FC = () => (
  <ContentSlide title="Patterns We Can Adopt">
    <p className="text-slide-body text-slide-secondary mb-5 italic">
      "You don't run a workflow — you invoke a <strong>trigger</strong> of a
      workflow."
    </p>
    <TwoColumns
      left={<BulletList items={leftItems} />}
      right={<BulletList items={rightItems} />}
    />
    <Card variant="info" className="mt-6">
      These are not product-specific choices — they are industry consensus across
      GitHub Actions, n8n, Datadog, and Tines. We can adopt them incrementally.
    </Card>
  </ContentSlide>
);
