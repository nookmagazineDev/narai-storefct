// Default Category Sequence Numbers
export const DEFAULT_CATEGORY_ORDER = {
  'ของแห้ง': 1,
  'ของเย็น': 2,
  'ของสด': 3,
  'แป้ง/วัตถุดิบหลัก': 4,
  'ของเย็น/ชีส': 5,
  'ซอส/เครื่องปรุง': 6,
  'เนื้อสัตว์': 7,
  'ห้องผัก': 8,
  'เครื่องดื่ม': 9,
  'บรรจุภัณฑ์': 10,
  'อุปกรณ์/ของใช้': 11,
  'เคมีภัณฑ์': 12,
  'อื่นๆ': 99
};

const STORAGE_KEY = 'store_category_sequence_order';

// The vegetable category ("ผัก", per the item-category Google Sheet's Col N) runs on its own
// separate ordering/delivery cycle, so a same-branch, same-day requisition consisting entirely
// of ผัก items is kept as its own document rather than merged with the branch's other
// requisitions for that day.
export const VEGETABLE_CATEGORY = 'ผัก';

/**
 * True when every item in the list belongs to the vegetable-room category (and the list is
 * non-empty) — used to decide whether a requisition document should stay separate instead of
 * being merged with a branch's other same-day documents.
 */
export function isVegetableOnlyItems(items) {
  return Array.isArray(items) && items.length > 0 && items.every(it => (it.category || 'อื่นๆ') === VEGETABLE_CATEGORY);
}

/**
 * Get stored category sequence order map from localStorage
 * @returns {Record<string, number>}
 */
export function getCategoryOrderMap() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_CATEGORY_ORDER, ...parsed };
    }
  } catch (err) {
    console.warn("Failed to load category order map from localStorage", err);
  }
  return { ...DEFAULT_CATEGORY_ORDER };
}

/**
 * Save updated category sequence order map to localStorage
 * @param {Record<string, number>} orderMap 
 */
export function saveCategoryOrderMap(orderMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orderMap));
    // Dispatch event so other components update dynamically
    window.dispatchEvent(new Event('categoryOrderChanged'));
  } catch (err) {
    console.error("Failed to save category order map", err);
  }
}

/**
 * Get numerical sequence rank for a category
 * @param {string} categoryName 
 * @param {Record<string, number>} [orderMap] 
 * @returns {number}
 */
export function getCategoryRank(categoryName, orderMap) {
  const map = orderMap || getCategoryOrderMap();
  const name = categoryName || 'อื่นๆ';
  if (map[name] !== undefined) return Number(map[name]);
  return 99; // Fallback rank for unmapped categories
}

/**
 * Sort a list of category names based on sequence rank
 * @param {string[]} categoryList 
 * @param {Record<string, number>} [orderMap] 
 * @returns {string[]}
 */
export function sortCategoryNames(categoryList, orderMap) {
  const map = orderMap || getCategoryOrderMap();
  return [...categoryList].sort((a, b) => {
    const rankA = getCategoryRank(a, map);
    const rankB = getCategoryRank(b, map);
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b, 'th');
  });
}

/**
 * Format category name with sequence number badge for dropdown display
 * e.g., "1. แป้ง/วัตถุดิบหลัก"
 * @param {string} categoryName 
 * @param {Record<string, number>} [orderMap] 
 * @returns {string}
 */
export function formatCategoryLabel(categoryName, orderMap) {
  const rank = getCategoryRank(categoryName, orderMap);
  if (rank < 99) {
    return `${rank}. ${categoryName}`;
  }
  return categoryName;
}
