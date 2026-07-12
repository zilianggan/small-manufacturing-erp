import { cn } from '../../lib/utils';
import type { LucideIcon } from 'lucide-react';

interface ActionCardProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  className?: string;
  'data-fade-item'?: boolean;
}

/** Clickable quick-action tile (icon + label) — Dashboard's "Quick Actions" grid. */
export function ActionCard({ label, icon: Icon, onClick, className, ...rest }: ActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-primary/30 hover:shadow-md active:scale-[0.98]',
        className
      )}
      {...rest}
    >
      <div className="p-2 rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
        <Icon className="w-4 h-4" />
      </div>
      <span className="text-xs font-medium text-card-foreground">{label}</span>
    </button>
  );
}
