export type AIProvider = 'mistral';
export type AIMode = 'mistral';
export type SpeedMode = 'fast' | 'balanced' | 'accurate';
export type VisionMode = 'on' | 'off';

export interface AppSettings {
  provider: AIProvider;
  apiKey: string;
  blackAgentApiKey: string;
  blueAgentId: string;
  redAgentId: string;
  blackAgentId: string;
  aiMode: AIMode;
  speedMode: SpeedMode;
  visionMode: VisionMode;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'system' | 'blue' | 'red' | 'error' | 'success';
}

export interface UserProfile {
  age: string;
  gender: string;
  location: string;
  language: string;
  job: string;
  income: string;
  raw: string;
}
