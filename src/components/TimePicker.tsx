/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { Clock, X } from 'lucide-react';

const pad = (n: number): string => String(n).padStart(2, '0');

type Mode = 'hour' | 'minute';

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 78;
const NUMERAL_RADIUS = RADIUS - 14;

// Angle from 12 o'clock, clockwise, in degrees [0, 360).
const angleFromCenter = (x: number, y: number): number => {
  const deg = (Math.atan2(x - CENTER, CENTER - y) * 180) / Math.PI;
  return (deg + 360) % 360;
};

const pointOnCircle = (angleDeg: number, radius: number) => {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + radius * Math.sin(rad), y: CENTER - radius * Math.cos(rad) };
};

interface TimePickerProps {
  /** "HH:mm", matching a native <input type="time"> value. Empty string = unset. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}

/**
 * Analog clock-face time picker (Material-style): tap/drag the hour dial, it advances to the minute
 * dial, tap/drag that closes it. 12-hour numeral ring + an AM/PM toggle rather than a 24-position
 * ring — reads clearer at this size. Minute angle is continuous (1-min resolution); only the 5-minute
 * marks are labelled, same as the reference design.
 */
export default function TimePicker({ value, onChange, required = false, className = '' }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('hour');
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);

  const [hh24 = 0, mm = 0] = value ? value.split(':').map(Number) : [0, 0];
  const isPM = hh24 >= 12;
  const hour12 = hh24 % 12 === 0 ? 12 : hh24 % 12;

  const commit = (nextHh24: number, nextMm: number) => onChange(`${pad(nextHh24)}:${pad(nextMm)}`);
  const setHour12 = (h12: number, pm: boolean) => commit((h12 % 12) + (pm ? 12 : 0), mm);
  const setMinute = (m: number) => commit(hh24, m);

  const openPicker = (next: boolean) => {
    setOpen(next);
    if (next) setMode('hour');
  };

  const valueFromPointer = (clientX: number, clientY: number): number => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = SIZE / rect.width;
    const angle = angleFromCenter((clientX - rect.left) * scale, (clientY - rect.top) * scale);
    if (mode === 'hour') {
      const h = Math.round(angle / 30) % 12;
      return h === 0 ? 12 : h;
    }
    return Math.round(angle / 6) % 60;
  };

  const applyPointer = (clientX: number, clientY: number, isFinal: boolean) => {
    const v = valueFromPointer(clientX, clientY);
    if (mode === 'hour') {
      setHour12(v, isPM);
      if (isFinal) setMode('minute');
    } else {
      setMinute(v);
      if (isFinal) setOpen(false);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyPointer(e.clientX, e.clientY, false);
  };
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingRef.current) applyPointer(e.clientX, e.clientY, false);
  };
  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    applyPointer(e.clientX, e.clientY, true);
  };

  const ringNumbers = mode === 'hour'
    ? Array.from({ length: 12 }, (_, i) => i + 1)
    : Array.from({ length: 12 }, (_, i) => i * 5);
  const handAngle = mode === 'hour' ? (hour12 % 12) * 30 : mm * 6;
  const handTip = pointOnCircle(handAngle, NUMERAL_RADIUS);

  const triggerBase = `
    w-full flex items-center justify-between gap-2
    px-3 py-2 text-xs rounded-lg border transition-colors
    focus:outline-none focus:border-blue-500
    bg-white border-slate-200 text-slate-800 cursor-pointer hover:border-slate-300
    dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600
  `.trim();

  const segmentClass = (active: boolean) => `
    px-2 py-1 rounded text-lg font-mono font-semibold transition-colors
    ${active ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}
  `;
  const meridiemClass = (active: boolean) => `
    px-1.5 py-0.5 text-[10px] font-semibold transition-colors
    ${active ? 'bg-blue-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}
  `;

  return (
    <RadixPopover.Root open={open} onOpenChange={openPicker}>
      <RadixPopover.Trigger asChild>
        <button type="button" className={`relative ${className} ${triggerBase}`}>
          <span className={`truncate flex-1 text-left ${!value ? 'text-slate-400 dark:text-slate-500' : ''}`}>
            {value || '--:--'}
          </span>
          {value && !required && (
            <X
              className="w-3 h-3 text-slate-400 hover:text-slate-600 shrink-0"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onChange(''); }}
            />
          )}
          <Clock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
        </button>
      </RadixPopover.Trigger>

      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[100] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden p-3 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 duration-100"
        >
          <div className="flex items-center justify-center gap-1 mb-3">
            <button type="button" onClick={() => setMode('hour')} className={segmentClass(mode === 'hour')}>
              {pad(hour12)}
            </button>
            <span className="text-lg font-mono text-slate-400">:</span>
            <button type="button" onClick={() => setMode('minute')} className={segmentClass(mode === 'minute')}>
              {pad(mm)}
            </button>
            <div className="flex flex-col ml-2 rounded overflow-hidden border border-slate-200 dark:border-slate-700">
              <button type="button" onClick={() => setHour12(hour12, false)} className={meridiemClass(!isPM)}>AM</button>
              <button type="button" onClick={() => setHour12(hour12, true)} className={meridiemClass(isPM)}>PM</button>
            </div>
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="w-[13.5rem] h-[13.5rem] touch-none select-none cursor-pointer"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <rect x={0} y={0} width={SIZE} height={SIZE} fill="transparent" />
            <circle cx={CENTER} cy={CENTER} r={RADIUS} className="fill-slate-50 dark:fill-slate-800" />
            <line x1={CENTER} y1={CENTER} x2={handTip.x} y2={handTip.y} className="stroke-blue-600" strokeWidth={2} />
            <circle cx={CENTER} cy={CENTER} r={3} className="fill-blue-600" />
            <circle cx={handTip.x} cy={handTip.y} r={14} className="fill-blue-600" opacity={0.15} />
            {ringNumbers.map(n => {
              const angle = mode === 'hour' ? (n % 12) * 30 : n * 6;
              const pos = pointOnCircle(angle, NUMERAL_RADIUS);
              const isSelected = mode === 'hour' ? n === hour12 : n === mm;
              return (
                <text
                  key={n}
                  x={pos.x}
                  y={pos.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={`text-[11px] font-mono pointer-events-none ${isSelected ? 'fill-white font-bold' : 'fill-slate-600 dark:fill-slate-300'}`}
                >
                  {mode === 'hour' ? n : pad(n)}
                </text>
              );
            })}
          </svg>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
