import remarkGfm from 'remark-gfm';
import { remarkWikiLink } from './wikilink.js';

/**
 * The shared remark plugin array — the SAME plugins the indexer and the read
 * view use (PLAN §3.5), so a link that resolves in the index renders identically
 * on screen. Consumed by react-markdown's `remarkPlugins`.
 */
export const remarkPlugins = [remarkGfm, remarkWikiLink];
