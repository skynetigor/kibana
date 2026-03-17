import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  CodeBlock,
  BulletList,
  Card,
} from '../components';

const triggersYaml = [
  'triggers:',
  '  - type: alert',
  '    with:',
  '      rule_name: "OOM in Payment API"',
  '  - type: manual',
  '    event:',
  '      $ref: alert',
  '',
  'steps:',
  '  - name: log',
  '    if: ${{ triggers.alert }}',
  '    type: console',
  '    with:',
  '      message: |',
  '        Rule: {{ triggers.alert.event.rule.name }}',
  '        Config: {{ triggers.alert.with.rule_name }}',
].join('\n');

export const TriggersNamespace: React.FC = () => (
  <ContentSlide
    title={
      <>
        <code className="font-mono text-[26px]">triggers.*</code> Namespace
      </>
    }
  >
    <TwoColumns
      left={
        <>
          <Card variant="warn" title="Problems today">
            <BulletList
              items={[
              'No way to know which trigger fired',
              'Steps can\'t branch based on trigger type',
              'Runtime event data and static YAML config are mixed',
              <>Editor suggestions for <code className="text-elastic-blue font-mono">event</code> are a union of all trigger schemas — confusing with multiple triggers</>,
              ]}
            />
          </Card>
          <p className="text-slide-sm text-slide-secondary mt-4 mb-2">
            Solution — a structured namespace:
          </p>
          <CodeBlock code={triggersYaml} />
        </>
      }
      right={
        <>
          <h3 className="text-slide-h3 text-slide-text mb-2">How it works</h3>
          <BulletList
            items={[
              <><code className="text-elastic-blue font-mono">triggers.alert</code> — truthy when alert fired</>,
              <><code className="text-elastic-blue font-mono">.event.*</code> — runtime data from the trigger</>,
              <><code className="text-elastic-blue font-mono">.with.*</code> — static YAML config</>,
              <><code className="text-elastic-blue font-mono">triggers.manual</code> — null if not active</>,
            ]}
          />
          <h3 className="text-slide-h3 text-slide-text mt-5 mb-2">
            Scales to new triggers
          </h3>
          <BulletList
            items={[
              'Add case trigger → triggers.case.* exists automatically',
              'Add scheduled → triggers.scheduled.* — same pattern',
              'No refactoring of existing steps or event paths',
              'Editor autocomplete grows with each trigger',
            ]}
          />
        </>
      }
    />
  </ContentSlide>
);
