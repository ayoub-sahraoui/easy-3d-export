/** Meshy v1 proprietary container decoder (no API key, fully local). */

import type { ModelDecoder } from '@/core/models/types';
import { isMeshyFile, meshyToGlb } from '@/conversion/meshy/decrypt';
import { finalizeGlb } from '@/conversion/decoders/shared';

export const meshyV1Decoder: ModelDecoder = {
  id: 'meshy-v1',
  extensions: ['meshy'],
  canDecode(file) {
    return isMeshyFile(file);
  },
  async decode(file, options) {
    options?.onStage?.('decoding');
    const glb = await meshyToGlb(file);
    return finalizeGlb(glb, 'meshy-v1', options);
  },
};
