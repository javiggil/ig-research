#!/usr/bin/env node
// =============================================================================
// Analyze scraped data + transcripts → generate markdown research report
// Usage: node scripts/report.js <project-name>
// =============================================================================

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const projectName = process.argv[2];
if (!projectName) {
  console.error('Usage: node scripts/report.js <project-name>');
  process.exit(1);
}

const projectDir = join(import.meta.dirname, '..', 'projects', projectName);
const rawPostsFile = join(projectDir, 'raw-posts.json');
const transcriptsDir = join(projectDir, 'transcripts');
const hooksDir = join(projectDir, 'hook-screenshots');
const reportFile = join(projectDir, 'report.md');

if (!existsSync(rawPostsFile)) {
  console.error('No raw-posts.json found. Run scrape.js first.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(rawPostsFile, 'utf8'));
const config = existsSync(join(projectDir, 'config.json'))
  ? JSON.parse(readFileSync(join(projectDir, 'config.json'), 'utf8'))
  : {};

// Parse engagement to number
function parseEngagement(post) {
  const likeStr = post.likes || post.likesFromBtn || '';
  const contextStr = post.likesContext || '';
  const viewStr = post.views || '';

  let match = likeStr.match(/([\d,.]+)\s*([KkMm])?/);
  if (match) {
    let num = parseFloat(match[1].replace(/,/g, ''));
    if (match[2]?.match(/[Kk]/)) num *= 1000;
    if (match[2]?.match(/[Mm]/)) num *= 1000000;
    return num;
  }

  match = contextStr.match(/and\s+([\d,.]+)\s*([KkMm])?\s*others/i);
  if (match) {
    let num = parseFloat(match[1].replace(/,/g, ''));
    if (match[2]?.match(/[Kk]/)) num *= 1000;
    if (match[2]?.match(/[Mm]/)) num *= 1000000;
    return num + 1;
  }

  match = viewStr.match(/([\d,.]+)\s*([KkMm])?/);
  if (match) {
    let num = parseFloat(match[1].replace(/,/g, ''));
    if (match[2]?.match(/[Kk]/)) num *= 1000;
    if (match[2]?.match(/[Mm]/)) num *= 1000000;
    return num;
  }

  return 0;
}

function loadTranscript(postId) {
  const txtFile = join(transcriptsDir, `${postId}.txt`);
  if (existsSync(txtFile)) return readFileSync(txtFile, 'utf8').trim();
  return null;
}

function getPostId(post) {
  return (post.href || post.url || '').match(/\/(p|reel)\/([\w-]+)/)?.[2] || '';
}

function hasHookScreenshots(postId) {
  if (!existsSync(hooksDir)) return false;
  return existsSync(join(hooksDir, `${postId}_0s.jpg`));
}

// =============================================================================
// Build report
// =============================================================================

const posts = data.posts.map(p => ({
  ...p,
  engagementNum: parseEngagement(p),
  postId: getPostId(p),
  transcript: loadTranscript(getPostId(p)),
  hasScreenshots: hasHookScreenshots(getPostId(p)),
}));

posts.sort((a, b) => b.engagementNum - a.engagementNum);

const reels = posts.filter(p => p.type === 'reel');
const images = posts.filter(p => p.type === 'image');
const withTranscripts = posts.filter(p => p.transcript);

const top20 = posts.slice(0, 20);

function extractFirstLine(text) {
  if (!text) return '';
  return text.split('\n').find(l => l.trim().length > 5)?.trim() || text.substring(0, 100);
}

let md = `# Instagram Research Report

**Project:** ${config.name || projectName}
**Niche:** ${config.niche || 'N/A'}
**Generated:** ${new Date().toLocaleDateString()}
**Search Terms:** ${(config.searchTerms || []).join(', ')}
**Competitors:** ${(config.competitors || []).map(c => c.match(/instagram\.com\/([^/]+)/)?.[1] || c).join(', ')}

---

## Overview

| Metric | Count |
|--------|-------|
| Total posts scraped | ${posts.length} |
| Reels | ${reels.length} |
| Images/Carousels | ${images.length} |
| With transcripts | ${withTranscripts.length} |
| With hook screenshots | ${posts.filter(p => p.hasScreenshots).length} |

## Format Breakdown

**Reels:** ${reels.length} (${Math.round(reels.length / posts.length * 100)}%)
**Images/Carousels:** ${images.length} (${Math.round(images.length / posts.length * 100)}%)

---

## Top 20 Performing Posts

`;

for (let i = 0; i < top20.length; i++) {
  const p = top20[i];
  const eng = p.likes || p.likesFromBtn || p.likesContext || p.views || 'unknown';
  const comments = p.comments || '';
  const hook = p.transcript ? extractFirstLine(p.transcript) : extractFirstLine(p.caption);
  const source = p.source || '';

  md += `### ${i + 1}. [${p.type.toUpperCase()}] ${eng}${comments ? ' | ' + comments : ''}\n`;
  md += `**Source:** ${source} | **Date:** ${p.dateText || p.date || 'unknown'}\n`;
  md += `**Author:** ${p.author || 'unknown'}\n`;
  if (p.hasScreenshots) md += `**Hook screenshots:** ${p.postId}_0s.jpg, ${p.postId}_1s.jpg, ${p.postId}_2s.jpg\n`;
  md += `**URL:** ${p.url || ('https://www.instagram.com' + p.href)}\n\n`;

  if (p.transcript) {
    md += `**Spoken hook (first 3 seconds):** "${extractFirstLine(p.transcript)}"\n\n`;
    md += `<details><summary>Full transcript</summary>\n\n${p.transcript}\n\n</details>\n\n`;
  }

  md += `**Caption preview:** ${(p.caption || '').substring(0, 200)}${(p.caption || '').length > 200 ? '...' : ''}\n\n`;
  md += `---\n\n`;
}

md += `## Pattern Analysis

### Format Distribution (Top 20)
- Reels: ${top20.filter(p => p.type === 'reel').length}
- Images/Carousels: ${top20.filter(p => p.type === 'image').length}

### Source Distribution (Top 20)
`;

const sourceCounts = {};
top20.forEach(p => {
  const s = p.source || 'unknown';
  sourceCounts[s] = (sourceCounts[s] || 0) + 1;
});
Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).forEach(([s, c]) => {
  md += `- ${s}: ${c} posts\n`;
});

if (withTranscripts.length > 0) {
  md += `\n### Top Spoken Hooks (from transcripts)\n\n`;
  const topTranscribed = withTranscripts.slice(0, 15);
  topTranscribed.forEach((p, i) => {
    const eng = p.likes || p.likesFromBtn || p.likesContext || p.views || '';
    md += `${i + 1}. **"${extractFirstLine(p.transcript)}"** (${eng})\n`;
  });
}

md += `\n---\n\n## All Posts (sorted by engagement)\n\n`;
md += `| # | Type | Engagement | Source | Author | Hook/Caption |\n`;
md += `|---|------|-----------|--------|--------|-------------|\n`;

posts.forEach((p, i) => {
  const eng = p.likes || p.likesFromBtn || p.likesContext || p.views || '-';
  const hook = (p.transcript ? extractFirstLine(p.transcript) : extractFirstLine(p.caption)).substring(0, 60);
  md += `| ${i + 1} | ${p.type} | ${eng} | ${(p.source || '').substring(0, 20)} | ${(p.author || '').substring(0, 15)} | ${hook}... |\n`;
});

writeFileSync(reportFile, md);

console.log(`\n========================================`);
console.log(`  Report generated!`);
console.log(`  ${reportFile}`);
console.log(`========================================`);
console.log(`  Total posts: ${posts.length}`);
console.log(`  With transcripts: ${withTranscripts.length}`);
console.log(`  With hook screenshots: ${posts.filter(p => p.hasScreenshots).length}`);
console.log(`  Top format: ${reels.length > images.length ? 'Reels' : 'Images'} (${Math.round(Math.max(reels.length, images.length) / posts.length * 100)}%)`);
console.log(`========================================`);
