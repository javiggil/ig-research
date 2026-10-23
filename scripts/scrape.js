#!/usr/bin/env node
// =============================================================================
// Instagram Research — Single-pass scraper
// For each post: navigate → engagement + caption → screenshots → audio → next
// One visit per post. No second pass.
// Usage: node scripts/scrape.js <project-name>
// =============================================================================

import CDP from 'chrome-remote-interface';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { exportarCookies, ytdlp } from './comun.js';
import { homedir } from 'os';

const projectName = process.argv[2];
if (!projectName) {
  console.error('Usage: node scripts/scrape.js <project-name>');
  process.exit(1);
}

const projectDir = join(import.meta.dirname, '..', 'projects', projectName);
const configFile = join(projectDir, 'config.json');
if (!existsSync(configFile)) {
  console.error(`Project not found: ${projectDir}\nCreate a config.json first.`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(configFile, 'utf8'));
const outputFile = join(projectDir, 'raw-posts.json');
const transcriptsDir = join(projectDir, 'transcripts');
const hooksDir = join(projectDir, 'hook-screenshots');

[transcriptsDir, hooksDir].forEach(d => {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
});

const wait = ms => new Promise(r => setTimeout(r, ms));

function getPort() {
  const portNum = config.browserPort || 9222;
  // Try the port file first, fall back to direct connection
  const portFile = join(homedir(), '.browser-tools', 'port');
  if (existsSync(portFile)) {
    return parseInt(readFileSync(portFile, 'utf8'));
  }
  return portNum;
}

async function getClient() {
  const port = getPort();
  let targets;
  try {
    targets = await CDP.List({ port });
  } catch (e) {
    console.error(`\nCannot connect to Chrome on port ${port}.`);
    console.error('Make sure Chrome is running with: --remote-debugging-port=9222');
    console.error('Close Chrome completely, then relaunch it with that flag.\n');
    process.exit(1);
  }
  let target = targets.find(t => t.type === 'page' && t.url.includes('instagram.com'));
  if (!target) {
    target = await CDP.New({ port, url: 'https://www.instagram.com/' });
    await wait(5000);
  }
  const client = await CDP({ port, target: target.id });
  await client.Page.enable();
  await client.Runtime.enable();
  await client.DOM.enable();
  return client;
}

// Collect post links from a hashtag search page
// Grabs Instagram's "Top posts" first (the ~9-post grid at the top),
// then scrolls for additional "Most recent" posts below.
async function collectSearchPosts(client, searchTerm, maxPosts) {
  const searchUrl = `https://www.instagram.com/explore/tags/${searchTerm.replace(/\s+/g, '').replace(/^#/, '')}/`;
  console.log(`  Navigating to: ${searchUrl}`);
  await client.Page.navigate({ url: searchUrl });
  await wait(4000);

  // Phase 1: Grab "Top posts" before scrolling. The grid renders late, so POLL
  // (up to ~25s) until links actually appear instead of a single fixed wait —
  // this is what fixes the previous "Top posts: 0" outlier-killing bug.
  let topLinks = [];
  for (let attempt = 0; attempt < 14; attempt++) {
    const topResult = await client.Runtime.evaluate({
      expression: `
        (() => {
          const links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
          const hrefs = [];
          const seen = new Set();
          for (const l of links) {
            const h = l.getAttribute('href');
            if (!seen.has(h)) { seen.add(h); hrefs.push(h); }
          }
          return hrefs;
        })()
      `,
      returnByValue: true
    });
    const hrefs = topResult.result.value || [];
    if (hrefs.length >= 6) { topLinks = hrefs.slice(0, 9); break; }
    topLinks = hrefs.slice(0, 9);
    await wait(1500);
  }
  console.log(`  Top posts: ${topLinks.length}`);

  // Phase 2: Scroll to load "Most recent" posts
  const remainingNeeded = maxPosts - topLinks.length;
  if (remainingNeeded > 0) {
    const scrollRounds = Math.ceil(remainingNeeded / 12);
    for (let i = 0; i < scrollRounds; i++) {
      await client.Runtime.evaluate({ expression: 'window.scrollBy(0, 1500)' });
      await wait(2000);
    }
  }

  // Collect all links, but tag which are top vs recent
  const allResult = await client.Runtime.evaluate({
    expression: `
      (() => {
        const links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
        const hrefs = [];
        const seen = new Set();
        for (const l of links) {
          const h = l.getAttribute('href');
          if (!seen.has(h)) { seen.add(h); hrefs.push(h); }
          if (hrefs.length >= ${maxPosts}) break;
        }
        return hrefs;
      })()
    `,
    returnByValue: true
  });
  const allLinks = allResult.result.value || [];

  // Tag top vs recent
  const topSet = new Set(topLinks);
  return allLinks.map(href => ({
    href,
    section: topSet.has(href) ? 'top' : 'recent'
  }));
}

// Collect post links from a profile page
async function collectProfilePosts(client, profileUrl, maxPosts) {
  console.log(`  Navigating to: ${profileUrl}`);
  await client.Page.navigate({ url: profileUrl });
  await wait(4000);

  const grab = `
    (() => {
      const links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
      const hrefs = [];
      const seen = new Set();
      for (const l of links) {
        const h = l.getAttribute('href');
        if (!seen.has(h)) { seen.add(h); hrefs.push(h); }
      }
      return hrefs;
    })()
  `;

  // Instagram virtualizes the profile grid (rows leave the DOM on scroll), so
  // ACCUMULATE hrefs across scroll rounds instead of reading the DOM once.
  // Keeps the render-poll behavior that fixed the "Found 0 posts" bug, then
  // scrolls until maxPosts are collected or the profile runs dry.
  const collected = [];
  const seen = new Set();
  let stale = 0;
  for (let attempt = 0; attempt < 120; attempt++) {
    const r = await client.Runtime.evaluate({ expression: grab, returnByValue: true });
    const before = collected.length;
    for (const h of r.result.value || []) {
      if (!seen.has(h)) { seen.add(h); collected.push(h); }
    }
    if (collected.length >= maxPosts) break;
    if (collected.length === 0) {
      if (attempt >= 14) break; // grid never rendered (old cap)
    } else if (collected.length === before) {
      stale++;
      if (stale >= 8) break; // end of profile
    } else {
      stale = 0;
    }
    await client.Runtime.evaluate({ expression: 'window.scrollBy(0, 1200)' });
    await wait(1500);
  }
  return collected.slice(0, maxPosts);
}

// Walk a carousel (or single image) slide by slide, screenshotting each frame.
// Clicks the "Next" control between slides; stops at the last slide, when the
// main image stops changing, or after a hard cap. Returns the number captured.
async function captureCarousel(client, postId) {
  const MAX_SLIDES = 8;
  let count = 0;
  let lastSrc = '';
  for (let i = 0; i < MAX_SLIDES; i++) {
    // Identify the main media image src (largest visible img) to detect the end.
    const info = await client.Runtime.evaluate({
      expression: `
        (() => {
          let best = null, bestArea = 0;
          for (const im of document.querySelectorAll('img')) {
            const r = im.getBoundingClientRect();
            const area = r.width * r.height;
            if (area > bestArea && r.width > 200 && r.height > 200 && r.top < window.innerHeight) { best = im; bestArea = area; }
          }
          return best ? (best.currentSrc || best.src) : null;
        })()
      `,
      returnByValue: true
    });
    const src = info.result.value;
    if (i > 0 && (!src || src === lastSrc)) break; // didn't advance / no more slides
    lastSrc = src;

    const ss = await client.Page.captureScreenshot({ format: 'jpeg', quality: 72 });
    writeFileSync(join(hooksDir, `${postId}_slide${i}.jpg`), Buffer.from(ss.data, 'base64'));
    count++;

    // Advance to the next slide; if there's no "Next" control, we're done.
    const adv = await client.Runtime.evaluate({
      expression: `
        (() => {
          // Next control is localized (en "Next", es "Siguiente", pt "Avancar", ...).
          // Match aria-label across locales; fall back to a right-edge chevron button.
          const labels = /^(next|siguiente|pr[oó]xim[oa]|avan[cç]ar|avanti|suivant|weiter|seuraava|volgende|n+a+stepn[ai])$/i;
          let b = [...document.querySelectorAll('button,[role="button"],[aria-label]')]
            .find(x => labels.test(((x.getAttribute('aria-label') || '').trim())));
          if (!b) {
            const cands = [...document.querySelectorAll('button,[role="button"]')].filter(x => {
              const r = x.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && r.left > window.innerWidth * 0.55
                && r.top < window.innerHeight * 0.85 && (r.top + r.height / 2) > window.innerHeight * 0.2;
            });
            b = cands.find(x => x.querySelector('svg')) || null;
          }
          if (b) { b.click(); return true; }
          return false;
        })()
      `,
      returnByValue: true
    });
    if (!adv.result.value) break;
    await wait(800);
  }
  return count;
}

// Fetch a profile's follower count (for the outlier multiplier). Reads the
// og:description meta ("1.2M Followers, ...") with an ld+json fallback.
async function fetchFollowers(client, handle) {
  try {
    await client.Page.navigate({ url: `https://www.instagram.com/${handle}/` });
    await wait(3500);
    const r = await client.Runtime.evaluate({
      expression: `
        (() => {
          const toN = (v) => {
            if (!v) return null;
            const m = String(v).replace(/,/g, '').match(/([\\d.]+)\\s*([KkMmBb])?/);
            if (!m) return null;
            let n = parseFloat(m[1]); if (!isFinite(n)) return null;
            const u = (m[2] || '').toLowerCase();
            if (u === 'k') n *= 1e3; else if (u === 'm') n *= 1e6; else if (u === 'b') n *= 1e9;
            return Math.round(n);
          };
          const meta = document.querySelector('meta[property="og:description"]');
          const c = meta ? (meta.getAttribute('content') || '') : '';
          const m = c.match(/([\\d.,]+\\s*[KkMmBb]?)\\s+Followers/i);
          if (m) return toN(m[1]);
          for (const b of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
              const j = JSON.parse(b.textContent); const arr = Array.isArray(j) ? j : [j];
              for (const node of arr) {
                const s = node && node.interactionStatistic; if (!s) continue;
                for (const x of (Array.isArray(s) ? s : [s])) {
                  const t = String((x.interactionType && (x.interactionType['@type'] || x.interactionType)) || '');
                  if (/Follow/i.test(t)) { const n = Number(x.userInteractionCount); if (isFinite(n)) return n; }
                }
              }
            } catch (e) {}
          }
          return null;
        })()
      `,
      returnByValue: true
    });
    return r.result.value || null;
  } catch (e) {
    return null;
  }
}

// =============================================================================
// SINGLE-PASS: scrape + screenshot + audio for ONE post
// =============================================================================
async function processPost(client, href, source) {
  const postId = href.match(/\/(p|reel)\/([\w-]+)/)?.[2] || '';
  const postUrl = href.startsWith('http') ? href : 'https://www.instagram.com' + href;
  const audioFile = join(transcriptsDir, `${postId}.m4a`);
  const ssFile0 = join(hooksDir, `${postId}_0s.jpg`);

  // NOTE: no early "skip" return — always navigate + extract metadata so that
  // re-runs rebuild a complete raw-posts.json. The screenshot/audio steps below
  // are individually guarded by existsSync(), so already-downloaded files are
  // reused and not re-fetched.

  // 1. Navigate to post — pause video ASAP to capture true first frames
  await client.Page.navigate({ url: postUrl });
  // Poll rapidly to pause the video the instant it appears
  for (let attempt = 0; attempt < 30; attempt++) {
    const paused = await client.Runtime.evaluate({
      expression: `(() => { const v = document.querySelector('video'); if(v) { v.pause(); v.muted = true; return true; } return false; })()`,
      returnByValue: true
    });
    if (paused.result.value) break;
    await wait(200);
  }
  await wait(3000);

  // 2. Extract engagement + caption + author from STRUCTURED data.
  //    Priority: ld+json (exact likes/comments/author/date) -> og: meta -> span
  //    heuristic (last resort). This replaces the fragile span-scraping that
  //    confused timestamps with likes and left authors empty.
  const data = await client.Runtime.evaluate({
    expression: `
      (() => {
        const out = { url: window.location.href };
        const toN = (v) => {
          if (v == null) return null;
          const m = String(v).replace(/,/g, '').match(/([\\d.]+)\\s*([KkMmBb])?/);
          if (!m) return null;
          let n = parseFloat(m[1]); if (!isFinite(n)) return null;
          const u = (m[2] || '').toLowerCase();
          if (u === 'k') n *= 1e3; else if (u === 'm') n *= 1e6; else if (u === 'b') n *= 1e9;
          return Math.round(n);
        };

        // (1) ld+json — exact counts + author + date + caption
        try {
          for (const b of document.querySelectorAll('script[type="application/ld+json"]')) {
            let j; try { j = JSON.parse(b.textContent); } catch (e) { continue; }
            const nodes = Array.isArray(j) ? j : [j];
            for (const node of nodes) {
              if (!node || typeof node !== 'object') continue;
              const a = node.author || node.creator;
              if (a && !out.author) out.author = String(a.alternateName || (a.identifier && a.identifier.value) || a.name || '').replace(/^@/, '');
              const stats = node.interactionStatistic;
              if (stats) {
                for (const s of (Array.isArray(stats) ? stats : [stats])) {
                  const t = String((s.interactionType && (s.interactionType['@type'] || s.interactionType)) || '');
                  const c = Number(s.userInteractionCount);
                  if (!isFinite(c)) continue;
                  if (/Like/i.test(t) && out.likesNum == null) out.likesNum = c;
                  else if (/Comment/i.test(t) && out.commentsNum == null) out.commentsNum = c;
                  else if (/(Watch|View)/i.test(t) && out.viewsNum == null) out.viewsNum = c;
                }
              }
              if (out.commentsNum == null && node.commentCount != null) out.commentsNum = Number(node.commentCount);
              if (!out.date && node.uploadDate) out.date = node.uploadDate;
              if (!out.caption && (node.caption || node.articleBody || node.description)) out.caption = String(node.caption || node.articleBody || node.description);
              const ty = String(node['@type'] || '');
              if (/VideoObject/i.test(ty)) out.type = 'reel';
              else if (/ImageObject/i.test(ty) && !out.type) out.type = 'image';
            }
          }
        } catch (e) {}

        // (2) og: meta fallback — "14,582 likes, 320 comments - Name (@handle) on Instagram: caption"
        const meta = (p) => { const el = document.querySelector('meta[property="' + p + '"]'); return el ? (el.getAttribute('content') || '') : ''; };
        const og = meta('og:description');
        if (og) {
          if (out.likesNum == null)    { const m = og.match(/([\\d.,]+\\s*[KkMmBb]?)\\s+likes?/i);    if (m) out.likesNum = toN(m[1]); }
          if (out.commentsNum == null) { const m = og.match(/([\\d.,]+\\s*[KkMmBb]?)\\s+comments?/i); if (m) out.commentsNum = toN(m[1]); }
          if (out.viewsNum == null)    { const m = og.match(/([\\d.,]+\\s*[KkMmBb]?)\\s+views?/i);    if (m) out.viewsNum = toN(m[1]); }
        }
        if (!out.author) {
          const src = og + ' ' + meta('og:title');
          const m = src.match(/\\(@([\\w.]+)\\)/) || src.match(/[-\\u2013]\\s*([\\w.]{2,})\\s+on\\s+Instagram/i);
          if (m) out.author = m[1].replace(/^@/, '');
        }

        // (3) span heuristic — only to fill gaps when structured data is missing
        const rawNumbers = [];
        if (out.likesNum == null && out.viewsNum == null) {
          const seen = new Set();
          for (const el of document.querySelectorAll('span')) {
            const t = el.textContent.trim();
            if (t.match(/^[\\d,.]+[KkMm]?$/) && t.length < 15 && t !== '0' && !seen.has(t)) { seen.add(t); rawNumbers.push(t); }
          }
        }
        out.rawNumbers = rawNumbers.slice(0, 10);

        // Caption fallback from the DOM
        if (!out.caption) {
          const h1 = document.querySelector('h1');
          if (h1 && h1.textContent.trim().length > 0) out.caption = h1.textContent;
          else { for (const s of document.querySelectorAll('span[dir="auto"]')) { if (s.textContent.length > 20) { out.caption = s.textContent; break; } } }
        }

        // Type / date
        if (!out.type) out.type = document.querySelector('video') ? 'reel' : 'image';
        const timeEl = document.querySelector('time[datetime]');
        if (timeEl) { if (!out.date) out.date = timeEl.getAttribute('datetime'); out.dateText = timeEl.textContent; }

        out.fullCaption = out.caption || '';
        out.caption = (out.caption || '').substring(0, 500);
        return out;
      })()
    `,
    returnByValue: true
  });

  const post = data.result.value;
  post.href = href;
  post.source = source;
  post.postId = postId;

  // 3. Screenshots (only for reels)
  if (post.type === 'reel' && !existsSync(ssFile0)) {
    try {
      // Video is already paused from page load — just seek and screenshot
      for (const sec of [0, 1, 2]) {
        const ssFile = join(hooksDir, `${postId}_${sec}s.jpg`);
        await client.Runtime.evaluate({
          expression: `(() => { const v = document.querySelector('video'); if(v) { v.currentTime = ${sec}; } })()`,
        });
        await wait(800);
        const ss = await client.Page.captureScreenshot({ format: 'jpeg', quality: 70 });
        writeFileSync(ssFile, Buffer.from(ss.data, 'base64'));
      }
      post.hasScreenshots = true;
    } catch (e) {
      post.hasScreenshots = false;
    }
  } else if (post.type === 'image' && !existsSync(join(hooksDir, `${postId}_slide0.jpg`))) {
    // Carousel / single image: walk the slides clicking "Next" and screenshot each.
    try {
      post.slideCount = await captureCarousel(client, postId);
      post.hasSlides = post.slideCount > 0;
    } catch (e) {
      post.hasSlides = false;
    }
  }

  // NOTE: audio is NOT downloaded here anymore. yt-dlp doesn't need the browser,
  // so we defer audio download until after ranking and only fetch the TOP N reels
  // (see the audio phase in main). This avoids downloading/transcribing dozens of
  // low-engagement reels we never analyze.

  return post;
}

// Engagement signal for sorting. Prefers the exact numeric fields from the
// structured extractor (likes, then views); falls back to the legacy span
// heuristic (rawNumbers / likes string) for older data.
function parseEngagement(post) {
  if (typeof post.likesNum === 'number' && post.likesNum > 0) return post.likesNum;
  if (typeof post.viewsNum === 'number' && post.viewsNum > 0) return post.viewsNum;
  const toNum = (s) => {
    const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KkMmBb])?/);
    if (!m) return 0;
    let n = parseFloat(m[1]); if (!isFinite(n)) return 0;
    const u = (m[2] || '').toLowerCase();
    if (u === 'k') n *= 1e3; else if (u === 'm') n *= 1e6; else if (u === 'b') n *= 1e9;
    return n;
  };
  const nums = (post.rawNumbers || []).map(toNum);
  if (post.likes) nums.push(toNum(post.likes));
  return nums.length ? Math.max(...nums) : 0;
}

