export interface ApiResponse<T = Record<string, unknown>> {
  ok: boolean;
  error?: string;
  message?: string;
  data?: T;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  page_size: number;
}

export interface HealthCheckResponse {
  ok: boolean;
  service: string;
  version?: string;
  uptime?: number;
}

export interface IntentClassification {
  request_type: string;
  confidence: number;
  user_goal?: string;
  channel_type?: string;
}
