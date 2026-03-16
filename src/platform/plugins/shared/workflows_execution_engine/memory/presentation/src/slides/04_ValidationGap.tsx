import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  Card,
  CodeBlock,
  FlowDiagram,
} from '../components';

const workflowA = [
  'name: New workflow',
  'triggers:',
  '  - type: manual',
  '  - type: scheduled',
  '    with:',
  '      every: 10s',
  '',
  'inputs:',
  '  - name: message',
  '    type: string',
  '    default: "hello world"',
  '',
  'steps:',
  '  - name: hello_world_step',
  '    type: console',
  '    with:',
  '      message: "{{ inputs.message }}"',
].join('\n');

const workflowB = [
  'name: Restart Payment API',
  'triggers:',
  '  - type: alert',
  '    with:',
  '      rule_name: "OOM in Payment API"',
  '',
  '# No inputs defined',
  '',
  'steps:',
  '  - name: restart_service',
  '    type: http',
  '    with:',
  '      url: "https://k8s-api/..."',
  '      method: PATCH',
].join('\n');

export const ValidationGap: React.FC = () => (
  <ContentSlide title="Inputs and Triggers Are Disconnected">
    <TwoColumns
      gap="gap-6"
      left={
        <>
          <CodeBlock code={workflowA} />
          <Card variant="warn" title="Inputs disconnected from triggers">
            <p className="text-slide-sm text-slide-secondary">
              <code className="text-elastic-blue">inputs</code> live at the workflow level.
              When <code className="text-elastic-blue">scheduled</code> fires
              every 10s — who provides <code className="text-elastic-blue">message</code>?
            </p>
          </Card>
        </>
      }
      right={
        <>
          <CodeBlock code={workflowB} />
          <Card variant="warn" title="No trigger enforcement on API calls">
            <p className="text-slide-sm text-slide-secondary">
              No <code className="text-elastic-blue">inputs</code> to validate.
              Any caller can <code className="text-elastic-blue">POST /run</code> with
              arbitrary data — the <code className="text-elastic-blue">alert</code> trigger
              is not enforced.
            </p>
          </Card>
        </>
      }
    />
    <div className="mt-3">
      <FlowDiagram
        steps={[
          { label: 'POST /run', variant: 'current' },
          { label: '{ inputs: anything }', variant: 'current' },
          { label: 'No trigger check', variant: 'current' },
          { label: 'executes', variant: 'current' },
        ]}
      />
    </div>
  </ContentSlide>
);
