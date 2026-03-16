import React from 'react';

interface BulletListProps {
  items: React.ReactNode[];
  className?: string;
}

export const BulletList: React.FC<BulletListProps> = ({ items, className = '' }) => (
  <ul className={`space-y-1 ${className}`}>
    {items.map((item, i) => (
      <li key={i} className="text-slide-body text-slide-secondary pl-6 relative">
        <span className="absolute left-0 top-[10px] w-2 h-2 rounded-full border-2 border-elastic-blue" />
        {item}
      </li>
    ))}
  </ul>
);
