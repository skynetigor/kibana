import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  CodeBlock,
  BulletList,
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
        New <code className="font-mono text-sm">triggers.*</code> Namespace in
        Execution Context
      </>
    }
  >
    <TwoColumns
      left={<CodeBlock code={triggersYaml} />}
      right={
        <>
          <h3 className="text-slide-h3 text-slide-text mb-2">How it works</h3>
          <BulletList
            items={[
              'triggers.alert — truthy when alert fired',
              'triggers.alert.event.* — runtime data',
              'triggers.alert.with.* — static YAML config',
              'triggers.manual — null if not active',
            ]}
          />
          <h3 className="text-slide-h3 text-slide-text mt-6 mb-2">
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
