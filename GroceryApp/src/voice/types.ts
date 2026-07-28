/**
 * Voice subsystem types for Phase 2.
 *
 * Defines the shared interfaces used across NLP parsing, Siri intents,
 * Alexa Skill, IFTTT webhooks, and the unified VoiceService.
 */

export type VoicePlatform = 'siri' | 'alexa' | 'ifttt' | 'widget';

export interface VoiceInput {
  raw: string;
  platform: VoicePlatform;
  timestamp: number;
}

export interface ParsedItem {
  name: string;
  quantity: number;
  unit: string;
  confidence: number; // 0-1
  notes?: string;
}