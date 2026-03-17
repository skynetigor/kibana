import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  LogoRow,
  BulletList,
  Badge,
  SlideTable,
} from '../components';

export const DatadogTines: React.FC = () => (
  <ContentSlide title="Datadog Uses Trigger-Aware Invocation (soft-gate)">
    <p className="text-slide-body text-slide-secondary mb-5 italic">
      "You don't run a workflow — you invoke a <strong>trigger</strong> of a
      workflow. Triggers are the only entry points. They are{' '}
      <strong>autonomous</strong> and <strong>self-contained</strong>."
    </p>
    <TwoColumns
      left={
        <>
          <LogoRow
            src="/icons/datadoghq-icon.svg"
            name="Datadog"
            badge="Closest competitor"
          />
          <BulletList
            items={[
              'Multiple named trigger types per workflow',
              'Manual runs present trigger-specific input form',
              'Gates visibility across the product by trigger',
            ]}
          />
          <SlideTable
            headers={['Product surface', 'Gate']}
            rows={[
              ['Monitor notification', 'Needs Monitor trigger'],
              ['Security panel', 'Needs Security trigger'],
              ['Via API', 'Needs API trigger'],
              [
                <span key="wf" className="text-elastic-teal font-medium">
                  Workflow page
                </span>,
                <span key="avail" className="text-elastic-teal font-medium">
                  Always available
                </span>,
              ],
            ]}
            className="mt-3 text-sm"
          />
        </>
      }
      right={
        <>
          <h3 className="text-slide-h3 text-slide-text mb-3">
            Why this matters for us
          </h3>
          <BulletList
            items={[
              'Trigger type determines what the user sees',
              'Run UI asks "which trigger?" — not "paste any JSON"',
              'Each trigger type has its own input schema',
              'Visibility gating prevents workflows from surfacing in wrong contexts',
            ]}
          />
          <div className="mt-5">
            <Badge variant="blue">
              Key insight — invoke a trigger, not a workflow.
            </Badge>
          </div>
          <p className="text-slide-sm text-slide-muted mt-3">
            Datadog is the closest to our domain: security workflows triggered by
            monitors, security signals, and APIs. Their model is what we can
            learn from most directly.
          </p>
        </>
      }
    />
  </ContentSlide>
);
