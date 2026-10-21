import React from 'react';

// Operator-chosen JACO CODE logo ("Build with intelligence"), public/branding/jaco-logo.webp.
export const JacoWordmark: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const height = size === 'sm' ? 'h-7' : size === 'lg' ? 'h-24' : 'h-9';
  return (
    <img
      src="/branding/jaco-logo.webp"
      alt="JACO CODE - Aura"
      className={`${height} w-auto object-contain shrink-0 select-none drop-shadow-[0_0_10px_rgba(56,189,248,.35)]`}
      draggable={false}
    />
  );
};
