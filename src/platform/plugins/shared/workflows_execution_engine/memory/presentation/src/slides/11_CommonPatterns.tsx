import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  BulletList,
  Card,
} from '../components';

const leftItems: React.ReactNode[] = [
  <>
    <strong>Triggers are contracts</strong> — enforced at runtime, not decorative
  </>,
  <>
    <strong>Invoke a trigger, not a workflow</strong> — callers interact with typed
    entry points
  </>,
  <>
    <strong>Manual invocation needs a mechanism</strong> — explicit opt-in or
    trigger-aware form
  </>,
];

const rightItems: React.ReactNode[] = [
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
  <ContentSlide title="Six Patterns We Can Adopt">
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
