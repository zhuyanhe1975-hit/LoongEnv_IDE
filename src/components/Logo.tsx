import React, { useState } from 'react';

interface LogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ className = '', size = 'md', showText = true }) => {
  const [imgError, setImgError] = useState(false);

  const sizeClasses = {
    sm: 'w-16 h-16',
    md: 'w-20 h-20',
    lg: 'w-32 h-32'
  };

  const textClasses = {
    sm: 'text-4xl',
    md: 'text-5xl',
    lg: 'text-7xl'
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {!imgError ? (
        <div className={`relative ${sizeClasses[size]} flex-shrink-0`}>
          {/* Glow effect behind the logo */}
          <div className="absolute inset-0 bg-loong-accent/30 blur-md rounded-full animate-pulse" />
          <img 
            src="/logo.png" 
            alt="LoongEnv Logo" 
            className="relative z-10 w-full h-full object-contain drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]"
            onError={() => setImgError(true)}
          />
        </div>
      ) : (
        <div className={`${sizeClasses[size]} ${textClasses[size]} bg-loong-red rounded-lg flex items-center justify-center font-display font-bold text-white flex-shrink-0`}>
          L
        </div>
      )}
      {showText && (
        <span className={`font-display font-bold ${textClasses[size]} tracking-tighter text-[var(--text-main)]`}>
          LoongEnv
        </span>
      )}
    </div>
  );
};
