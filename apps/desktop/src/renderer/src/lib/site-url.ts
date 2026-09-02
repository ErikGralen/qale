/**
 * Preview the site address a "…Url" auth field will actually connect to, so
 * pasting a full page link (what people have on hand, and what the field's
 * hint invites) shows its true effect before the form is submitted. Mirrors
 * the scheme-and-origin normalization `withScheme` applies server-side
 * (packages/connectors/src/credentials.ts) — kept separate since the renderer
 * doesn't otherwise depend on that package.
 */
export function siteUrlPreview(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProto).origin;
  } catch {
    return null;
  }
}
