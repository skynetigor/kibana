import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  CodeBlock,
  BulletList,
  Card,
  LogoRow,
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
  '    if: ${{ triggers.alert.event }}',
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
          <Card variant="info" className="mt-3">
            <p className="text-slide-sm text-slide-secondary">
              <strong>Backward compatibility:</strong> the root-level{' '}
              <code className="text-elastic-blue font-mono">event</code> stays
              as-is (untyped, schema on the user). The new{' '}
              <code className="text-elastic-blue font-mono">triggers.&lt;type&gt;.event</code>{' '}
              co-exists alongside it with a known, typed schema.
            </p>
          </Card>
        </>
      }
      right={
        <>
          <h3 className="text-slide-h3 text-slide-text mb-2">How it works</h3>
          <p className="text-slide-sm text-slide-secondary mb-2">
            The access path mirrors the YAML structure — intuitive and
            zero learning curve:
          </p>
          <BulletList
            items={[
              <><code className="text-elastic-blue font-mono">triggers.alert</code> — always an object reflecting the YAML config</>,
              <><code className="text-elastic-blue font-mono">.with.*</code> — static YAML config (same keys as in YAML)</>,
              <><code className="text-elastic-blue font-mono">.event</code> — truthy only for the invoked trigger; runtime data</>,
              <>Use <code className="text-elastic-blue font-mono">triggers.alert.event</code> to branch: present = alert fired</>,
            ]}
          />
          <h3 className="text-slide-h3 text-slide-text mt-5 mb-2">
            Scales to new triggers
          </h3>
          <BulletList
            items={[
              'Add case trigger → triggers.case.* exists automatically',
              'Add scheduled → triggers.scheduled.* — same pattern',
              <><code className="text-elastic-blue font-mono">triggers.&lt;type&gt;.event</code> is unified — every trigger populates it, same access pattern</>,
              'No refactoring of existing steps or event paths',
              'Editor autocomplete grows with each trigger',
            ]}
          />

          <div className="mt-5 pt-4 border-t border-gray-200">
            <LogoRow src="/icons/datadoghq-icon.svg" name="Datadog" badge="Similar pattern" />
            <p className="text-slide-sm text-slide-secondary mb-1">
              Datadog Workflow Automation uses{' '}
              <code className="text-elastic-blue font-mono">Source.&lt;trigger_type&gt;</code>{' '}
              variables — the trigger source determines which properties are
              available at runtime.
            </p>
            <a
              href="https://docs.datadoghq.com/actions/workflows/variables/#source-object-variables"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slide-sm text-elastic-blue hover:underline"
            >
              docs.datadoghq.com — Source object variables
            </a>
          </div>
        </>
      }
    />
  </ContentSlide>
);
