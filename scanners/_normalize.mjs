const WORLDWIDE_REMOTE_RE = /\b(worldwide|global|anywhere|remote anywhere|work from anywhere)\b/i;
const REGION_REMOTE_RE = /\b(emea|europe|european union|eu\b|middle east|gcc|gulf|mena|apac|asia pacific)\b/i;
const REMOTE_RE = /\b(remote|work[\s-]?from[\s-]?home|wfh|distributed|telecommute|home office)\b/i;

const LOCATION_RULES = [
  { region_group: 'pakistan', country_code: 'PK', re: /\b(pakistan|lahore|karachi|islamabad|rawalpindi|faisalabad|peshawar|multan|hyderabad|sialkot)\b/i },
  { region_group: 'gcc', country_code: 'AE', re: /\b(uae|united arab emirates|dubai|abu dhabi|sharjah)\b/i },
  { region_group: 'gcc', country_code: 'SA', re: /\b(saudi arabia|ksa|riyadh|jeddah|dammam|khobar)\b/i },
  { region_group: 'gcc', country_code: 'QA', re: /\b(qatar|doha)\b/i },
  { region_group: 'gcc', country_code: 'KW', re: /\b(kuwait|kuwait city)\b/i },
  { region_group: 'gcc', country_code: 'OM', re: /\b(oman|muscat)\b/i },
  { region_group: 'gcc', country_code: 'BH', re: /\b(bahrain|manama)\b/i },
  { region_group: 'gcc', country_code: null, re: /\b(gcc|gulf|mena|middle east)\b/i },
  { region_group: 'ireland', country_code: 'IE', re: /\b(ireland|dublin)\b/i },
  { region_group: 'poland', country_code: 'PL', re: /\b(poland|warsaw|krakow|kraków)\b/i },
  { region_group: 'usa', country_code: 'US', re: /\b(usa|u\.s\.a\.|united states|new york|san francisco|california|washington dc|america)\b/i },
  { region_group: 'uk', country_code: 'GB', re: /\b(uk|u\.k\.|united kingdom|london|manchester|england|scotland|wales)\b/i },
  // Continental Europe — coarse but covers the major hubs we see in arbeitnow / personio.
  { region_group: 'europe', country_code: 'DE', re: /\b(germany|deutschland|berlin|münchen|munich|frankfurt|hamburg|köln|cologne|stuttgart|düsseldorf|dortmund|leipzig|bremen|hannover|nürnberg|nuremberg|dresden|essen|dortmund|mannheim|karlsruhe)\b/i },
  { region_group: 'europe', country_code: 'NL', re: /\b(netherlands|nederland|amsterdam|rotterdam|the hague|utrecht|eindhoven)\b/i },
  { region_group: 'europe', country_code: 'FR', re: /\b(france|paris|lyon|marseille|toulouse|nice|nantes|bordeaux|lille)\b/i },
  { region_group: 'europe', country_code: 'ES', re: /\b(spain|españa|madrid|barcelona|valencia|sevilla|seville|bilbao)\b/i },
  { region_group: 'europe', country_code: 'PT', re: /\b(portugal|lisbon|lisboa|porto)\b/i },
  { region_group: 'europe', country_code: 'IT', re: /\b(italy|italia|rome|roma|milan|milano|turin|torino|napoli|naples)\b/i },
  { region_group: 'europe', country_code: 'SE', re: /\b(sweden|sverige|stockholm|gothenburg|göteborg|malmö)\b/i },
  { region_group: 'europe', country_code: 'DK', re: /\b(denmark|danmark|copenhagen|københavn|aarhus)\b/i },
  { region_group: 'europe', country_code: 'NO', re: /\b(norway|norge|oslo|bergen|trondheim)\b/i },
  { region_group: 'europe', country_code: 'FI', re: /\b(finland|helsinki|espoo|tampere)\b/i },
  { region_group: 'europe', country_code: 'CH', re: /\b(switzerland|schweiz|zurich|zürich|geneva|genève|basel|bern)\b/i },
  { region_group: 'europe', country_code: 'AT', re: /\b(austria|österreich|vienna|wien|graz|linz|salzburg|innsbruck)\b/i },
  { region_group: 'europe', country_code: 'BE', re: /\b(belgium|belgië|brussels|brussel|antwerp|antwerpen|ghent)\b/i },
  { region_group: 'europe', country_code: 'CZ', re: /\b(czech republic|czechia|prague|praha|brno)\b/i },
  { region_group: 'europe', country_code: 'GR', re: /\b(greece|athens|thessaloniki)\b/i },
  { region_group: 'europe', country_code: null, re: /\b(europe|emea|european union|eu\b)\b/i },
];

