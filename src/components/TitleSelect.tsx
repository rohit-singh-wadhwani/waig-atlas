import React from 'react';
import Icon from './Icon';

/** A heading that is also a dropdown: shows the current choice as the card title, click to switch. */
export default function TitleSelect({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <label className="relative inline-flex items-center gap-1.5 rounded-lg -ml-2 pl-2 pr-1 py-0.5 hover:bg-gray-100 focus-within:ring-2 focus-within:ring-brand-200 cursor-pointer">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="appearance-none bg-transparent pr-6 text-xl font-semibold text-gray-900 cursor-pointer focus:outline-none">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevronDown" size={18} className="pointer-events-none absolute right-2 text-gray-500" />
    </label>
  );
}
