/** Registry of format exporters. Adding a format = adding one file here. */

import type { ModelExporter } from '@/core/models/types';
import { glbExporter } from '@/conversion/exporters/glb';
import { objExporter } from '@/conversion/exporters/obj';

const exporters: ModelExporter[] = [glbExporter, objExporter];

export const exporterRegistry = {
  all: () => [...exporters],
  register(exporter: ModelExporter) {
    const i = exporters.findIndex((e) => e.format === exporter.format);
    if (i >= 0) exporters[i] = exporter;
    else exporters.push(exporter);
  },
  get(format: string): ModelExporter | undefined {
    return exporters.find((e) => e.format === format);
  },
  /** Formats safe to advertise in the UI (implemented + registered). */
  availableFormats(): string[] {
    return exporters.map((e) => e.format);
  },
};
