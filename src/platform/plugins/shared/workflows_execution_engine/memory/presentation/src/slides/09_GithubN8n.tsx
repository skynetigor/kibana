import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  LogoRow,
  CodeBlock,
  BulletList,
  Badge,
  Card,
} from '../components';

const ghOnlyPr = `on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    # ...`;

const ghWithDispatch = `on:
  pull_request:
    branches: [main]
  workflow_dispatch:  # opt-in manual`;

export const GithubN8n: React.FC = () => (
  <ContentSlide title="Triggers Gate All Invocation">
    <p className="text-slide-body text-slide-secondary mb-5 italic">
      "You don't run a workflow — you invoke a <strong>trigger</strong> of a
      workflow. Triggers are the only entry points. They are{' '}
      <strong>autonomous</strong> and <strong>self-contained</strong>."
    </p>
    <TwoColumns
      left={
        <>
          <LogoRow src="/icons/github-svgrepo-com.svg" name="GitHub Actions" />
          <p className="text-slide-sm text-slide-secondary mb-2">
            Only <code className="text-elastic-blue">pull_request</code> — no
            manual run possible:
          </p>
          <CodeBlock code={ghOnlyPr} />
          <p className="text-slide-sm text-slide-secondary mt-3 mb-2">
            Add <code className="text-elastic-blue">workflow_dispatch</code> to
            opt in to manual runs:
          </p>
          <CodeBlock code={ghWithDispatch} />
          <Card variant="info" className="mt-2">
            <p className="text-slide-sm text-slide-secondary">
              Manual invocation is <strong>opt-in</strong>, not the default. Each
              trigger type must be explicitly declared.
            </p>
          </Card>
        </>
      }
      right={
        <>
          <LogoRow src="/icons/n8n.png" name="n8n" />
          <BulletList
            items={[
              'Webhook Trigger → only fires on webhooks',
              'Add Manual Trigger node explicitly for test runs',
              'Form Trigger with typed fields for user input',
            ]}
          />

          <div className="mt-5 pt-4 border-t border-slide-border">
            <LogoRow src="/icons/tines.png" name="Tines" />
            <BulletList
              items={[
                'Webhook entry action is the only way in',
                'Testing always replays through the entry point',
                'No "bypass the trigger" option exists',
              ]}
            />
          </div>

          <div className="mt-4">
            <Badge variant="green">
              Triggers are the only entry points. No trigger = no invocation.
            </Badge>
          </div>
        </>
      }
    />
  </ContentSlide>
);
