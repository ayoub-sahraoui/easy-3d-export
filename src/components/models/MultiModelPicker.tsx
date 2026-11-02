import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { NormalizedModel } from '@/core/models/types';

export function MultiModelPicker({ models, selectedId, onSelect }: {
  models: NormalizedModel[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  if (models.length < 2) return null;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="selected-model">Available models <span className="font-normal text-muted-foreground">({models.length})</span></Label>
      <Select value={selectedId} onValueChange={onSelect}>
        <SelectTrigger id="selected-model" className="w-full"><SelectValue placeholder="Choose a model" /></SelectTrigger>
        <SelectContent>
          {models.map((model) => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
