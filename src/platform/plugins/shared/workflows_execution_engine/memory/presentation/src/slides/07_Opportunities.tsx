import React from 'react';
import { ContentSlide, SlideTable } from '../components';

const Opportunity: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-elastic-teal font-medium">{children}</span>
);

export const Opportunities: React.FC = () => (
  <ContentSlide title="Opportunities Summary">
    <SlideTable
      headers={['Area', 'Current', 'Opportunity']}
      rows={[
        [
          'Trigger types',
          '2 of 3 are decorative',
          <Opportunity key="1">Make all triggers autonomous and self-contained</Opportunity>,
        ],
        [
          'Trigger enforcement',
          'Triggers are declarative only',
          <Opportunity key="2">Validate trigger contracts at runtime</Opportunity>,
        ],
        [
          'Invocation bypass',
          'Any caller bypasses triggers',
          <Opportunity key="3">Require callers to invoke a specific trigger</Opportunity>,
        ],
        [
          'Execution context',
          'Flat event, string-based check',
          <Opportunity key="4">Typed triggers.* namespace with autocomplete</Opportunity>,
        ],
      ]}
    />
  </ContentSlide>
);
