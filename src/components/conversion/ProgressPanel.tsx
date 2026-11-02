import { AlertTriangle, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { ConversionStage } from '@/core/models/types';
import { usePanelStore } from '@/stores/panel-store';

const STAGES: { key: ConversionStage; label: string }[] = [
  { key: 'downloading', label: 'Downloading asset' },
  { key: 'decoding', label: 'Decoding model' },
  { key: 'decompressing', label: 'Decompressing geometry' },
  { key: 'exporting', label: 'Exporting' },
  { key: 'saving', label: 'Verifying & saving' },
];

export function ProgressPanel({
  onCancel,
  onGrantAccess,
}: {
  onCancel?: () => void;
  onGrantAccess?: (origin: string) => void;
}) {
  const job = usePanelStore((s) => s.job);
  const warnings = usePanelStore((s) => s.jobWarnings);
  if (!job) return null;

  const needsPermission = job.error?.code === 'CORS_OR_PERMISSION_DENIED' && !!job.error.origin;

  const order = STAGES.map((s) => s.key);
  const currentIdx = order.indexOf(job.stage);
  const failed = job.stage === 'error';
  const cancelled = job.stage === 'cancelled';
  const done = job.stage === 'done';

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 break-words text-sm font-medium">
          {done ? `Saved ${job.resultFilename}` : cancelled ? 'Export cancelled' : failed ? 'Export failed' : 'Preparing your export…'}
        </span>
        {!done && !failed && !cancelled && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onCancel}>
            <X className="size-3" /> Cancel
          </Button>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {STAGES.map((stage, i) => {
          const state = done || i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending';
          return (
            <li key={stage.key} className="flex min-w-0 items-start gap-2 text-sm">
              {state === 'done' && <Check className="size-3.5 text-emerald-500" />}
              {state === 'active' && !failed && !cancelled && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
              {state === 'active' && (failed || cancelled) && <X className="size-3.5 text-destructive" />}
              {state === 'pending' && <span className="inline-block size-3.5 rounded-full border border-dashed" />}
              <span className={cn(state === 'active' ? 'font-medium' : 'text-muted-foreground')}>
                {stage.label}
              </span>
              {state === 'active' && job.stageDetail && (
                <span className="truncate text-xs text-muted-foreground">{job.stageDetail}</span>
              )}
            </li>
          );
        })}
      </ul>

      {job.stage === 'downloading' && job.progress !== undefined && (
        <Progress value={job.progress} />
      )}

      {failed && job.error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{needsPermission ? 'Site access needed' : 'Could not export this model'}</AlertTitle>
          <AlertDescription>
            {job.error.message}
            {needsPermission && onGrantAccess && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 h-auto min-h-9 whitespace-normal text-left"
                onClick={() => onGrantAccess(job.error!.origin!)}
              >
                <ShieldCheck className="size-3" />
                Grant access to {new URL(job.error.origin!).hostname} and retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {done && warnings.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Completed with notes</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.slice(0, 4).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
