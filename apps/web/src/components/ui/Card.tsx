import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PAD_CLS = {
  none: '',
  sm: 'p-3.5',
  md: 'p-5',
  lg: 'p-6 sm:p-7',
};

export const Card: React.FC<CardProps> = ({
  padding = 'md',
  className = '',
  children,
  ...rest
}) => (
  <div
    className={`bg-surface border border-line rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${PAD_CLS[padding]} ${className}`}
    {...rest}
  >
    {children}
  </div>
);
