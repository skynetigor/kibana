import React from 'react';
import {
  ContentSlide,
  TwoColumns,
  CodeBlock,
  SlideTable,
  Card,
} from '../components';

const refSchemaYaml = `triggers:
  - type: manual
    event:
      $ref: alert  # inherits AlertEventPropsSchema`;

const extendSchemaYaml = `triggers:
  - type: manual
    event:
      allOf:
        - $ref: alert
        - properties:
            priority:
              type: string
              enum: [low, medium, high, critical]
          required: [priority]`;

export const Schemas: React.FC = () => (
  <ContentSlide title="Referenceable Schemas for Manual Triggers">
    <TwoColumns
      left={
        <>
          <h3 className="text-slide-h3 text-slide-text mb-2">
            Reference a predefined schema
          </h3>
          <CodeBlock code={refSchemaYaml} />
          <h3 className="text-slide-h3 text-slide-text mt-6 mb-2">
            Extend with extra fields
          </h3>
          <CodeBlock code={extendSchemaYaml} />
        </>
      }
      right={
        <>
          <h3 className="text-slide-h3 text-slide-text mb-2">
            Available references
          </h3>
          <SlideTable
            headers={['Reference', 'Provides']}
            rows={[
              ['alert', 'event.alerts event.rule'],
              ['case', 'event.case event.user'],
              ['Custom trigger ID', 'Registered eventSchema'],
            ]}
          />
          <Card
            variant="info"
            title="Future: schema registry"
            className="mt-4"
          >
            User-defined schemas referenced via $ref: my-team/enriched-alert.
            Already requested by the community.
          </Card>
        </>
      }
    />
  </ContentSlide>
);
