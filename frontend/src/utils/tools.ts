export interface Tool {
  name: string;
  russian_name: string;
  type: string;
  description?: string;
  actions?: string[];
}

const normalizeToolName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');

const toolModules = import.meta.glob('../../tools/*.json', {
  eager: true,
}) as Record<string, { default: Tool } | Tool>;

const toolsMap: Record<string, Tool> = {};

Object.entries(toolModules).forEach(([path, mod]) => {
  const data = (mod as { default?: Tool }).default ?? (mod as Tool);

  if (!data || !('name' in data)) {
    console.warn(`[tools] Пропущен файл инструмента ${path}: отсутствует поле name`);
    return;
  }

  const normalizedName = normalizeToolName(data.name);
  toolsMap[normalizedName] = data;
});

export const getAllTools = (): Tool[] => {
  return Object.values(toolsMap);
};

export const getTool = (name: string): Tool | undefined => {
  const normalizedName = normalizeToolName(name);
  return toolsMap[normalizedName];
};

export const getToolRussianName = (name: string): string => {
  const tool = getTool(name);
  return tool?.russian_name || name;
};

