import React, { useState } from 'react';

// Preserve the chosen brand asset, with a legible identity if it cannot decode.
export const JacoWordmark: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`jaco-wordmark jaco-wordmark-${size}`} aria-label="JACO CODE - Aura">JACO</span>;
  const height = size === 'sm' ? 'h-7' : size === 'lg' ? 'h-24' : 'h-9';
  return <img src="/branding/jaco-logo.png" alt="JACO CODE - Aura"
    className={`${height} w-auto object-contain shrink-0 select-none`}
    draggable={false} onError={()=>setFailed(true)}/>;
};
