import { FileArchive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ExportFormat } from '@/core/models/types';
import { selectCurrentModel, usePanelStore } from '@/stores/panel-store';
import { pluginRegistry } from '@/plugins/registry';

const FORMAT_LABELS: Record<ExportFormat, string> = { original: 'Original', glb: 'GLB', obj: 'OBJ' };
const FORMAT_HINTS: Record<ExportFormat, string> = {
  original: 'Save the source file without converting it.',
  glb: 'A single 3D file, ready for Blender and other 3D apps.',
  obj: 'A ZIP with geometry, materials, and available textures.',
};

export function ConversionControls({ onDownloadAll, busy }: {
  onDownloadAll: () => void;
  busy: boolean;
}) {
  const state = usePanelStore();
  const { format, setFormat, includeTextures, setIncludeTextures, providerId, localImport, selectedVariantId } = state;
  const model = selectCurrentModel(state);
  const provider = pluginRegistry.get(model?.provider ?? providerId);
  const available: ExportFormat[] = localImport ? ['original', 'glb', 'obj'] :
    provider?.capabilities.supportedExports.filter((value) => value !== 'original' || provider.capabilities.originalDownload) ?? ['glb'];
  const variant = model?.variants.find((v) => v.id === selectedVariantId) ?? (model && provider?.preferVariant(model)) ?? model?.variants[0];
  const hasTextures = (variant?.textures.length ?? 0) > 0 || (localImport?.textures.length ?? 0) > 0;
  const isOriginal = format === 'original';

  return (
    <section aria-labelledby="export-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="export-heading" className="text-sm font-semibold">Export model</h2>
        <p className="mt-1 text-xs text-muted-foreground">Choose the format that fits your workflow.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Tabs value={format} onValueChange={(value) => setFormat(value as ExportFormat)}>
          <TabsList className="w-full" aria-label="Export format">
            {available.map((value) => <TabsTrigger key={value} value={value} disabled={busy}>{FORMAT_LABELS[value]}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <p className="text-xs leading-relaxed text-muted-foreground">{format === 'glb' && variant?.assets.some((asset) => asset.kind === 'model' && asset.format === 'drc') ? 'Uncompressed GLB geometry, ready to edit in Blender.' : FORMAT_HINTS[format]}</p>
      </div>
      {!isOriginal && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="include-textures">Include textures</Label>
            <p id="texture-hint" className="text-xs text-muted-foreground">{hasTextures ? 'Keep the model’s available texture maps.' : 'No texture maps available for this model.'}</p>
          </div>
          <Switch id="include-textures" aria-describedby="texture-hint" checked={includeTextures} onCheckedChange={setIncludeTextures} disabled={!hasTextures || busy} />
        </div>
      )}
      <Button onClick={onDownloadAll} disabled={busy} variant="outline" className="w-full">
        <FileArchive /> Download all formats (ZIP)
      </Button>
    </section>
  );
}
