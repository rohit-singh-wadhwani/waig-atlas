import React, { useEffect } from 'react';
import Icon, { IconName } from './Icon';
import { initials } from '../lib/format';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Card({ children, className = '', pad = true }: { children: React.ReactNode; className?: string; pad?: boolean }) {
  return <div className={cx('bg-white border border-gray-200 rounded-2xl shadow-card', pad && 'p-6', className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, right }: { title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-[160px] flex-1">
        <h3 className="text-[17px] font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2 shrink-0 max-w-full min-w-0">{right}</div>}
    </div>
  );
}

const TINTS: Record<string, string> = {
  teal: 'bg-brand-50 text-brand-600',
  purple: 'bg-purple-50 text-purple-600',
  orange: 'bg-orange-50 text-orange-600',
  green: 'bg-green-50 text-green-600',
  gray: 'bg-gray-100 text-gray-700',
  red: 'bg-red-50 text-red-600',
  blue: 'bg-blue-50 text-blue-600',
};

export function KpiCard({ icon, tint = 'teal', label, value, foot, onClick }: { icon: IconName; tint?: keyof typeof TINTS | string; label: string; value: React.ReactNode; foot?: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('text-left bg-white border border-gray-200 rounded-2xl shadow-card p-5 flex flex-col min-h-[172px] w-full', onClick ? 'hover:border-brand-300 transition-colors' : 'cursor-default')}
    >
      <span className={cx('w-11 h-11 rounded-xl flex items-center justify-center', TINTS[tint] || TINTS.teal)}>
        <Icon name={icon} size={22} />
      </span>
      <span className="text-[15px] text-gray-600 mt-4 leading-snug">{label}</span>
      <span className="text-[28px] font-semibold text-gray-900 mt-2 leading-none tabular-nums">{value}</span>
      {foot && <span className="text-sm text-gray-500 mt-auto pt-3">{foot}</span>}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex items-center bg-gray-100/80 border border-gray-200 rounded-xl p-1 gap-0.5 max-w-full overflow-x-auto">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-lg transition-colors whitespace-nowrap',
            size === 'sm' ? 'px-3 py-1 text-sm' : 'px-4 py-1.5 text-[15px]',
            value === o.value ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-800'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder, className = '' }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none w-full bg-white border border-gray-200 rounded-xl pl-4 pr-10 h-11 text-[15px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-200"
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('bg-white border border-gray-200 rounded-xl px-4 h-11 text-[15px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-200 placeholder:text-gray-400', props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('bg-white border border-gray-200 rounded-xl px-4 py-3 text-[15px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-200 placeholder:text-gray-400 w-full', props.className)} />;
}

export function Button({ children, variant = 'secondary', icon, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName }) {
  const v = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 border border-brand-600',
    secondary: 'bg-white text-gray-800 border border-gray-200 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:bg-gray-100 border border-transparent',
    danger: 'bg-white text-red-600 border border-gray-200 hover:bg-red-50',
  }[variant];
  return (
    <button type="button" {...rest} className={cx('inline-flex items-center justify-center gap-2 rounded-xl px-4 h-10 text-sm font-medium transition-colors disabled:opacity-50', v, className)}>
      {icon && <Icon name={icon} size={17} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, title, onClick, active }: { icon: IconName; title: string; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={cx('w-9 h-9 inline-flex items-center justify-center rounded-lg border', active ? 'bg-brand-50 border-brand-200 text-brand-700' : 'border-transparent text-gray-500 hover:bg-gray-100')}>
      <Icon name={icon} size={19} />
    </button>
  );
}

export function Badge({ children, className = 'bg-brand-50 text-brand-700' }: { children: React.ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[13px] font-medium whitespace-nowrap', className)}>{children}</span>;
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span className="rounded-full bg-brand-500 text-white inline-flex items-center justify-center font-semibold shrink-0" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initials(name)}
    </span>
  );
}

export function Progress({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={cx('h-3 rounded-full bg-brand-100 overflow-hidden', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Empty({ icon = 'database', title, children }: { icon?: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 text-gray-500">
      <span className="w-12 h-12 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center mb-3">
        <Icon name={icon} size={22} />
      </span>
      <p className="font-medium text-gray-800">{title}</p>
      {children && <div className="text-sm mt-1 max-w-md">{children}</div>}
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, width = 720 }: { open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/20" onClick={onClose} />
      <aside className="relative bg-gray-50 h-full overflow-y-auto shadow-2xl border-l border-gray-200 w-full" style={{ maxWidth: width }}>
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-gray-900 leading-snug">{title}</h2>
            {subtitle && <div className="text-sm text-gray-500 mt-1">{subtitle}</div>}
          </div>
          <IconButton icon="x" title="Close" onClick={onClose} />
        </div>
        <div className="p-6 space-y-5">{children}</div>
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-5">
          <h3 className="text-lg font-semibold">{title}</h3>
          <IconButton icon="x" title="Close" onClick={onClose} />
        </div>
        <div className="px-6 py-4 space-y-3 overflow-y-auto min-h-0">{children}</div>
        {footer && <div className="px-6 pb-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] font-medium tracking-wider uppercase text-gray-500">{children}</div>;
}

export function ExtLink({ href, children, className = '' }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cx('text-brand-700 hover:underline inline-flex items-center gap-1 max-w-full break-words', className)}>
      {children}
      <Icon name="external" size={13} />
    </a>
  );
}
