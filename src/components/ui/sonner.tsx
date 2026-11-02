import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useThemeStore } from '@/stores/theme-store';

function Toaster(props: ToasterProps) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Sonner
      data-slot="toaster"
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      position="top-center"
      closeButton
      toastOptions={{
        classNames: {
          toast: '!text-sm !rounded-lg',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
