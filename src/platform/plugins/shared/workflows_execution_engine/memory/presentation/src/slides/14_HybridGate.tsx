import React from 'react';
import {
  ContentSlide,
  SlideTable,
  TwoColumns,
  BulletList,
  Badge,
} from '../components';

export const HybridGate: React.FC = () => (
  <ContentSlide title="Hybrid Production/Test Gate">
    <SlideTable
      headers={['Context', 'Invocable?', 'isTestRun']}
      rows={[
        [
          'Production + manual trigger',
          <>
            Yes — validated <Badge variant="green">validated</Badge>
          </>,
          'false',
        ],
        ['Production + alert/scheduled/custom', 'System channels only', 'N/A'],
        [
          'Test + any trigger',
          <>
            Yes — user selects trigger <Badge variant="green">validated</Badge>
          </>,
          'true',
        ],
      ]}
    />
    <TwoColumns
      left={
        <>
          <h3 className="text-slide-h3 text-slide-text mt-6 mb-2">
            Production runs (hard gate)
          </h3>
          <BulletList
            items={[
              'Only manual trigger invocable',
              'Prevents accidental production calls',
              'Agents need explicit manual trigger',
            ]}
          />
        </>
      }
      right={
        <>
          <h3 className="text-slide-h3 text-slide-text mt-6 mb-2">
            Test runs (soft gate)
          </h3>
          <BulletList
            items={[
              'Any trigger invocable as test run',
              'Execution flagged isTestRun: true',
              'Existing test/prod branching works',
            ]}
          />
        </>
      }
    />
  </ContentSlide>
);
