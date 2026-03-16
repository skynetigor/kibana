import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  CodeBlock,
  BulletList,
  Card,
} from '../components';

const workflowYaml = `name: Block malicious IP
triggers:
  - type: alert
  - type: manual
    event:
      $ref: alert

steps:
  # Works for both triggers
  - name: block_ip
    type: http
    with:
      url: "https://firewall.internal/..."
      body:
        source: "{{ event.alerts[0].ip }}"
        comment: "{{ event.rule.name }}"`;

export const EventFlow: React.FC = () => (
  <ContentSlide title="All Triggers Produce Events Consistently">
    <TwoColumns
      left={
        <>
          <p className="text-slide-body text-slide-secondary mb-3">
            Manual trigger can reference alert schema so steps work for both.
          </p>
          <CodeBlock code={workflowYaml} />
        </>
      }
      right={
        <>
          <h3 className="text-slide-h3 text-slide-text mb-2">
            How data flows
          </h3>
          <BulletList
            items={[
              'Alert fires: system injects into event',
              'Manual call: validated injected into event',
              'Test run: same flow flagged isTestRun',
            ]}
          />
          <Card variant="success" title="" className="mt-4">
            $ref: alert on the manual trigger inherits the alert event schema —
            no need to rewrite it.
          </Card>
        </>
      }
    />
  </ContentSlide>
);
