/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import DatePicker from './DatePicker';
import TimePicker from './TimePicker';

interface DateTimePickerProps {
  /** "yyyy-MM-ddThh:mm", matching a native <input type="datetime-local"> value. Empty = unset. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}

/** DatePicker (custom calendar) + TimePicker (custom hour/minute dropdown) side by side. */
export default function DateTimePicker({ value, onChange, required = false, className = '' }: DateTimePickerProps) {
  const [datePart = '', timePart = '00:00'] = value.split('T');

  const handleDateChange = (d: string) => onChange(d ? `${d}T${timePart}` : '');
  const handleTimeChange = (t: string) => onChange(datePart ? `${datePart}T${t}` : '');

  return (
    <div className={`flex gap-2 ${className}`.trim()}>
      <DatePicker value={datePart} onChange={handleDateChange} required={required} />
      <TimePicker value={timePart} onChange={handleTimeChange} required={required} className="w-24" />
    </div>
  );
}
