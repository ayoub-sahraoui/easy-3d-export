/** Based on the supplied real task card; account data and signed credentials omitted. */
export const rodinTaskFixture = {
  task_uuid: '30f65e09-6af7-45c8-b03a-0e08b84f200a',
  type: 'Rodin',
  prompt: 'A high-quality 3D model. sharp edges, complex geometry, game-ready',
  time: '2026-10-26T20:09:27.566Z',
  step: 'ModelGenerate',
  pending_jobs: [],
  user_state: 'DonePreview',
  generate_time: '2026-10-26T20:09:40.737Z',
  image_url: 'https://file.hyper3d.com/30f65e09-6af7-45c8-b03a-0e08b84f200a/model_generate/v1/preview.webp',
  model_preview_info: {
    preview_sdf: 'https://file.hyper3d.com/30f65e09-6af7-45c8-b03a-0e08b84f200a/model_generate/v1/model.drc?X-Tos-Date=20261102T024006Z&X-Tos-Expires=604800&X-Tos-Signature=test',
  },
} as const;