const REGION_ALIASES = new Map([
  ['pakistan', ['pakistan']],
  ['pk', ['pakistan']],
  ['gcc', ['gcc']],
  ['gulf', ['gcc']],
  ['uae', ['gcc']],
  ['dubai', ['gcc']],
  ['saudi', ['gcc']],
  ['saudi_arabia', ['gcc']],
  ['saudi-arabia', ['gcc']],
  ['ksa', ['gcc']],
  ['qatar', ['gcc']],
  ['oman', ['gcc']],
  ['kuwait', ['gcc']],
  ['bahrain', ['gcc']],
  ['ireland', ['ireland']],
  ['poland', ['poland']],
  ['usa', ['usa']],
  ['us', ['usa']],
  ['united_states', ['usa']],
  ['uk', ['uk']],
  ['united_kingdom', ['uk']],
  ['europe', ['europe']],
  ['emea', ['europe', 'remote_region']],
  ['remote', ['remote_worldwide', 'remote_region']],
  ['worldwide', ['remote_worldwide']],
  ['global', ['remote_worldwide']],
  ['remote_worldwide', ['remote_worldwide']],
  ['remote-worldwide', ['remote_worldwide']],
  ['worldwide_remote', ['remote_worldwide']],
  ['worldwide-remote', ['remote_worldwide']],
  ['remote_region', ['remote_region']],
  ['remote-region', ['remote_region']],
  ['other', ['other']],
]);

export function normalizeRegionToken(token) {
  const key = String(token || '').trim().toLowerCase().replace(/\s+/g, '_');
  return REGION_ALIASES.get(key) || [key.replace(/-/g, '_')];
}

export function normalizeRegionTokens(tokens = []) {
  return [...new Set(tokens.flatMap(normalizeRegionToken).filter(Boolean))];
}

export function normalizeLocation(location = '', country = '') {
  const text = `${location || ''} ${country || ''}`.trim();
  let matched = null;
  for (const rule of LOCATION_RULES) {
    if (rule.re.test(text)) {
      matched = rule;
      break;
    }
  }

  const remoteScope = classifyRemoteScope({ location: text, remote: REMOTE_RE.test(text) || WORLDWIDE_REMOTE_RE.test(text) });
  let regionGroup = matched?.region_group || 'other';
  if (!matched && remoteScope === 'worldwide') regionGroup = 'remote_worldwide';
  if (!matched && remoteScope === 'region') regionGroup = 'remote_region';

  return {
    location: String(location || '').trim(),
    country_code: matched?.country_code || countryToCode(country) || null,
    region_group: regionGroup,
    remote_scope: remoteScope,
  };
}

/**
 * Classify a job's remote scope: 'none' | 'country' | 'region' | 'worldwide'.
 *
 * Two text inputs are considered separately on purpose:
 *   - `location` (and `region` tags) drive WHERE the job is. Phrases like
 *     "worldwide", "EMEA", "Riyadh", and country names ONLY count when they
 *     appear here.
 *   - `description` / `title` are scanned only to detect IF the role is
 *     remote at all (REMOTE_RE). They never decide the scope on their own,
 *     because job descriptions routinely contain phrases like
 *     "we have offices worldwide" or "serving the MENA region" that would
 *     otherwise produce false-positive worldwide/region scopes.
 *
 * Back-compat: callers passing only `{ location, remote, region }` still
 * work — the description signal is opt-in.
 */
export function classifyRemoteScope({ location = '', remote = false, region = [], description = '' } = {}) {
  const locText = `${location || ''} ${Array.isArray(region) ? region.join(' ') : region || ''}`.trim();
  const bodyText = `${description || ''}`.trim();

  // 1. Location-anchored regional/worldwide phrases — strongest signal.
  //    These win over every other input because the *location* is what ATS
  //    operators use to declare scope ("Remote — EMEA").
  if (WORLDWIDE_REMOTE_RE.test(locText) || /\bworldwide[-_ ]remote\b/i.test(locText)) return 'worldwide';
  if (REGION_REMOTE_RE.test(locText) || /\b(remote[-_ ]region|worldwide-remote)\b/i.test(locText)) {
    return /\bworldwide-remote\b/i.test(locText) ? 'worldwide' : 'region';
  }

  // 2. Country-anchored location: scope depends on whether remote is allowed.
  //    If the location names a specific country, the description's casual use
  //    of "worldwide" does NOT promote the scope. This was a real bug — Tamara
  //    Riyadh jobs whose JD copy mentioned "GCC and worldwide" got mis-tagged.
  const countryAnchored = LOCATION_RULES.some((rule) => rule.country_code && rule.re.test(locText));
  if (countryAnchored) {
    if (remote === true || REMOTE_RE.test(locText)) return 'country';
    return 'none';
  }

  // 3. No geographic anchor in location. Now (and only now) the explicit
  //    `remote` flag and description hints are allowed to drive the answer.
  if (remote === true) return 'worldwide';
  if (remote === false) return 'none';
  if (REMOTE_RE.test(bodyText) || WORLDWIDE_REMOTE_RE.test(bodyText)) return 'worldwide';
  return 'none';
}

