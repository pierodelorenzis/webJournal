const FEED_URL = "https://xml2.corriereobjects.it/feed-hp/homepage-restyle-2025.xml";
const MAX_STORIES = 60;
const FEED_FETCH_TIMEOUT_MS = 2600;
const IMAGE_FETCH_TIMEOUT_MS = 1800;
const IMAGE_LOOKUP_CONCURRENCY = 4;
const FEED_CACHE_KEY = "ilgazzettino-feed-cache-v6";
const IMAGE_CACHE_KEY = "ilgazzettino-image-cache-v1";
const FEED_CACHE_TTL_MS = 0;

const issueDate = document.querySelector("#issue-date");
const feedStatus = document.querySelector("#feed-status");
const storiesRoot = document.querySelector("#stories");
const template = document.querySelector("#story-template");
const refreshButton = document.querySelector("#refresh-feed");

const leadTitle = document.querySelector("#lead-title");
const leadMeta = document.querySelector("#lead-meta");
const leadSummary = document.querySelector("#lead-summary");
const leadLink = document.querySelector("#lead-link");
const leadImage = document.querySelector("#lead-image");
const leadVisual = document.querySelector(".lead-visual");

if (!issueDate) console.error('issueDate not found');
if (!feedStatus) console.error('feedStatus not found');
if (!storiesRoot) console.error('storiesRoot not found');
if (!template) console.error('template not found');
if (!refreshButton) console.error('refreshButton not found');
if (!leadTitle) console.error('leadTitle not found');
if (!leadMeta) console.error('leadMeta not found');
if (!leadSummary) console.error('leadSummary not found');
if (!leadLink) console.error('leadLink not found');
if (!leadImage) console.error('leadImage not found');
if (!leadVisual) console.error('leadVisual not found');

issueDate.textContent = new Intl.DateTimeFormat("it-IT", {
  dateStyle: "full",
}).format(new Date());

refreshButton.addEventListener("click", () => {
  loadFeed();
});

loadFeed();

async function loadFeed() {
  setLoadingState(true);
  storiesRoot.setAttribute("aria-busy", "true");

  try {
    const stories = await getStories();
    renderLead(stories[0]);
    renderStories(stories.slice(1));
    feedStatus.textContent = `${stories.length} articoli`;
  } catch (error) {
    renderError(error);
  } finally {
    storiesRoot.setAttribute("aria-busy", "false");
    setLoadingState(false);
  }
}

async function getStories() {
  const cachedStories = readCache(FEED_CACHE_KEY, FEED_CACHE_TTL_MS);

  if (cachedStories?.length) {
    return cachedStories;
  }

  const stories = await fetchStories();
  writeCache(FEED_CACHE_KEY, stories);
  return stories;
}

