import { useEffect, useState } from 'react';
import { Box } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/models/StatusBadge';
import { formatCount } from '@/lib/utils';
import type { NormalizedModel } from '@/core/models/types';
import { pluginRegistry } from '@/plugins/registry';

function PreviewThumb({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className="flex h-40 items-center justify-center overflow-hidden border-b bg-muted/40">
      {src && !failed ? (
        <img src={src} alt={`Preview of ${name}`} width={320} height={160} className="h-full w-full object-contain" onError={() => setFailed(true)} loading="lazy" />
      ) : (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Box className="size-8 stroke-1" aria-hidden="true" />
          <span className="text-xs">No preview available</span>
        </div>
      )}
    </div>
  );
}

export function ModelCard({
  model, selectedVariantId, onVariantChange,
}: {
  model: NormalizedModel;
  selectedVariantId?: string;
  onVariantChange: (id: string) => void;
}) {
  const provider = pluginRegistry.get(model.provider);
  const variant = model.variants.find((v) => v.id === selectedVariantId) ??
    provider?.preferVariant(model) ?? model.variants[0];
  const previewUrl = variant?.assets.find((a) => a.kind === 'preview')?.url ?? model.previewUrl;
  const textureCount = variant?.textures.length ?? 0;
  const expired = variant?.assets.some((a) => a.kind === 'model' && a.expiresAt !== undefined && a.expiresAt < Date.now()) ?? false;
  const local = model.provenance?.source === 'local-file';
  const source = local ? 'Local file' : provider?.displayName ?? model.provider;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <PreviewThumb src={previewUrl} name={model.name} />
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="line-clamp-2 break-words text-base font-semibold leading-snug tracking-tight" title={model.name}>{model.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {source}
              {model.provenance?.source === 'network-response' && ' · Detected on this page'}
              {model.provenance?.source === 'manual-json' && ' · Imported'}
            </p>
          </div>
          <StatusBadge status={variant?.status ?? model.status} />
        </div>
        <dl className="grid grid-cols-3 divide-x border-y py-3">
          <Stat label="Triangles" value={formatCount(variant?.triangles ?? model.geometry?.triangles)} />
          <Stat label="Vertices" value={formatCount(variant?.vertices ?? model.geometry?.vertices)} />
          <Stat label="Textures" value={String(textureCount)} />
        </dl>
        {variant?.assets.some((asset) => asset.kind === 'model' && asset.format === 'drc') && (
          <p className="text-xs leading-relaxed text-muted-foreground">{model.provider === 'rodin' ? 'Preview geometry only. ' : ''}This Draco source does not include materials or textures.</p>
        )}
        {model.variants.length > 1 && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="model-variant">Variant</Label>
            <Select value={variant?.id} onValueChange={onVariantChange}>
              <SelectTrigger id="model-variant" className="w-full"><SelectValue placeholder="Select a variant" /></SelectTrigger>
              <SelectContent>
                {model.variants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.label}{v.status !== 'succeeded' ? ` · ${v.status}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {expired && <p role="status" className="text-sm leading-relaxed text-destructive">This download link has expired. Refresh the provider page to get a new link.</p>}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 px-2">
      <dt className="order-2 text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
