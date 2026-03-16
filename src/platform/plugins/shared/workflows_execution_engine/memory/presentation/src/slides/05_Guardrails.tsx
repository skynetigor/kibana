import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  CodeBlock,
  Card,
  BulletList,
} from '../components';

const workflowYaml = `name: Restart Payment API on OOM
triggers:
  - type: alert
    with:
      rule_name: "OOM in Payment API"

consts:
  k8s_deployment: payment-api

steps:
  - name: restart_service
    type: http
    with:
      url: "https://k8s-api.internal/..."
      method: PATCH
      # ... restarts the deployment`;

export const Guardrails: React.FC = () => (
  <ContentSlide title="Production Workflows Need Stronger Guardrails">
    <TwoColumns
      left={<CodeBlock code={workflowYaml} />}
      right={
        <>
          <BulletList
            items={[
              'Trigger filter not enforced',
              'Accepts empty {inputs:{}}',
              'Restarts production unconditionally',
              'Posts blank Slack notification',
            ]}
          />
          <Card variant="info" title="Agent scenario" className="mt-4">
            AI agent misreads "check health" as "restart."
          </Card>
          <p className="text-slide-sm text-slide-muted mt-4">
            Trigger declaration is the guardrail — but it is not enforced at runtime.
          </p>
        </>
      }
    />
  </ContentSlide>
);