export function normalizeJob(job = {}) {
  const rawLocation = job.location || '';
  const loc = normalizeLocation(rawLocation, job.country || job.country_code || '');
  const remoteScope = job.remote_scope || classifyRemoteScope({
    // Location is the only authoritative signal for WHERE the role lives.
    // Title and description are passed separately as `description` so the
    // classifier may use them to detect remoteness but NEVER to override
    // a country-anchored location.
    location: rawLocation,
    region: job.region || job.region_group || [],
    description: `${job.title || ''} ${job.description || ''} ${job.description_html || ''}`,
    remote: job.remote === true,
  });
  let regionGroup = job.region_group || loc.region_group;
  if (remoteScope === 'worldwide' && regionGroup === 'other') regionGroup = 'remote_worldwide';
  if (remoteScope === 'region' && regionGroup === 'other') regionGroup = 'remote_region';

  const datePosted = normalizeDate(job.date_posted || job.posted_at);
  const source = String(job.source || 'unknown');
  const sourceId = String(job.source_id || job.id || job.raw?.id || job.raw?.shortcode || job.url || '').trim();

  return {
    ...job,
    title: String(job.title || '').trim(),
    company: String(job.company || 'Unknown').trim() || 'Unknown',
    location: String(rawLocation || '').trim(),
    country_code: job.country_code || loc.country_code,
    region_group: regionGroup,
    remote: job.remote ?? remoteScope !== 'none',
    remote_scope: remoteScope,
    employment_type: job.employment_type || null,
    url: String(job.url || '').trim(),
    apply_url: job.apply_url || job.url || null,
    date_posted: datePosted,
    posted_at: job.posted_at || datePosted,
    source,
    source_id: sourceId,
    description_html: job.description_html || job.description || '',
    tags: Array.isArray(job.tags) ? job.tags.filter(Boolean) : [],
    raw: job.raw ?? null,
  };
}

export function jobMatchesRegions(job, requested = []) {
  const wanted = new Set(normalizeRegionTokens(requested));
  if (wanted.size === 0) return true;
  const regionGroup = job.region_group || normalizeLocation(job.location, job.country_code).region_group;
  const remoteScope = job.remote_scope || classifyRemoteScope(job);

  if (wanted.has(regionGroup)) return true;
  if (wanted.has('remote_worldwide') && remoteScope === 'worldwide') return true;
  if (wanted.has('remote_region') && remoteScope === 'region') return true;
  return false;
}

export function isUsOnly(job = {}) {
  const text = `${job.title || ''} ${job.location || ''} ${job.description || ''} ${job.description_html || ''}`;
  return /\b(us|u\.s\.|united states)\s+only\b/i.test(text)
    || /requires?\s+us\s+work\s+authorization/i.test(text)
    || /security clearance required/i.test(text);
}

function countryToCode(country) {
  const c = String(country || '').trim().toLowerCase();
  if (!c) return null;
  if (['pk', 'pakistan'].includes(c)) return 'PK';
  if (['ae', 'uae', 'united arab emirates'].includes(c)) return 'AE';
  if (['sa', 'ksa', 'saudi arabia'].includes(c)) return 'SA';
  if (['qa', 'qatar'].includes(c)) return 'QA';
  if (['kw', 'kuwait'].includes(c)) return 'KW';
  if (['om', 'oman'].includes(c)) return 'OM';
  if (['bh', 'bahrain'].includes(c)) return 'BH';
  if (['ie', 'ireland'].includes(c)) return 'IE';
  if (['pl', 'poland'].includes(c)) return 'PL';
  if (['us', 'usa', 'united states'].includes(c)) return 'US';
  if (['gb', 'uk', 'united kingdom'].includes(c)) return 'GB';
  return /^[a-z]{2}$/i.test(c) ? c.toUpperCase() : null;
}

function normalizeDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
