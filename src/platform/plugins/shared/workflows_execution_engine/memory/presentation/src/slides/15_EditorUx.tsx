import React from 'react';
import { ContentSlide, TwoColumns } from '../components';

const TriggerCard: React.FC<{
  label: string;
  description: string;
  selected?: boolean;
}> = ({ label, description, selected }) => (
  <div
    className={`flex-1 rounded-md border p-2.5 cursor-pointer text-left text-[11px] leading-tight ${
      selected
        ? 'border-elastic-blue bg-blue-50'
        : 'border-slide-border bg-white'
    }`}
  >
    <div className="flex items-center gap-1.5 mb-1">
      <span
        className={`inline-block w-3 h-3 rounded-full border-2 ${
          selected
            ? 'border-elastic-blue bg-elastic-blue shadow-[inset_0_0_0_2px_white]'
            : 'border-gray-300 bg-white'
        }`}
      />
      <span className="font-semibold text-slide-text">{label}</span>
    </div>
    <p className="text-slide-muted ml-[18px]">{description}</p>
  </div>
);

const ModalMockup: React.FC = () => (
  <div className="rounded-lg border border-slide-border shadow-lg bg-white overflow-hidden text-[11px]">
    {/* Header */}
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-slide-border">
      <span className="font-bold text-slide-text text-sm">Test Workflow</span>
      <span className="text-slide-muted cursor-pointer text-base leading-none">&times;</span>
    </div>

    {/* Body */}
    <div className="p-3 space-y-3">
      {/* Trigger cards row */}
      <div className="flex gap-2">
        <TriggerCard label="Alert" description="Select an alert to trigger with." selected />
        <TriggerCard label="Case" description="Select a case to trigger with." />
        <TriggerCard label="Manual" description="Provide custom JSON inputs." />
      </div>

      {/* Form placeholder */}
      <div className="rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-center text-slide-muted">
        <div className="text-xs font-medium text-slide-text mb-1">Alert trigger form</div>
        <div className="text-[10px]">Input form rendered from alert trigger schema...</div>
      </div>
    </div>

    {/* Footer */}
    <div className="flex justify-end px-4 py-2 border-t border-slide-border">
      <div className="flex items-center gap-1.5 bg-emerald-500 text-white px-3 py-1 rounded text-xs font-medium">
        <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current">
          <path d="M4 2l10 6-10 6z" />
        </svg>
        Run
      </div>
    </div>
  </div>
);

interface EditorLine {
  num: number;
  raw: string;
  triggerStart?: boolean;
}

const editorLines: EditorLine[] = [
  { num: 1, raw: 'name: alert-responder' },
  { num: 2, raw: 'triggers:' },
  { num: 3, raw: '  - type: alert', triggerStart: true },
  { num: 4, raw: '    with:' },
  { num: 5, raw: '      severity: critical' },
  { num: 6, raw: '  - type: case', triggerStart: true },
  { num: 7, raw: '    with:' },
  { num: 8, raw: '      status: open' },
  { num: 9, raw: '  - type: manual', triggerStart: true },
  { num: 10, raw: 'steps:' },
  { num: 11, raw: '  - id: enrich' },
];

const KEY = 'text-[#007871]';
const PUNCT = 'text-[#69707D]';
const VAL = 'text-[#343741]';

const highlightYamlLine = (raw: string) => {
  const indent = raw.match(/^(\s*)/)?.[1] ?? '';
  const content = raw.trimStart();

  if (content.startsWith('- type:')) {
    const value = content.split(': ')[1];
    return (
      <>
        {indent}<span className={PUNCT}>- </span>
        <span className={KEY}>type</span>
        <span className={PUNCT}>: </span>
        <span className={VAL}>{value}</span>
      </>
    );
  }
  if (content.startsWith('- ') && content.includes(':')) {
    const after = content.slice(2);
    const [key, ...rest] = after.split(': ');
    return (
      <>
        {indent}<span className={PUNCT}>- </span>
        <span className={KEY}>{key}</span>
        <span className={PUNCT}>: </span>
        <span className={VAL}>{rest.join(': ')}</span>
      </>
    );
  }
  if (content.includes(': ')) {
    const [key, ...rest] = content.split(': ');
    return (
      <>
        {indent}<span className={KEY}>{key}</span>
        <span className={PUNCT}>: </span>
        <span className={VAL}>{rest.join(': ')}</span>
      </>
    );
  }
  if (content.endsWith(':')) {
    return (
      <>
        {indent}<span className={KEY}>{content.slice(0, -1)}</span>
        <span className={PUNCT}>:</span>
      </>
    );
  }
  return <>{raw}</>;
};

const PlayPill: React.FC = () => (
  <div className="flex items-center gap-0.5 bg-white rounded shadow px-1 py-0.5 border border-gray-200">
    <svg viewBox="0 0 16 16" className="w-3 h-3 fill-emerald-500">
      <path d="M4 2l10 6-10 6z" />
    </svg>
    <svg viewBox="0 0 16 16" className="w-3 h-3 fill-gray-400">
      <circle cx="4" cy="8" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="12" cy="8" r="1.2" />
    </svg>
  </div>
);

const EditorMockup: React.FC = () => (
  <div className="rounded-lg border border-slide-border bg-[#F5F7FA] overflow-hidden text-[11px] leading-[1.7]" style={{ fontFamily: "'Roboto Mono', monospace" }}>
    {/* Editor chrome */}
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 border-b border-slide-border">
      <span className="w-2 h-2 rounded-full bg-red-400" />
      <span className="w-2 h-2 rounded-full bg-yellow-400" />
      <span className="w-2 h-2 rounded-full bg-green-400" />
      <span className="ml-2 text-[10px] text-slide-muted font-sans">workflow.yml</span>
    </div>
    {/* Lines */}
    <div className="relative p-2" style={{ whiteSpace: 'pre' }}>
      {editorLines.map((line) => (
        <div key={line.num} className="flex items-center relative">
          <span className="w-6 text-right text-gray-400 mr-3 select-none text-[10px] shrink-0">
            {line.num}
          </span>
          <span className="flex-1">{highlightYamlLine(line.raw)}</span>
          {line.triggerStart && (
            <span className="absolute right-2 top-0.5">
              <PlayPill />
            </span>
          )}
        </div>
      ))}
    </div>
  </div>
);

export const EditorUx: React.FC = () => (
  <ContentSlide title="Editor UX for Test Runs">
    <TwoColumns
      gap="gap-8"
      left={
        <>
          <h3 className="text-slide-h3 text-slide-text mb-2">
            Test button &rarr; trigger selector modal
          </h3>
          <ModalMockup />
          <p className="text-slide-sm text-slide-muted mt-2">
            Reuses existing <code className="text-elastic-blue">WorkflowExecuteModal</code> pattern: radio-card
            trigger selection &rarr; trigger-specific form &rarr; Run.
            Creates execution with <code className="text-elastic-blue">isTestRun: true</code>.
          </p>
        </>
      }
      right={
        <>
          <h3 className="text-slide-h3 text-slide-text mb-2">
            Per-trigger <span className="text-emerald-600">&#9654;</span> play button
          </h3>
          <EditorMockup />
          <p className="text-slide-sm text-slide-muted mt-2">
            Same floating pill as existing per-step <code className="text-elastic-blue">RunStepButton</code>:
            green play icon + context menu, positioned at each trigger block.
            Skips trigger selection — runs that trigger directly.
          </p>
        </>
      }
    />
  </ContentSlide>
);
