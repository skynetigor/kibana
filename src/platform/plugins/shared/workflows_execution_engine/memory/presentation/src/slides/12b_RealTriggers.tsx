import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  CodeBlock,
  Card,
  BulletList,
} from '../components';

const alertTriggerYaml = [
  'triggers:',
  '  - type: alert',
  '    with:',
  '      rule: "OOM in Payment API"',
  '      severity: critical',
  '',
  '  - type: alert',
  '    with:',
  '      rule: "High CPU Usage"',
  '      condition:',
  '        threshold: 90',
  '',
  'steps:',
  '  - name: restart_service',
  '    # ...',
].join('\n');

export const RealTriggers: React.FC = () => (
  <ContentSlide title="Make Triggers Real Triggers">
    <TwoColumns
      gap="gap-6"
      left={
        <>
          <p className="text-slide-body text-slide-secondary mb-3">
            Triggers should be <strong>autonomous</strong> and{' '}
            <strong>self-contained</strong>:
          </p>
          <BulletList
            items={[
              'Configured entirely in the workflow YAML',
              'Declare what they connect to and under what conditions',
              'System reads the config and sets up routing automatically',
              'No manual wiring in other UIs required',
            ]}
          />
          <Card variant="success" className="mt-4">
            <p className="text-slide-sm text-slide-secondary">
              <strong>The workflow is the single source of truth.</strong> If
              it's not in the YAML, it doesn't happen.
            </p>
          </Card>
        </>
      }
      right={
        <>
          <p className="text-slide-sm text-slide-secondary mb-2">
            Example: alert trigger declares the rule, condition — and the system
            automatically routes matching alerts:
          </p>
          <CodeBlock code={alertTriggerYaml} />
          <Card variant="info" className="mt-3">
            <p className="text-slide-sm text-slide-secondary">
              Today you declare{' '}
              <code className="text-elastic-blue font-mono">type: alert</code>{' '}
              and then manually connect in Rules UI. With real triggers, the
              system reads the YAML and wires the connection for you.
            </p>
          </Card>
        </>
      }
    />
  </ContentSlide>
);
