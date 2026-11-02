declare module 'draco3d/draco_decoder_nodejs.js' {
  import type { DecoderModule } from 'draco3d';
  const createDecoderModule: (options?: Record<string, unknown>) => Promise<DecoderModule>;
  export default createDecoderModule;
}
