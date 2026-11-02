import { storage } from 'wxt/utils/storage';
import { ModelError } from '@/core/errors';
import { pluginRegistry } from './registry';

// Separate keys keep updates to different plugins from overwriting each other.
const items = new Map(pluginRegistry.all().map((plugin) => [plugin.id,
  storage.defineItem<boolean>(`local:plugin:${plugin.id}:enabled`, { fallback: plugin.defaultEnabled }),
]));

export async function isPluginEnabled(id: string): Promise<boolean> {
  const value = await items.get(id)?.getValue();
  return typeof value === 'boolean' ? value : pluginRegistry.get(id)?.defaultEnabled ?? false;
}

export async function requirePluginEnabled(id: string): Promise<void> {
  if (!await isPluginEnabled(id)) {
    throw new ModelError('INVALID_RESPONSE', {
      message: `Enable the ${pluginRegistry.get(id)?.displayName ?? id} plugin in Settings to import its models.`,
    });
  }
}

export async function readPluginPreferences(): Promise<Record<string, boolean>> {
  return Object.fromEntries(await Promise.all(pluginRegistry.all().map(async ({ id }) => [id, await isPluginEnabled(id)])));
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const item = items.get(id);
  if (!item) throw new Error(`Unknown plugin: ${id}`);
  await item.setValue(enabled);
}

export function watchPluginPreferences(onChange: (id: string) => void): () => void {
  const unwatch = [...items].map(([id, item]) => item.watch(() => onChange(id)));
  return () => unwatch.forEach((stop) => stop());
}
