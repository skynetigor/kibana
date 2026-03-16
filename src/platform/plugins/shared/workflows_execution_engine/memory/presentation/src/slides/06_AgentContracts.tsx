import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  CodeBlock,
  BulletList,
  Card,
} from '../components';

const toolInputCode = `tool_input: Record<string, any>`;

export const AgentContracts: React.FC = () => (
  <ContentSlide title="Agent Integration Needs Typed Contracts">
    <TwoColumns
      left={
        <>
          <p className="text-slide-body text-slide-secondary mb-3">
            Today, agents receive workflow tools with untyped inputs:
          </p>
          <CodeBlock code={toolInputCode} language="typescript" />
          <p className="text-slide-body text-slide-secondary mt-3">
            No way to know what fields are required or what shape the trigger expects.
          </p>
        </>
      }
      right={
        <>
          <BulletList
            items={[
              'Expose trigger schemas as tool contracts',
              'Agents discover required fields',
              'Validate before execution',
              'Only relevant workflows as tools',
            ]}
          />
          <Card variant="success" className="mt-4">
            Every workflow with typed manual trigger becomes a safe agent tool.
          </Card>
        </>
      }
    />
  </ContentSlide>
);
