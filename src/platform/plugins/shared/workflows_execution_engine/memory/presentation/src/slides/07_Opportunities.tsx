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
          'Trigger enforcement',
          'Triggers are declarative only',
          <Opportunity key="1">Validate trigger contracts at runtime</Opportunity>,
        ],
        [
          'Manual invocation',
          'Accepts arbitrary data',
          <Opportunity key="2">Require callers to invoke a specific trigger</Opportunity>,
        ],
        [
          'Agent integration',
          'No discoverable schema',
          <Opportunity key="3">Expose trigger schemas as tool contracts</Opportunity>,
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
