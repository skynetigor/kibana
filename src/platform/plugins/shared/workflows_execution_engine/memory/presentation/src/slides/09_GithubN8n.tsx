import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  LogoRow,
  CodeBlock,
  BulletList,
  Badge,
} from '../components';

const githubYaml = `on:
  workflow_dispatch:
    inputs:
      logLevel:
        description: 'Log level'
        required: true
        type: choice
        options: [info, warning, debug]`;

const Blockquote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <blockquote className="border-l-4 border-blue-500 bg-[#F0F6FC] italic pl-4 py-2 my-2.5 text-slide-secondary text-[15px]">
    {children}
  </blockquote>
);

export const GithubN8n: React.FC = () => (
  <ContentSlide title="GitHub Actions, n8n, and Tines (hard-gate)">
    <TwoColumns
      left={
        <>
          <LogoRow
            src="/icons/github-svgrepo-com.svg"
            name="GitHub Actions"
          />
          <Blockquote>
            To enable a workflow to be triggered manually, you need to configure the
            workflow_dispatch event.
          </Blockquote>
          <CodeBlock code={githubYaml} />
        </>
      }
      right={
        <>
          <LogoRow
            src="/icons/n8n.png"
            name="n8n"
          />
          <Blockquote>
            Workflows always need a trigger, or start point.
          </Blockquote>
          <BulletList
            items={[
              'Requires Manual Trigger node',
              'Offers Form Trigger with typed fields',
              'Separates production vs manual runs',
            ]}
          />

          <div className="mt-5 pt-4 border-t border-slide-border">
            <LogoRow
              src="/icons/tines.png"
              name="Tines"
            />
            <BulletList
              items={[
                'Webhook entry action is the only way in',
                'Send to Story requires defined inputs — fails on missing',
                'Testing always replays through the webhook',
              ]}
            />
          </div>

          <div className="mt-4">
            <Badge variant="green">
              Model — No trigger = no invocation, period.
            </Badge>
          </div>
        </>
      }
    />
  </ContentSlide>
);
