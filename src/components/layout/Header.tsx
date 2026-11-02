import { Moon, Settings2, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePanelStore } from '@/stores/panel-store';
import { useThemeStore } from '@/stores/theme-store';

export function Header() {
  const setSettingsOpen = usePanelStore((s) => s.setSettingsOpen);
  const resolved = useThemeStore((s) => s.resolved);
  const setTheme = useThemeStore((s) => s.setTheme);
  const themeLabel = resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-4">
      <img src="/icon/96.png" alt="" width={36} height={36} className="size-9 shrink-0" />
      <div className="min-w-0 flex-1">
        <h1 className="text-base font-semibold leading-snug tracking-tight">Easy 3D Export</h1>
        <p className="text-xs text-muted-foreground">Your models, ready to use.</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')} aria-label={themeLabel}>
              {resolved === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{themeLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <Settings2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
