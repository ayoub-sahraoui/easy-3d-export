/** Standard GLB decoder (pass-through + meshopt resolution + validation). */

import type { ModelDecoder } from '@/core/models/types';
import { isGlbBytes } from '@/conversion/glb/container';
import { finalizeGlb } from '@/conversion/decoders/shared';

export const glbDecoder: ModelDecoder = {
  id: 'glb',
  extensions: ['glb'],
  canDecode(file) {
    return isGlbBytes(file);
  },
  async decode(file, options) {
    options?.onStage?.('decoding');
    return finalizeGlb(file, 'glb', options);
  },
};
