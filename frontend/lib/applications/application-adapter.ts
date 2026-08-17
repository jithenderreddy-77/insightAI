// frontend/lib/applications/application-adapter.ts
// Core ApplicationAdapter Interface

import { UIObservation, ExpectedState } from '../agent/agent-types';
import { ScrollDirection } from '../automation/scrolling-engine';

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
  shouldDisambiguate?: boolean;
  candidates?: any[];
}

export interface ApplicationAdapter {
  id: string;
  aliases: string[];

  canHandle(appNameOrUrl: string): Promise<boolean> | boolean;

  open(targetQuery?: string): Promise<ActionResult>;

  search(query: string): Promise<ActionResult>;

  navigate(section: string): Promise<ActionResult>;

  clickTarget(target: string): Promise<ActionResult>;

  typeText(text: string, fieldTarget?: string): Promise<ActionResult>;

  scroll(direction: ScrollDirection, amount?: number): Promise<ActionResult>;

  goBack(): Promise<ActionResult>;

  shareCurrentContent(recipient?: string): Promise<ActionResult>;

  observe(): Promise<UIObservation>;

  verify(expected: ExpectedState): Promise<boolean>;
}
