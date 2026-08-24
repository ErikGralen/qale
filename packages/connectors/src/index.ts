export type {
  Connector,
  ConnectorAuthField,
  ConnectorProvider,
  ConnectorHealth,
  ContainerFootprint,
  ContainerKind,
  EventChange,
  ExternalContainer,
  ExecuteResult,
  FetchLike,
  FullItem,
  ProviderReadTool,
  PullResult,
  ReadToolResult,
  ShallowChange,
  TicketChange,
  WikipageChange,
  VerifyResult,
} from './types.js';
export {
  collectFields,
  connectorFrom,
  readToolsFrom,
  withScheme,
  URL_FIELD_RE,
} from './credentials.js';
export {
  atlassianConnector,
  atlassianAuthSchema,
  type AtlassianAuthInput,
} from './atlassian/connector.js';
export { atlassianReadTools } from './atlassian/read-tools.js';
export { mapJiraStateCategory } from './atlassian/state-map.js';
export { probeAtlassian, type AtlassianAuth, type ProbeResult } from './atlassian/probe.js';
export {
  googleCalendarConnector,
  googleCalendarAuthSchema,
  CalendarAuthError,
  type GoogleCalendarAuth,
} from './google-calendar/connector.js';

import type { ConnectorProvider } from './types.js';
import { atlassianConnector } from './atlassian/connector.js';
import { googleCalendarConnector } from './google-calendar/connector.js';

/** All registered providers — the settings UI iterates this, nothing hardcodes one. */
export const CONNECTOR_PROVIDERS: readonly ConnectorProvider<unknown>[] = [
  atlassianConnector as ConnectorProvider<unknown>,
  googleCalendarConnector as ConnectorProvider<unknown>,
];
