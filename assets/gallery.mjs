export const CATEGORY_LABELS = Object.freeze({ design: '网页设计', interaction: '交互实验', tool: '小工具' });

/** Only web URLs can become links or media sources; resolve relative to the gallery. */
export function safeWebURL(value, baseURL) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('项目地址不能为空。');
  const url = new URL(value.trim(), baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('项目地址需要使用相对路径或 HTTP(S) 地址。');
  }
  return url.href;
}

export function normalizeProjects(data, baseURL) {
  if (!Array.isArray(data)) throw new Error('projects.json 的内容需要是项目数组。');
  const seen = new Set();
  return data.map((item, index) => {
    const prefix = `第 ${index + 1} 个项目：`;
    if (!item || typeof item !== 'object') throw new Error(`${prefix}项目格式有误。`);
    if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(item.id) || seen.has(item.id)) {
      throw new Error(`${prefix}id 需要是唯一的字母、数字、横线或下划线。`);
    }
    seen.add(item.id);
    for (const field of ['title', 'description']) {
      if (typeof item[field] !== 'string' || !item[field].trim()) throw new Error(`${prefix}${field} 不能为空。`);
    }
    if (!Object.hasOwn(CATEGORY_LABELS, item.category)) throw new Error(`${prefix}category 需要是 design、interaction 或 tool。`);
    if (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string' || !tag.trim())) {
      throw new Error(`${prefix}tags 需要是文字数组。`);
    }
    if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) throw new Error(`${prefix}日期需要使用 YYYY-MM-DD 格式。`);
    const timestamp = Date.parse(`${item.date}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== item.date) {
      throw new Error(`${prefix}日期无效。`);
    }
    return {
      ...item,
      title: item.title.trim(),
      description: item.description.trim(),
      tags: item.tags.map(tag => tag.trim()),
      url: safeWebURL(item.url, baseURL),
      preview: item.preview ? safeWebURL(item.preview, baseURL) : null,
      featured: item.featured === true,
      timestamp,
      index,
      searchText: [item.title, item.description, CATEGORY_LABELS[item.category], ...item.tags].join(' ').toLocaleLowerCase('zh-CN'),
    };
  });
}

export function selectProjects(projects, { category = 'all', query = '', sort = 'newest' } = {}) {
  const words = query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
  return projects.filter(project => (category === 'all' || project.category === category)
    && words.every(word => project.searchText.includes(word)))
    .sort((a, b) => {
      if (sort === 'name') return a.title.localeCompare(b.title, 'zh-CN') || a.index - b.index;
      const dateOrder = sort === 'oldest' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
      return dateOrder || Number(b.featured) - Number(a.featured) || a.index - b.index;
    });
}
