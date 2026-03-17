import React from 'react';
import { ContentSlide, CodeBlock, Card } from '../components';

const manualYaml = ['triggers:', '  - type: manual'].join('\n');

const alertYaml = ['triggers:', '  - type: alert'].join('\n');

const scheduledYaml = [
  'triggers:',
  '  - type: scheduled',
  '    with:',
  '      every: 10m',
].join('\n');

const TriggerCard: React.FC<{
  name: string;
  real?: boolean;
  yaml: string;
  children: React.ReactNode;
}> = ({ name, real, yaml, children }) => (
  <div className="flex flex-col">
    <div className="flex items-center gap-2.5 mb-2">
      <code className="text-lg font-bold font-mono text-slide-text">{name}</code>
      <span
        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
          real ? 'bg-teal-50 text-elastic-teal' : 'bg-pink-50 text-elastic-pink'
        }`}
      >
        {real ? 'real trigger' : 'decorative'}
      </span>
    </div>
    <CodeBlock code={yaml} />
    <p className="text-slide-sm text-slide-secondary mt-2">{children}</p>
  </div>
);

export const CurrentTriggers: React.FC = () => (
  <ContentSlide title="Current Trigger Types">
    <div className="grid grid-cols-3 gap-6">
      <TriggerCard name="manual" yaml={manualYaml}>
        Doesn't affect anything. The "Run workflow" button in the UI works
        regardless of whether you have a manual trigger in YAML or not.
      </TriggerCard>
      <TriggerCard name="alert" yaml={alertYaml}>
        Not a real trigger. You have to manually connect the workflow to a rule
        from the Rules UI — and it doesn't enforce anything. Even without an
        alert trigger, you can still attach a workflow to a rule.
      </TriggerCard>
      <TriggerCard name="scheduled" real yaml={scheduledYaml}>
        The only real trigger. Configure it in YAML — the workflow runs
        automatically on the configured schedule.
      </TriggerCard>
    </div>
    <Card variant="info" className="mt-6">
      <p className="text-slide-sm text-slide-secondary">
        <strong>Two out of three trigger types are decorative</strong> — they
        don't actually trigger anything and don't enforce how the workflow is
        invoked.
      </p>
    </Card>
  </ContentSlide>
);
