/** Load a complete catalog using the server's actual page size, with stale-request cancellation. */
export async function loadCatalogPages<R extends { total?: number }>(
  fetchPage: (page: number) => Promise<R>,
  key: keyof NoInfer<R>,
  allPages = true,
  isCurrent: () => boolean = () => true,
): Promise<R> {
  const first = await fetchPage(1);
  if (!isCurrent()) throw new Error('Catalog request superseded');
  if (!allPages) return first;
  const rows = [...((first[key] ?? []) as unknown as Array<{ id?: string }>)];
  let page = 1;
  while (rows.length < (first.total ?? rows.length)) {
    if (!isCurrent()) throw new Error('Catalog request superseded');
    const next = await fetchPage(++page);
    if (!isCurrent()) throw new Error('Catalog request superseded');
    const batch = (next[key] ?? []) as unknown as Array<{ id?: string }>;
    const known = new Set(rows.map(row => row.id));
    const fresh = batch.filter(row => !row.id || !known.has(row.id));
    if (!fresh.length) throw new Error('Не удалось загрузить весь каталог. Повторите загрузку.');
    rows.push(...fresh);
  }
  return { ...first, [key]: rows };
}
