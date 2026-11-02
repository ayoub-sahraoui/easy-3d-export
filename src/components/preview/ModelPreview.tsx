/**
 * Optional 3D preview (Three.js). Loads lazily and only mounts a WebGL
 * context while open; decodes the selected variant to GLB on demand via the
 * shared conversion pipeline and caches the result per variant.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Eye, Grid3x3, Loader2, RotateCcw } from 'lucide-react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Button } from '@/components/ui/button';
import { toModelError } from '@/core/errors';
import { convertModel } from '@/conversion/pipeline';
import { fetchAssetWithPermission } from '@/downloads/manager';
import { toFileBaseName } from '@/lib/utils';
import { usePanelStore } from '@/stores/panel-store';

const glbCache = new Map<string, ArrayBuffer>();

interface SceneHandle {
  scene: THREE.Scene;
  frame: () => void;
}

async function obtainPreviewGlb(key: string, load: () => Promise<{ name: string; bytes: ArrayBuffer }>): Promise<ArrayBuffer> {
  const cached = glbCache.get(key);
  if (cached) return cached;
  const source = await load();
  const result = await convertModel({
    source,
    format: 'glb',
    includeTextures: true,
    textures: [],
    basename: 'preview',
  });
  glbCache.set(key, result.data);
  return result.data;
}

export function ModelPreview() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const model = usePanelStore((s) => s.models.find((m) => m.id === s.selectedModelId) ?? s.models[0] ?? s.manualModels.find((m) => m.id === s.selectedModelId));
  const variantId = usePanelStore((s) => s.selectedVariantId);
  const localImport = usePanelStore((s) => s.localImport);
  const variant = model?.variants.find((v) => v.id === variantId) ?? model?.variants[0];
  const variantKey = localImport ? `local:${localImport.name}` : `${model?.id}:${variant?.id}`;

  useEffect(() => {
    if (!open || !mountRef.current) return;
    let disposed = false;
    const mount = mountRef.current;
    setBusy(true);
    setPreviewError(undefined);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setPreviewError('3D preview is unavailable in this browser. You can still export the model.');
      setBusy(false);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, 260);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.2));
    const dir = new THREE.DirectionalLight(0xffffff, 2.0);
    dir.position.set(3, 6, 4);
    scene.add(dir);

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / 260, 0.01, 100);
    camera.position.set(2, 1.5, 2.6);
    const resizeObserver = new ResizeObserver(() => {
      const width = mount.clientWidth;
      if (!width) return;
      renderer.setSize(width, 260);
      camera.aspect = width / 260;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(mount);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const frame = () => {
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const dist = ((maxDim / 2) / Math.tan((camera.fov * Math.PI) / 360)) * 1.4;
      camera.position.set(center.x + dist * 0.6, center.y + dist * 0.45, center.z + dist * 0.8);
      controls.target.copy(center);
      camera.near = maxDim / 100;
      camera.far = maxDim * 20;
      camera.updateProjectionMatrix();
      controls.update();
    };
    handleRef.current = { scene, frame };

    const loader = new GLTFLoader();
    void (async () => {
      try {
        const bytes = await obtainPreviewGlb(variantKey ?? 'none', async () => {
          if (localImport) return { name: localImport.name, bytes: localImport.bytes };
          const asset = variant?.assets.find((a) => a.kind === 'model' && a.url);
          if (!asset?.url) throw new Error('No downloadable model for this variant yet.');
          const fetched = await fetchAssetWithPermission(asset.url, `preview:${variantKey}`);
          return { name: asset.filename ?? `${toFileBaseName(model?.name ?? 'model')}.${asset.format || 'bin'}`, bytes: fetched };
        });
        if (disposed) return;
        const gltf = await loader.parseAsync(bytes.slice(0), '');
        if (disposed) return;
        scene.add(gltf.scene);
        frame();
      } catch (e) {
        if (!disposed) setPreviewError(toModelError(e).userMessage);
      } finally {
        if (!disposed) setBusy(false);
      }
    })();

    let raf = 0;
    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      handleRef.current = null;
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variantKey]);

  const toggleWireframe = () => {
    const next = !wireframe;
    setWireframe(next);
    handleRef.current?.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => (m.wireframe = next));
      else if (mat) mat.wireframe = next;
    });
  };

  return (
    <section aria-label="3D preview" className="flex flex-col gap-3 border-t pt-4">
      <Button variant="ghost" className="w-full justify-start" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="model-preview">
        <Eye /> 3D preview
        <ChevronDown className={`ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open && (
        <div id="model-preview" className="flex flex-col gap-3">
          {previewError && <p role="alert" className="text-sm leading-relaxed text-muted-foreground">{previewError}</p>}
          <div className="relative">
            <div ref={mountRef} className={`h-[260px] w-full overflow-hidden rounded-lg border bg-muted/30 ${previewError ? 'hidden' : ''}`} />
            {busy && <div role="status" className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60"><Loader2 className="size-5 animate-spin text-muted-foreground" /><span className="sr-only">Loading 3D preview…</span></div>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={toggleWireframe} aria-pressed={wireframe} disabled={busy || !!previewError}><Grid3x3 /> Wireframe</Button>
            <Button variant="outline" size="icon-sm" onClick={() => handleRef.current?.frame()} aria-label="Reset view" disabled={busy || !!previewError}><RotateCcw /></Button>
          </div>
        </div>
      )}
    </section>
  );
}
