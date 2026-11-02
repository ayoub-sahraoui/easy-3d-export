/** Registry of format-based decoders. Adding a format = adding one file here. */

import type { ModelDecoder } from '@/core/models/types';
import { meshyV1Decoder } from '@/conversion/decoders/meshy-v1';
import { glbDecoder } from '@/conversion/decoders/glb';
import { dracoDecoder } from '@/conversion/decoders/draco';

const decoders: ModelDecoder[] = [meshyV1Decoder, glbDecoder, dracoDecoder];

export const decoderRegistry = {
  all: () => [...decoders],
  register(decoder: ModelDecoder) {
    if (!decoders.some((d) => d.id === decoder.id)) decoders.push(decoder);
  },
  getForExtension(ext: string): ModelDecoder | undefined {
    const e = ext.toLowerCase().replace(/^\./, '');
    return decoders.find((d) => d.extensions.includes(e));
  },
  getForBytes(bytes: ArrayBuffer): ModelDecoder | undefined {
    return decoders.find((d) => d.canDecode(bytes));
  },
};