// =============================================================================
// Main
// =============================================================================
(async () => {
  try {
    const client = await getClient();
    const allPosts = [];

    // Incremental save so a browser crash mid-run doesn't lose collected data.
    function saveProgress() {
      const seen = new Set();
      const uniq = allPosts.filter(p => {
        const key = p.href || p.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => parseEngagement(b) - parseEngagement(a));
      writeFileSync(outputFile, JSON.stringify({
        project: config.name,
        niche: config.niche,
        scrapedAt: new Date().toISOString(),
        searchTerms: config.searchTerms,
        competitors: config.competitors,
        totalPosts: uniq.length,
        reels: uniq.filter(p => p.type === 'reel').length,
        images: uniq.filter(p => p.type === 'image').length,
        posts: uniq
      }, null, 2));
    }

    // Search terms
    for (const term of config.searchTerms) {
      console.log(`\n========================================`);
      console.log(`  Searching: "${term}"`);
      console.log(`========================================`);

      const links = await collectSearchPosts(client, term, config.maxPostsPerSearch || 50);
      const topCount = links.filter(l => l.section === 'top').length;
      const recentCount = links.filter(l => l.section === 'recent').length;
      console.log(`  Found ${links.length} posts (${topCount} top, ${recentCount} recent)\n`);

      for (let i = 0; i < links.length; i++) {
        const { href, section } = links[i];
        const postId = href.match(/\/(p|reel)\/([\w-]+)/)?.[2] || '';
        const tag = section === 'top' ? '[TOP]' : '[RECENT]';
        process.stdout.write(`  [${i + 1}/${links.length}] ${tag} ${postId} — `);

        const post = await processPost(client, href, `${section}:${term}`);
        if (post.skipped) {
          console.log('skipped (done)');
        } else {
          const eng = post.likesNum != null ? post.likesNum.toLocaleString() + ' likes'
                    : post.viewsNum != null ? post.viewsNum.toLocaleString() + ' views'
                    : 'sin datos';
          const ss = post.hasScreenshots ? 'ss' : (post.hasSlides ? `${post.slideCount}sl` : '');
          const audio = post.hasAudio ? 'audio' : '';
          console.log(`[${post.type}] ${eng} ${[ss, audio].filter(Boolean).join(' ')}`);
          allPosts.push(post);
          saveProgress();
        }
      }
    }

    // Competitor profiles
    for (const profileUrl of (config.competitors || [])) {
      const handle = profileUrl.match(/instagram\.com\/([^/]+)/)?.[1] || profileUrl;
      console.log(`\n========================================`);
      console.log(`  Competitor: @${handle}`);
      console.log(`========================================`);

      const links = await collectProfilePosts(client, profileUrl, config.maxCompetitorPosts || 10);
      console.log(`  Found ${links.length} posts\n`);

      for (let i = 0; i < links.length; i++) {
        const postId = links[i].match(/\/(p|reel)\/([\w-]+)/)?.[2] || '';
        process.stdout.write(`  [${i + 1}/${links.length}] ${postId} — `);

        const post = await processPost(client, links[i], `competitor:@${handle}`);
        if (post.skipped) {
          console.log('skipped (done)');
        } else {
          const eng = post.likesNum != null ? post.likesNum.toLocaleString() + ' likes'
                    : post.viewsNum != null ? post.viewsNum.toLocaleString() + ' views'
                    : 'sin datos';
          console.log(`[${post.type}] ${eng}`);
          allPosts.push(post);
          saveProgress();
        }
      }
    }

    // Deduplicate
    const seen = new Set();
    const unique = allPosts.filter(p => {
      const key = p.href || p.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    unique.sort((a, b) => parseEngagement(b) - parseEngagement(a));

    // Followers phase: for the authors of the top posts, fetch their follower
    // count and compute an OUTLIER MULTIPLIER = engagement / followers. A post
    // that vastly outperforms its account size is the strongest signal that the
    // VIDEO is exceptional (not the audience). Only the top N (we only show ~10).
    const TOP_FOLLOWERS_N = config.topFollowers || 20;
    const handles = [...new Set(unique.slice(0, TOP_FOLLOWERS_N).map(p => p.author).filter(Boolean))];
    if (handles.length) {
      console.log(`\n  Fetching followers for ${handles.length} top authors...`);
      const followersBy = {};
      for (const handle of handles) {
        followersBy[handle] = await fetchFollowers(client, handle);
        process.stdout.write(followersBy[handle] ? 'f' : '.');
      }
      console.log('');
      for (const p of unique) {
        const f = followersBy[p.author];
        const eng = parseEngagement(p);
        if (f && f > 0 && eng > 0) {
          p.followers = f;
          p.multiplier = Math.round((eng / f) * 10) / 10;
        }
      }
    }

    // Audio phase: download audio ONLY for the top N reels by engagement, then
    // transcribe.js will transcribe just those. This is the big time saver.
    const TOP_AUDIO_N = config.topAudio ?? 15; // 0 = sin audio (selección manual posterior)
    const topReels = unique.filter(p => p.type === 'reel').slice(0, TOP_AUDIO_N);
    console.log(`\n  Downloading audio for top ${topReels.length} reels (of ${unique.filter(p => p.type === 'reel').length})...`);
    // Instagram exige sesión para bajar el media: las cookies salen del propio Chrome abierto (CDP) y se
    // le pasan a yt-dlp en un fichero que se borra al acabar. Vale igual en Mac y en Windows.
    const cookiesFile = join(projectDir, '.cookies.txt');
    if (topReels.length) await exportarCookies(null, cookiesFile, client);
    for (const post of topReels) {
      const audioFile = join(transcriptsDir, `${post.postId}.m4a`);
      if (existsSync(audioFile)) { post.hasAudio = true; process.stdout.write('·'); continue; }
      const postUrl = post.url || (String(post.href).startsWith('http') ? post.href : 'https://www.instagram.com' + post.href);
      ytdlp(['--format', 'worstaudio', '--no-warnings', '--quiet', '--cookies', cookiesFile, '-o', audioFile, postUrl], 90000);
      post.hasAudio = existsSync(audioFile);
      process.stdout.write(post.hasAudio ? 'a' : 'x');
    }
    rmSync(cookiesFile, { force: true });
    console.log('');

    const output = {
      project: config.name,
      niche: config.niche,
      scrapedAt: new Date().toISOString(),
      searchTerms: config.searchTerms,
      competitors: config.competitors,
      totalPosts: unique.length,
      reels: unique.filter(p => p.type === 'reel').length,
      images: unique.filter(p => p.type === 'image').length,
      posts: unique
    };

    writeFileSync(outputFile, JSON.stringify(output, null, 2));

    console.log(`\n========================================`);
    console.log(`  Complete!`);
    console.log(`  Total: ${unique.length} unique posts`);
    console.log(`  Reels: ${output.reels} | Images: ${output.images}`);
    console.log(`  Screenshots: ${hooksDir}`);
    console.log(`  Audio: ${transcriptsDir}`);
    console.log(`  Data: ${outputFile}`);
    console.log(`========================================`);

    await client.close();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
