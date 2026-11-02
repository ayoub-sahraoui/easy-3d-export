/**
 * The two canonical Meshy task fixtures from integration research:
 * a generate task and its follow-up texture task, same rootId.
 * Placeholder hosts are intentional — these are never fetched.
 */

export const generateTaskFixture = {
  code: 'OK',
  result: {
    id: '01a19917-3282-7356-9701-19ef84fb129c',
    name: 'Green Stripe SUV',
    status: 'SUCCEEDED',
    progress: 0,
    phase: 'generate',
    mode: 'draft',
    rootId: '01a19917-3282-7356-9701-19ef84fb129c',
    parent: '',
    triangleCount: 2488,
    vertexCount: 1326,
    topology: 'triangle',
    args: {
      draft: {
        aiModel: 'venus-t2p5',
        targetPolycount: 2500,
        prompt: 'Green Stripe SUV',
        autoTexture: true,
      },
    },
    result: {
      previewUrl: 'https://cdn.meshy.example/previews/01a19917-generate.png?sign=1793664000-abc',
      generate: {
        modelUrl: 'https://cdn.meshy.example/models/01a19917-generate.model.meshy?sign=1793664000-abc',
        quadJsonUrl: 'https://cdn.meshy.example/quads/01a19917-generate.json?sign=1793664000-abc',
      },
      texture: null,
    },
  },
} as const;

export const textureTaskFixture = {
  code: 'OK',
  result: {
    id: '01a19917-5757-7058-a6a3-a3f9ecce3525',
    name: 'Green Stripe SUV',
    status: 'SUCCEEDED',
    progress: 0,
    phase: 'texture',
    mode: 'texture',
    rootId: '01a19917-3282-7356-9701-19ef84fb129c',
    parent: '01a19917-3282-7356-9701-19ef84fb129c',
    triangleCount: 2488,
    vertexCount: 2775,
    topology: 'triangle',
    args: {
      texture: {
        aiModel: 'native-texture',
        enablePBR: false,
      },
    },
    result: {
      previewUrl: 'https://cdn.meshy.example/previews/01a19917-textured.png?sign=1793664000-def',
      generate: null,
      texture: {
        modelUrl: 'https://cdn.meshy.example/models/01a19917-textured.model.meshy?sign=1793664000-def',
        quadJsonUrl: 'https://cdn.meshy.example/quads/01a19917-textured.json?sign=1793664000-def',
        textureUrls: [
          {
            colorMapUrl: 'https://cdn.meshy.example/textures/01a19917-texture_0.png?sign=1793664000-def',
          },
        ],
      },
    },
  },
} as const;

/** Non-Meshy JSON that must be rejected by recognition. */
export const unrelatedFixtures = [
  { hello: 'world' },
  { code: 'OK', result: { id: 'x', items: [1, 2, 3] } },
  { result: { id: 42 } },
  'just a string',
  null,
  [1, 2, 3],
  { code: 'OK', result: { id: 'abc', status: 'SUCCEEDED' } },
] as const;
