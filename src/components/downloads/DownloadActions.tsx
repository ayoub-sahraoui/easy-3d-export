import { FileDown, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function DownloadActions({ onOriginal, onTexture, textureCount, disabled = false }: {
  onOriginal: () => void;
  onTexture: () => void;
  textureCount: number;
  disabled?: boolean;
}) {
  return (
    <section aria-labelledby="source-heading" className="flex flex-col gap-3 border-t pt-6">
      <h2 id="source-heading" className="text-sm font-semibold">Source files</h2>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={onOriginal} disabled={disabled}><FileDown /> Original file</Button>
        <Button variant="outline" onClick={onTexture} disabled={disabled || textureCount === 0}
          title={textureCount === 0 ? 'No separate texture maps are available' : undefined}>
          <Layers /> Textures{textureCount > 0 ? ` (${textureCount})` : ''}
        </Button>
      </div>
    </section>
  );
}
