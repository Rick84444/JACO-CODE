import React from 'react';

// Operator-chosen JACO IDE logo ("Build with intelligence"), public/branding/jaco-logo.png.
export const JacoWordmark: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const height = size === 'sm' ? 'h-7' : size === 'lg' ? 'h-24' : 'h-9';
  return (
    <img
      src="/branding/jaco-logo.png"
      alt="JACO IDE - Build with intelligence"
      className={`${height} w-auto object-contain shrink-0 select-none drop-shadow-[0_0_10px_rgba(56,189,248,.35)]`}
      draggable={false}
    />
  );
};
