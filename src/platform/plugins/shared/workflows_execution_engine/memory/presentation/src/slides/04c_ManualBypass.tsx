import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  CodeBlock,
  Card,
  FlowDiagram,
} from '../components';

const workflowYaml = [
  'name: Restart on OOM Alert',
  'triggers:',
  '  - type: alert',
  '    with:',
  '      rule_name: "OOM in Payment API"',
  '',
  'steps:',
  '  - name: log_alert',
  '    type: console',
  '    with:',
  '      message: "Alert: {{ event.rule.name }}"',
  '  - name: restart_service',
  '    type: http',
  '    with:',
  '      url: "https://k8s-api/restart"',
  '      method: POST',
].join('\n');

const callers = [
  { label: 'API call', desc: 'Any client can POST /run' },
  { label: 'Manual run from UI', desc: 'User clicks "Run workflow" button' },
  { label: 'Agent call', desc: 'AI agent invokes workflow as a tool' },
];

export const ManualBypass: React.FC = () => (
  <ContentSlide title="Invocation Isn't Trigger-Aware">
    <TwoColumns
      gap="gap-6"
      left={
        <>
          <CodeBlock code={workflowYaml} />
          <Card variant="warn" title="Designed for alert — but nothing stops other callers">
            <p className="text-slide-sm text-slide-secondary">
              All three invocation paths ignore the{' '}
              <code className="text-elastic-blue">alert</code> trigger.{' '}
              <code className="text-elastic-blue font-mono">event.rule.name</code>{' '}
              is undefined — the workflow runs without alert context.
            </p>
          </Card>
        </>
      }
      right={
        <>
          <p className="text-slide-body text-slide-secondary mb-3">
            Three ways to bypass the configured trigger:
          </p>
          <div className="space-y-3">
            {callers.map((c) => (
              <div key={c.label} className="flex items-start gap-3">
                <span className="shrink-0 mt-0.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-pink-50 text-elastic-pink">
                  {c.label}
                </span>
                <span className="text-slide-sm text-slide-secondary">{c.desc}</span>
              </div>
            ))}
          </div>
          <Card variant="info" className="mt-4">
            <p className="text-slide-sm text-slide-secondary">
              The author has <strong>no way to prevent this</strong>. Trigger
              declarations are metadata — they don't gate invocation.
            </p>
          </Card>
        </>
      }
    />
    <div className="mt-3">
      <FlowDiagram
        steps={[
          { label: 'API / UI / Agent', variant: 'caller' },
          { label: 'trigger ignored', variant: 'current' },
          { label: 'no event data', variant: 'current' },
          { label: 'restarts production', variant: 'current' },
        ]}
      />
    </div>
  </ContentSlide>
);
