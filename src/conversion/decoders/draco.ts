import type { ModelDecoder } from '@/core/models/types';
import { dracoToGlb, isDracoBytes } from '@/conversion/draco/decode';
import { finalizeGlb } from './shared';

export const dracoDecoder: ModelDecoder = {
  id: 'draco',
  extensions: ['drc'],
  canDecode: isDracoBytes,
  async decode(file, options) {
    options?.onStage?.('decompressing');
    const model = await finalizeGlb(await dracoToGlb(file), 'drc', options);
    model.warnings.push('This Draco export contains geometry and any vertex attributes present in the source. Materials and textures were not supplied.');
    return model;
  },
};
