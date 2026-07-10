export const MIN_BOARD_SIZE = 280;
export const MAX_BOARD_SIZE_MOBILE = 480;
export const MAX_BOARD_SIZE_DESKTOP = 640;
export const DESKTOP_BREAKPOINT = 1024;

export function computeBoardSize(containerWidth: number, isDesktop: boolean): number {
  const horizontalPadding = isDesktop ? 32 : 24;
  const widthBudget = containerWidth - horizontalPadding;
  const maxBoard = isDesktop ? MAX_BOARD_SIZE_DESKTOP : MAX_BOARD_SIZE_MOBILE;

  const headerEstimate = 72;
  const verticalPadding = isDesktop ? 48 : 32;
  const mobileChatReserve = 220;

  const heightBudget = isDesktop
    ? window.innerHeight - headerEstimate - verticalPadding
    : Math.min(window.innerHeight * 0.48, window.innerHeight - headerEstimate - mobileChatReserve);

  return Math.floor(Math.max(MIN_BOARD_SIZE, Math.min(widthBudget, heightBudget, maxBoard)));
}
