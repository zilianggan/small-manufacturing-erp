import React from 'react';
import { Settings, Cog, Cpu } from 'lucide-react';

interface LoadingSpinnerProps {
  message?: string;
  subtitle?: string;
  fullPage?: boolean;
}

export default function LoadingSpinner({
  message = 'Loading production data...',
  subtitle = 'SYSTEM_PROCESSING',
  fullPage = false
}: LoadingSpinnerProps) {
  const content = (
    <div className="bg-white/80 dark:bg-slate-900/60 backdrop-blur-md border border-slate-200/50 dark:border-slate-800/40 rounded-2xl shadow-xl p-8 max-w-sm w-full mx-4 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in-95 duration-300">
      {/* Premium Gear Mesh Animation */}
      <div className="relative w-24 h-24 flex items-center justify-center mb-4">
        {/* Big Gear (Clockwise, Slow) */}
        <div className="absolute text-indigo-500/80 dark:text-indigo-400/80 animate-spin-slow">
          <Settings size={56} strokeWidth={1.5} />
        </div>

        {/* Small Gear (Counter-Clockwise, Fast) */}
        <div className="absolute top-1.5 right-1.5 text-amber-500/80 dark:text-amber-400/80 animate-spin-reverse">
          <Cog size={32} strokeWidth={1.5} />
        </div>

        {/* Pulsing Core CPU */}
        <div className="absolute text-slate-900 dark:text-slate-100 animate-pulse-glow bg-white dark:bg-slate-900 rounded-full p-2 border border-slate-200/50 dark:border-slate-800/80 shadow-md">
          <Cpu size={16} className="text-indigo-500 dark:text-indigo-400" />
        </div>
      </div>

      {/* Loading Messages */}
      <h3 className="font-sans font-semibold text-slate-800 dark:text-slate-100 text-sm tracking-wide">
        {message}
      </h3>

      <div className="mt-2 flex items-center space-x-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="font-mono text-[9px] text-slate-400 dark:text-slate-500 tracking-wider uppercase font-semibold">
          {subtitle}
        </span>
      </div>
    </div>
  );

  if (fullPage) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm">
        {content}
      </div>
    );
  }

  return (
    <div className="w-full min-h-[350px] flex items-center justify-center p-4">
      {content}
    </div>
  );
}
