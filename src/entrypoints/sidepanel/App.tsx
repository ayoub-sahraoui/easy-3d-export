import { lazy, Suspense } from 'react';
import { Download, FileUp, Loader2, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Header } from '@/components/layout/Header';
import { ModelCard } from '@/components/models/ModelCard';
import { MultiModelPicker } from '@/components/models/MultiModelPicker';
import { ConversionControls } from '@/components/conversion/ConversionControls';
import { ProgressPanel } from '@/components/conversion/ProgressPanel';
import { DownloadActions } from '@/components/downloads/DownloadActions';
import { ManualImportDialog } from '@/components/import/ManualImportDialog';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { PluginDisabledView, ProcessingView, UnsupportedSiteView, WaitingView } from '@/components/states/StateViews';
import { useBackgroundSync } from '@/hooks/use-background-sync';
import { useConversionActions } from '@/features/conversion/use-conversion-actions';
import { pluginRegistry } from '@/plugins/registry';
import { selectCurrentModel, usePanelStore } from '@/stores/panel-store';

const ModelPreview = lazy(() => import('@/components/preview/ModelPreview').then((module) => ({ default: module.ModelPreview })));

export default function App() {
  useBackgroundSync();
  const actions = useConversionActions();

  const detectionStatus = usePanelStore((s) => s.detectionStatus);
  const observing = usePanelStore((s) => s.observing);
  const models = usePanelStore((s) => s.models);
  const manualModels = usePanelStore((s) => s.manualModels);
  const localImport = usePanelStore((s) => s.localImport);
  const selectedModelId = usePanelStore((s) => s.selectedModelId);
  const selectedVariantId = usePanelStore((s) => s.selectedVariantId);
  const job = usePanelStore((s) => s.job);
  const format = usePanelStore((s) => s.format);
  const setImportDialogOpen = usePanelStore((s) => s.setImportDialogOpen);
  const selectModel = usePanelStore((s) => s.selectModel);
  const selectVariant = usePanelStore((s) => s.selectVariant);
  const providerId = usePanelStore((s) => s.providerId);

  const model = selectCurrentModel(usePanelStore.getState());
  const provider = pluginRegistry.get(model?.provider ?? providerId);
  const variant =
    model?.variants.find((v) => v.id === selectedVariantId) ??
    (model && provider ? provider.preferVariant(model) : undefined) ??
    model?.variants[0];
  const busy = !!job && !['done', 'error', 'cancelled'].includes(job.stage);
  const processing =
    !!variant &&
    (variant.status === 'processing' || variant.status === 'pending') &&
    !variant.assets.some((a) => a.kind === 'model' && a.url);
  const allPool = [...models, ...manualModels];

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      <Header />
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto flex w-full max-w-lg flex-col gap-6 p-4">
          {model && (
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Selected model</h2>
              <Button variant="ghost" size="sm" onClick={() => setImportDialogOpen(true)} disabled={busy}>
                <FileUp /> Import
              </Button>
            </div>
          )}
          {allPool.length > 1 && !localImport && (
            <MultiModelPicker models={allPool} selectedId={model?.id} onSelect={selectModel} />
          )}

          {detectionStatus === 'unsupported-site' && !localImport && manualModels.length === 0 && (
            <UnsupportedSiteView />
          )}

          {detectionStatus === 'plugin-disabled' && !localImport && manualModels.length === 0 && (
            <PluginDisabledView name={provider?.displayName ?? 'This provider'} />
          )}

          {(detectionStatus === 'supported-idle' || detectionStatus === 'observing' || detectionStatus === 'unknown') &&
            !localImport &&
            manualModels.length === 0 && <WaitingView observing={observing} />}

          {model && (
            <>
              {processing && (
                <ProcessingView note={`${provider?.displayName ?? 'The provider'} is still generating this model — it will appear here when the task completes.`} />
              )}
              <ModelCard model={model} selectedVariantId={variant?.id} onVariantChange={selectVariant} />
              <ConversionControls onDownloadAll={() => void actions.downloadAll()} busy={busy || processing} />
              <ProgressPanel onCancel={() => actions.cancel()} onGrantAccess={(origin) => void actions.grantAccessAndRetry(origin)} />
              <Suspense fallback={<p className="text-xs text-muted-foreground">Loading preview controls…</p>}>
                <ModelPreview />
              </Suspense>
              <DownloadActions
                onOriginal={() => void actions.downloadOriginal()}
                onTexture={() => void actions.downloadTextures()}
                textureCount={variant?.textures.length ?? localImport?.textures.length ?? 0}
                disabled={busy || processing}
              />
            </>
          )}

          {!model && detectionStatus === 'detected' && (
            <WaitingView observing={observing} />
          )}

          {(localImport || manualModels.length > 0) && (
            <Button variant="ghost" size="sm" className="self-start text-muted-foreground" disabled={busy} onClick={() => usePanelStore.getState().clearManual()}>
              <X />
              Clear manual import
            </Button>
          )}
        </main>
      </ScrollArea>

      <ManualImportDialog />
      <SettingsDialog />
      <footer className="shrink-0 border-t bg-background px-4 py-3">
        {model && (
          <Button onClick={() => void actions.start()} disabled={busy || processing} size="lg" className="mb-3 w-full">
            {busy ? <Loader2 className="animate-spin" /> : <Download />}
            {busy ? 'Preparing your export…' : format === 'original' ? 'Download original' : `Export ${format.toUpperCase()}`}
          </Button>
        )}
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
          Local processing · No API key required
        </p>
      </footer>
    </div>
  );
}
