import React from 'react';

interface Option<T> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T> {
  options: Option<T>[];
  active: T;
  onChange: (value: T) => void;
  getActiveClassName?: (value: T) => string;
}

export default function SegmentedControl<T extends string>({
  options,
  active,
  onChange,
  getActiveClassName
}: SegmentedControlProps<T>) {
  const defaultActiveClassName = 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100';
  
  return (
    <div className="bg-slate-100 p-1 rounded-lg flex space-x-1 border border-slate-200/50 dark:bg-slate-900 dark:border-slate-800">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`px-3 py-1 text-xs font-medium rounded-md font-sans transition-all ${
            active === option.value
              ? getActiveClassName ? getActiveClassName(option.value) : defaultActiveClassName
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
