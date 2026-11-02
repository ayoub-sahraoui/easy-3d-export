import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('does not initialize the WASM decoder before checking CSP', async () => {
  const instantiate = vi.spyOn(WebAssembly, 'instantiate').mockRejectedValue(
    new WebAssembly.CompileError('WebAssembly compilation blocked by script-src self'),
  );
  const { MeshoptDecoder: ReferenceDecoder } = await import('@/conversion/meshopt/meshopt-decoder-reference');
  const { getMeshoptDecoder } = await import('@/conversion/meshopt/decoder');

  expect(instantiate).not.toHaveBeenCalled();
  const pending = getMeshoptDecoder();
  expect(getMeshoptDecoder()).toBe(pending);
  expect(await pending).toBe(ReferenceDecoder);
  expect(instantiate).toHaveBeenCalledTimes(1);
});

it('uses the reference decoder when WebAssembly is unavailable', async () => {
  vi.stubGlobal('WebAssembly', undefined);
  const { MeshoptDecoder: ReferenceDecoder } = await import('@/conversion/meshopt/meshopt-decoder-reference');
  const { getMeshoptDecoder } = await import('@/conversion/meshopt/decoder');
  expect(await getMeshoptDecoder()).toBe(ReferenceDecoder);
});

it('uses the WASM decoder when compilation is allowed', async () => {
  const { MeshoptDecoder: ReferenceDecoder } = await import('@/conversion/meshopt/meshopt-decoder-reference');
  const { getMeshoptDecoder } = await import('@/conversion/meshopt/decoder');
  const decoder = await getMeshoptDecoder();
  expect(decoder).not.toBe(ReferenceDecoder);
  expect(typeof decoder.decodeGltfBuffer).toBe('function');
});
