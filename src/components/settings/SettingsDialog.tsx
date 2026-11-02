import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { pluginRegistry } from '@/plugins/registry';
import { readPluginPreferences, setPluginEnabled, watchPluginPreferences } from '@/plugins/preferences';
import { usePanelStore } from '@/stores/panel-store';
import { useThemeStore } from '@/stores/theme-store';

export function SettingsDialog() {
  const open = usePanelStore((s) => s.settingsOpen);
  const setOpen = usePanelStore((s) => s.setSettingsOpen);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Make the panel yours. Your models stay local.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="theme-select">Appearance</Label>
          <Select value={theme} onValueChange={(value) => setTheme(value as typeof theme)}>
            <SelectTrigger id="theme-select" className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Separator />
        <PluginSettings />
        <Separator />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Easy 3D Export is not affiliated with Meshy AI or Hyper3D. The decoder uses MIT-licensed{' '}
          <a className="underline underline-offset-4" href="https://github.com/Amal-David/meshy2glb" target="_blank" rel="noreferrer">meshy2glb</a>{' '}research by Amal David and{' '}
          <a className="underline underline-offset-4" href="https://github.com/zeux/meshoptimizer" target="_blank" rel="noreferrer">meshoptimizer</a>. Draco decoding uses{' '}
          <a className="underline underline-offset-4" href="https://github.com/google/draco" target="_blank" rel="noreferrer">Google Draco</a>{' '}(Apache 2.0).
          Only export models you own or have permission to use.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function PluginSettings() {
  const [preferences, setPreferences] = useState<Record<string, boolean>>();
  const [savingId, setSavingId] = useState<string>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false;
    let version = 0;
    const refresh = async () => {
      const requestVersion = ++version;
      try {
        const next = await readPluginPreferences();
        if (!stopped && requestVersion === version) { setPreferences(next); setError(undefined); }
      } catch {
        if (!stopped && requestVersion === version) setError('Could not load plugin settings. Try again.');
      }
    };
    const unwatch = watchPluginPreferences(() => void refresh());
    void refresh();
    return () => { stopped = true; unwatch(); };
  }, [retry]);

  const toggle = async (id: string, enabled: boolean) => {
    setSavingId(id);
    setError(undefined);
    try {
      await setPluginEnabled(id, enabled);
      setPreferences((current) => ({ ...current, [id]: enabled }));
    } catch { setError('Could not save this change. Try again.'); }
    finally { setSavingId(undefined); }
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="plugins-heading" aria-busy={!!savingId || !preferences}>
      <div>
        <h3 id="plugins-heading" className="text-sm font-semibold">Provider plugins</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Choose which sites can detect and import models. Changes save automatically.</p>
      </div>
      <div className="divide-y">
        {pluginRegistry.all().map((plugin) => (
          <div key={plugin.id} className="flex min-h-11 items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <Label htmlFor={`plugin-${plugin.id}`} className="cursor-pointer leading-snug">{plugin.displayName}</Label>
              <p id={`plugin-${plugin.id}-description`} className="mt-1 text-xs leading-relaxed text-muted-foreground">{plugin.description}</p>
            </div>
            <Switch id={`plugin-${plugin.id}`} checked={preferences?.[plugin.id] ?? false}
              aria-describedby={`plugin-${plugin.id}-description`} disabled={!preferences || !!savingId}
              className="relative before:absolute before:-inset-y-3 before:-inset-x-1"
              onCheckedChange={(enabled) => void toggle(plugin.id, enabled)} />
          </div>
        ))}
      </div>
      {!preferences && !error && <p role="status" className="text-xs text-muted-foreground">Loading plugin settings…</p>}
      {error && <div role="alert" className="flex items-center justify-between gap-3 text-sm text-destructive">
        <p>{error}</p><Button size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry</Button>
      </div>}
      <p className="text-xs leading-relaxed text-muted-foreground">Local file conversion is always available.</p>
    </section>
  );
}
