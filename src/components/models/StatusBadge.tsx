import type { ModelStatus } from '@/core/models/types';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react';

const CONFIG: Record<ModelStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary'; icon: typeof CheckCircle2 }> = {
  succeeded: { label: 'Ready', variant: 'success', icon: CheckCircle2 },
  processing: { label: 'Processing', variant: 'warning', icon: Loader2 },
  pending: { label: 'Queued', variant: 'secondary', icon: CircleDashed },
  failed: { label: 'Failed', variant: 'destructive', icon: XCircle },
  unknown: { label: 'Unknown', variant: 'secondary', icon: CircleDashed },
};

export function StatusBadge({ status }: { status: ModelStatus }) {
  const config = CONFIG[status]!;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className={`size-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
      {config.label}
    </Badge>
  );
}
