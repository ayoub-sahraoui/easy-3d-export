import { FileUp, Globe, Loader2, RefreshCw } from 'lucide-react';
import { browser } from 'wxt/browser';
import { Button } from '@/components/ui/button';
import { usePanelStore } from '@/stores/panel-store';
import { toast } from 'sonner';
import type { ReactNode } from 'react';

function EmptyState({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  const setImportDialogOpen = usePanelStore((s) => s.setImportDialogOpen);
  return (
    <section className="flex flex-col items-center px-2 py-8 text-center">
      <img src="/logo.png" alt="" width={64} height={64} className="mb-6 size-16" />
      <h2 className="text-xl font-semibold leading-snug tracking-tight">{title}</h2>
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
        <Button onClick={() => setImportDialogOpen(true)}><FileUp /> Import a model</Button>
        {children}
      </div>
      <div className="mt-8 flex items-start gap-2 border-t pt-6 text-left text-xs leading-relaxed text-muted-foreground">
        <Globe className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>Detect models on Meshy AI and Hyper3D Rodin. Local <span className="font-medium text-foreground">.meshy</span>, <span className="font-medium text-foreground">.glb</span>, and <span className="font-medium text-foreground">.drc</span> files work on any page.</p>
      </div>
    </section>
  );
}

export function UnsupportedSiteView() {
  return <EmptyState title="Bring your model along" description="Open a Meshy or Rodin model page, or import a file to export it as GLB or OBJ. Everything is processed in your browser." />;
}

export function PluginDisabledView({ name }: { name: string }) {
  return (
    <EmptyState title={`${name} is disabled`} description="Enable this provider plugin in Settings to detect models on this page.">
      <Button variant="outline" onClick={() => usePanelStore.getState().setSettingsOpen(true)}>Open settings</Button>
    </EmptyState>
  );
}

export function WaitingView({ observing }: { observing: boolean }) {
  const refreshPage = async () => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) await browser.tabs.reload(tab.id);
    } catch {
      toast.error('Could not refresh the page. Try refreshing it in your browser.');
    }
  };
  return (
    <EmptyState title={observing ? 'Watching for your model' : 'Ready for your model'} description={observing
      ? 'Open a model on Meshy AI or Rodin. Its available files will appear here automatically.'
      : 'Refresh the provider page to detect its models, or import a file to get started.'}>
      {!observing && <Button variant="outline" onClick={() => void refreshPage()}><RefreshCw /> Refresh page</Button>}
    </EmptyState>
  );
}

export function ProcessingView({ note }: { note: string }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden="true" />
      <span>{note}</span>
    </div>
  );
}
