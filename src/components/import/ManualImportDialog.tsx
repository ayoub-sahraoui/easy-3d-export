import { useRef, useState } from 'react';
import { ClipboardPaste, FileUp, Link2, Loader2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { importFromUrl, importJsonText, importLocalFiles } from '@/features/import/manual-import';
import { usePanelStore } from '@/stores/panel-store';
import { cn } from '@/lib/utils';

export function ManualImportDialog() {
  const open = usePanelStore((s) => s.importDialogOpen);
  const setOpen = usePanelStore((s) => s.setImportDialogOpen);
  const [json, setJson] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const close = () => { setOpen(false); setJson(''); setUrl(''); setError(''); setDragOver(false); };
  const runImport = async (load: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try { await load(); toast.success('Model imported'); close(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import this model. Try another file or URL.'); }
    finally { setBusy(false); }
  };
  const handleFiles = (files: File[]) => {
    if (files.length && !busy) void runImport(() => importLocalFiles(files));
  };

  return (
    <Dialog open={open} onOpenChange={(value) => value ? setOpen(true) : close()}>
      <DialogContent aria-busy={busy}>
        <DialogHeader>
          <DialogTitle>Import a model</DialogTitle>
          <DialogDescription>Choose a local file, paste a model link, or use a provider JSON response.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="files" onValueChange={() => setError('')} className="gap-4">
          <TabsList className="w-full" aria-label="Import method">
            <TabsTrigger value="files" disabled={busy}><FileUp /> Files</TabsTrigger>
            <TabsTrigger value="url" disabled={busy}><Link2 /> URL</TabsTrigger>
            <TabsTrigger value="json" disabled={busy}><ClipboardPaste /> JSON</TabsTrigger>
          </TabsList>
          <TabsContent value="files" className="flex flex-col gap-3">
            <button type="button" disabled={busy}
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => { event.preventDefault(); if (!busy) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => { event.preventDefault(); setDragOver(false); handleFiles([...event.dataTransfer.files]); }}
              className={cn('flex w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center transition-colors hover:border-primary hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50', dragOver && 'border-primary bg-accent')}>
              {busy ? <Loader2 className="size-6 animate-spin text-primary" /> : <UploadCloud className="size-6 text-muted-foreground" />}
              <span className="text-sm font-medium">{busy ? 'Importing your model…' : 'Drop a model here'}</span>
              <span className="text-xs text-muted-foreground">.meshy, .glb, or .drc</span>
              <span className="text-sm font-medium text-primary underline underline-offset-4">or browse files</span>
            </button>
            <p className="text-xs leading-relaxed text-muted-foreground">Add PNG, JPG, or WebP texture maps alongside your model.</p>
            <input ref={fileInput} type="file" multiple tabIndex={-1} autoComplete="off" aria-label="Choose model and texture files"
              accept=".meshy,.glb,.drc,.png,.jpg,.jpeg,.webp" className="hidden"
              onChange={(event) => { handleFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
          </TabsContent>
          <TabsContent value="url">
            <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (!busy && url.trim()) void runImport(() => importFromUrl(url)); }}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="model-url">Model URL</Label>
                <Input id="model-url" type="url" autoComplete="url" spellCheck={false} autoCapitalize="none" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.meshy.ai/3d-models/…" disabled={busy} aria-invalid={!!error} aria-describedby={error ? 'url-hint import-error' : 'url-hint'} />
                <p id="url-hint" className="text-xs text-muted-foreground">A Meshy or Rodin model page, or a direct HTTPS model link.</p>
              </div>
              <Button type="submit" disabled={busy || !url.trim()}>{busy && <Loader2 className="animate-spin" />}{busy ? 'Importing…' : 'Import from URL'}</Button>
            </form>
          </TabsContent>
          <TabsContent value="json">
            <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (!busy && json.trim()) void runImport(() => importJsonText(json)); }}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="model-json">Provider response</Label>
                <Textarea id="model-json" autoComplete="off" spellCheck={false} value={json} onChange={(event) => setJson(event.target.value)} placeholder='{"code":"OK","result":{…}}' disabled={busy} aria-invalid={!!error} aria-describedby={error ? 'import-error' : undefined} className="min-h-40 resize-y font-mono text-xs" />
              </div>
              <Button type="submit" disabled={busy || !json.trim()}>{busy && <Loader2 className="animate-spin" />}{busy ? 'Importing…' : 'Import JSON'}</Button>
            </form>
          </TabsContent>
        </Tabs>
        {error && <Alert id="import-error" variant="destructive"><AlertDescription className="break-words">{error}</AlertDescription></Alert>}
        <p className="text-xs text-muted-foreground">Your files are processed locally in this browser.</p>
      </DialogContent>
    </Dialog>
  );
}
