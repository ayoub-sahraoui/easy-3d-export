import type { DecoderModule } from 'draco3d';
import { ModelError } from '@/core/errors';

let pending: Promise<DecoderModule> | undefined;

/** Bundle the decoder and its WASM locally; never use eval or CDN workers. */
export function getDracoModule(): Promise<DecoderModule> {
  pending ??= (async () => {
    try {
      const [{ default: createDecoderModule }, { default: wasmUrl }] = await Promise.all([
        import('draco3d/draco_decoder_nodejs.js'),
        import('draco3d/draco_decoder.wasm?url'),
      ]);
      const response = await fetch(wasmUrl);
      if (!response.ok) throw new Error('The packaged Draco decoder could not be loaded.');
      return await createDecoderModule({ wasmBinary: await response.arrayBuffer() });
    } catch (cause) {
      throw new ModelError('MODEL_DECODE_FAILED', {
        message: 'The local Draco decoder could not start. Reload the extension and try again.',
        cause,
      });
    }
  })();
  return pending;
}