async function fetchStories() {
  const response = await fetchWithTimeout(FEED_URL, {
    headers: {
      accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
    },
    timeoutMs: FEED_FETCH_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const stories = await parsePlainTextResponse(response);

  if (!stories.length) {
    throw new Error("Nessun articolo valido trovato.");
  }

  return dedupeStories(stories).slice(0, MAX_STORIES);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? FEED_FETCH_TIMEOUT_MS;
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Richiesta scaduta.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function parsePlainTextResponse(response) {
  const xmlText = normalizeXml(await response.text());
  return parseXmlStories(xmlText);
}

function parseXmlStories(xmlText) {
  if (!xmlText.trim()) {
    throw new Error("Risposta vuota.");
  }

  if (!looksLikeRss(xmlText)) {
    throw new Error("La risposta non contiene un feed RSS valido.");
  }

  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  const parserError = xml.querySelector("parsererror");

  if (parserError) {
    throw new Error("Il feed ricevuto non e un XML valido.");
  }

  const items = [...xml.getElementsByTagName("item")];

  if (!items.length) {
    throw new Error("Nessun articolo trovato nel feed.");
  }

  return items.map(mapItem).filter(story => story.title !== "Titolo non disponibile");
}

function mapItem(item) {
  const title = readTagText(item, "title");
  const link = readTagText(item, "link");
  const pubDate = readTagText(item, "pubDate");
  const descriptionSource =
    readTagText(item, "description") || readTagText(item, "content:encoded");
  const description = cleanText(descriptionSource);
  const category = readFirstCategory(item) || inferCategoryFromLink(link);

  return {
    title: title || "Titolo non disponibile",
    link: link || FEED_URL,
    category,
    pubDate: formatDate(pubDate),
    description,
    image: extractImageUrl(item),
  };
}

function renderLead(story) {
  leadTitle.textContent = story.title;
  leadMeta.textContent = story.pubDate;
  leadSummary.textContent = story.description;
  leadSummary.hidden = !story.description;
  leadLink.href = story.link;
  leadLink.setAttribute("aria-label", `Apri l'articolo: ${story.title}`);
  renderImage(leadVisual, leadImage, story);
}

function isSportsCategory(category) {
  const sportsKeywords = ['sport', 'calcio', 'basket', 'tennis', 'formula', 'motori', 'mondiali', 'olimpiadi', 'atletica', 'ciclismo', 'nuoto', 'pallavolo'];
  return sportsKeywords.some(keyword => category.toLowerCase().includes(keyword));
}

function renderStories(stories) {
  storiesRoot.innerHTML = "";

  if (!stories.length) {
    storiesRoot.innerHTML = `
      <article class="empty-state">
        <p class="section-label">Edizione breve</p>
        <p>Il feed ha restituito solo l'articolo principale.</p>
      </article>
    `;
    return;
  }

  const secondaryFeaturedStories = stories.slice(0, 2);
  const groupedStories = stories.slice(2);
  let globalIndex = 2;

  if (secondaryFeaturedStories.length) {
    const featuredSection = document.createElement("section");
    featuredSection.className = "featured-stories";
    const secondaryRow = buildStoryRow(secondaryFeaturedStories, globalIndex);
    globalIndex += secondaryFeaturedStories.length;
    featuredSection.appendChild(secondaryRow);

    storiesRoot.appendChild(featuredSection);
  }

  const groups = groupStoriesByCategory(groupedStories);
  const validGroups = groups.filter(([category, stories]) => stories.length > 0);
  const sportsGroups = validGroups.filter(([category]) => isSportsCategory(category));
  const nonSportsGroups = validGroups.filter(([category]) => !isSportsCategory(category));

  const primaryGroups = nonSportsGroups.slice(0, 3);
  const trailingGroups = nonSportsGroups.slice(3);

  primaryGroups.forEach(([category, categoryStories]) => {
    const section = document.createElement("section");
    section.className = "category-group";

    const heading = document.createElement("h3");
    heading.className = "category-heading";
    heading.textContent = category;
    section.appendChild(heading);

    splitIntoEditorialRows(categoryStories).forEach((rowStories) => {
      const row = buildStoryRow(rowStories, globalIndex);
      globalIndex += rowStories.length;
      section.appendChild(row);
    });

    storiesRoot.appendChild(section);
  });

  if (trailingGroups.length || sportsGroups.length) {
    const rowWrapper = document.createElement("div");
    rowWrapper.className = "category-row";

    sportsGroups.forEach(([category, categoryStories]) => {
      const section = document.createElement("section");
      section.className = "category-group sport-section";

      const heading = document.createElement("h3");
      heading.className = "category-heading";
      heading.textContent = category;
      section.appendChild(heading);

      splitIntoEditorialRows(categoryStories).forEach((rowStories) => {
        const row = buildStoryRow(rowStories, globalIndex);
        globalIndex += rowStories.length;
        section.appendChild(row);
      });

      rowWrapper.appendChild(section);
    });

    trailingGroups.forEach(([category, categoryStories]) => {
      const section = document.createElement("section");
      section.className = "category-group";

      const heading = document.createElement("h3");
      heading.className = "category-heading";
      heading.textContent = category;
      section.appendChild(heading);

      splitIntoEditorialRows(categoryStories).forEach((rowStories) => {
        const row = buildStoryRow(rowStories, globalIndex);
        globalIndex += rowStories.length;
        section.appendChild(row);
      });

      rowWrapper.appendChild(section);
    });

    storiesRoot.appendChild(rowWrapper);
  }
}

function buildStoryRow(rowStories, startIndex) {
  const row = document.createElement("div");
  row.className = "story-row";
  row.dataset.columns = String(rowStories.length);

  rowStories.forEach((story, offset) => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".story-card");
    const visual = fragment.querySelector(".story-visual");
    const image = fragment.querySelector(".story-image");
    const link = fragment.querySelector(".story-link");

    card.dataset.size = getStorySize(startIndex + offset);
    fragment.querySelector(".story-date").textContent = story.pubDate;
    fragment.querySelector(".story-title").textContent = story.title;
    fragment.querySelector(".story-summary").textContent = story.description;
    fragment.querySelector(".story-summary").hidden = !story.description;
    link.setAttribute("aria-label", `Leggi l'articolo: ${story.title}`);
    link.href = story.link;
    renderImage(visual, image, story);
    row.appendChild(fragment);
  });

  return row;
}

function renderError(error) {
  feedStatus.textContent = "Impossibile caricare il feed";
  storiesRoot.innerHTML = `
    <article class="error-box">
      <p class="section-label">Errore</p>
      <p>Non sono riuscito a leggere il feed RSS del Corriere.</p>
      <p>${escapeHtml(error.message)}</p>
      <p>Controlla la connessione o riprova più tardi.</p>
    </article>
  `;
}

function setLoadingState(isLoading) {
  refreshButton.disabled = isLoading;
  refreshButton.textContent = isLoading ? "Aggiornamento..." : "Aggiorna";

  if (isLoading) {
    feedStatus.textContent = "Recupero degli articoli...";
  }
}

function readTagText(node, tagName) {
  return node.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? "";
}

function readNamespacedTagText(node, localName) {
  const allNodes = node.getElementsByTagName("*");

  for (const candidate of allNodes) {
    if (candidate.localName === localName) {
      return candidate.textContent?.trim() ?? "";
    }
  }

  return "";
}

function normalizeXml(value) {
  return value.replace(/^\uFEFF/, "").trim();
}

function looksLikeRss(value) {
  return value.includes("<rss") && value.includes("<item>");
}

function dedupeStories(stories) {
  const seen = new Set();

  return stories.filter((story) => {
    const key = buildStoryKey(story);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function groupStoriesByCategory(stories) {
  const grouped = new Map();
  const orderedCategories = ["Cronaca", "Politica", "Esteri", "Sport"];

  stories.forEach((story) => {
    const category = story.category || "Altre notizie";

    if (!grouped.has(category)) {
      grouped.set(category, []);
    }

    grouped.get(category).push(story);
  });

  const preferred = [];
  const remaining = [];

  orderedCategories.forEach((category) => {
    if (grouped.has(category)) {
      preferred.push([category, grouped.get(category)]);
      grouped.delete(category);
    }
  });

  [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "it"))
    .forEach((entry) => remaining.push(entry));

  return [...preferred, ...remaining];
}

function splitIntoEditorialRows(stories) {
  const pattern = [2, 3, 2];
  const rows = [];
  let cursor = 0;
  let patternIndex = 0;

  while (cursor < stories.length) {
    const targetSize = pattern[patternIndex % pattern.length];
    const remaining = stories.length - cursor;
    const rowSize = remaining <= 2 ? remaining : Math.min(targetSize, remaining);
    rows.push(stories.slice(cursor, cursor + rowSize));
    cursor += rowSize;
    patternIndex += 1;
  }

  // Merge last row if it has only 1 story
  if (rows.length > 1 && rows[rows.length - 1].length === 1) {
    const lastRow = rows.pop();
    rows[rows.length - 1].push(...lastRow);
  }

  return rows;
}

function getStorySize(index) {
  if (index <= 2) {
    return "xl";
  }

  if (index <= 6) {
    return "lg";
  }

  if (index <= 14) {
    return "md";
  }

  return "sm";
}

function buildStoryKey(story) {
  const normalizedLink = normalizeStoryLink(story.link);
  const normalizedTitle = story.title
    ?.toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return normalizedLink || normalizedTitle || "";
}

function normalizeStoryLink(value) {
  if (!value) {
    return "";
  }

  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .trim();
}

function extractImageUrl(item) {
  const enclosureUrl = findEnclosureImage(item);
  const mediaUrl =
    findNamespacedMediaImage(item) ||
    readTagAttribute(item, "media:content", "url") ||
    readTagAttribute(item, "media:thumbnail", "url") ||
    readNamespacedTagText(item, "content") ||
    readNamespacedTagText(item, "thumbnail");
  const descriptionUrl = extractImageFromHtml(readTagText(item, "description"));
  const imageUrl = enclosureUrl || mediaUrl || descriptionUrl;

  return normalizeImageUrl(imageUrl);
}

function findEnclosureImage(item) {
  const enclosures = [...item.getElementsByTagName("enclosure")];

  for (const enclosure of enclosures) {
    const type = enclosure.getAttribute("type") || "";
    const url = enclosure.getAttribute("url") || "";

    if (type.startsWith("image/") && url) {
      return url;
    }
  }

  return "";
}

function findNamespacedMediaImage(item) {
  const allNodes = item.getElementsByTagName("*");

  for (const candidate of allNodes) {
    if (candidate.localName !== "content" && candidate.localName !== "thumbnail") {
      continue;
    }

    const url = candidate.getAttribute("url") || candidate.textContent || "";

    if (looksLikeImageUrl(url)) {
      return url.trim();
    }
  }

  return "";
}

function readTagAttribute(node, tagName, attributeName) {
  return node.getElementsByTagName(tagName)[0]?.getAttribute(attributeName)?.trim() ?? "";
}

function extractImageFromHtml(value) {
  const match = value.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ?? "";
}

function normalizeImageUrl(value) {
  if (!value) {
    return "";
  }

  if (value.startsWith("//")) {
    return `https:${value}`;
  }

  return value.trim();
}

function looksLikeImageUrl(value) {
  return /\.(avif|gif|jpe?g|png|webp)(\?|$)/i.test(value);
}

function readFirstCategory(item) {
  const categories = item.getElementsByTagName("category");
  return categories[0]?.textContent?.trim() ?? "";
}

function inferCategoryFromLink(link) {
  if (!link) {
    return "";
  }

  try {
    const url = new URL(link);
    const segments = url.pathname.split("/").filter(Boolean);
    const ignored = new Set([
      "repubblica",
      "www",
      "2026",
      "2025",
      "2024",
      "2023",
      "2022",
      "2021",
      "2020",
      "news",
      "diretta",
    ]);

    const category = segments.find((segment) => !ignored.has(segment.toLowerCase()));

    if (!category) {
      return "";
    }

    return category
      .replace(/-/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  } catch {
    return "";
  }
}

async function resolveImageFromArticle(url) {
  const articleHtml = await fetchArticleHtml(url);

  if (!articleHtml) {
    return "";
  }

  const imageUrl =
    findMetaImage(articleHtml, "og:image") ||
    findMetaImage(articleHtml, "twitter:image") ||
    findLinkImage(articleHtml);

  return normalizeImageUrl(imageUrl);
}

async function fetchArticleHtml(url) {
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        accept: "text/html, application/xhtml+xml;q=0.9, */*;q=0.1",
      },
      timeoutMs: IMAGE_FETCH_TIMEOUT_MS,
    });

    if (!response.ok) {
      return "";
    }

    const html = await response.text();

    if (html.includes("<html") || html.includes("<meta")) {
      return html;
    }
  } catch {
    return "";
  }

  return "";
}

function findMetaImage(html, propertyName) {
  const escapedName = escapeRegExp(propertyName);
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escapedName}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapedName}["']`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function findLinkImage(html) {
  const match = html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
  return match?.[1] ?? "";
}

function renderImage(visualNode, imageNode, story) {
  if (!visualNode || !imageNode) {
    return;
  }

  if (!story.image) {
    visualNode.hidden = true;
    imageNode.hidden = true;
    imageNode.removeAttribute("src");
    imageNode.alt = "";
    return;
  }

  visualNode.hidden = false;
  imageNode.hidden = false;
  imageNode.src = story.image;
  imageNode.alt = story.title;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readCache(key, ttlMs) {
  if (!ttlMs) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(key);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);

    if (!parsed.timestamp || Date.now() - parsed.timestamp > ttlMs) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    window.sessionStorage.setItem(
      key,
      JSON.stringify({
        timestamp: Date.now(),
        value,
      }),
    );
  } catch {
    return;
  }
}

function cleanText(value) {
  const textOnly = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!textOnly) {
    return "";
  }

  return textOnly.length > 220 ? `${textOnly.slice(0, 217)}...` : textOnly;
}

function formatDate(value) {
  if (!value) {
    return "Data non disponibile";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
