import type { Command, TabContext } from '../shared/types';
import { isSlot } from '../domain/assignment';
import { object, integer, isTheme } from '../storage/schema';
export function context(value: unknown): value is TabContext {
  return object(value) && integer(value.tabId) && integer(value.windowId);
}
export function isCommand(value: unknown): value is Command {
  if (!object(value)) return false;
  switch (value.type) {
    case 'state':
      return value.capture === undefined || typeof value.capture === 'boolean';
    case 'sessions':
    case 'reset':
      return true;
    case 'theme':
      return isTheme(value.theme);
    case 'move':
      return isSlot(value.slot) && context(value.context);
    case 'recover':
      return (
        isSlot(value.slot) &&
        (value.context === null || context(value.context)) &&
        (value.sessionId === undefined ||
          (typeof value.sessionId === 'string' &&
            value.sessionId.length > 0 &&
            value.sessionId.length < 256))
      );
    case 'assign':
      return isSlot(value.slot) && integer(value.groupId) && typeof value.replace === 'boolean';
    case 'forget':
      return isSlot(value.slot);
    case 'transfer':
      return isSlot(value.from) && isSlot(value.to);
    default:
      return false;
  }
}
