import { useState, useEffect, RefObject } from 'react';
import { useIsMobile } from './use-mobile';

/**
 * Hook to track scroll within a container and return whether the header should shrink.
 * This is used for pop-ups/drawers where scrolling happens within the container, not the window.
 * 
 * @param containerRef - Ref to the scrollable container element
 * @param threshold - Pixels to scroll before shrinking (default: 20)
 * @returns boolean indicating if the header should be shrunk
 */
export function useScrollHeaderContainer(
  containerRef: RefObject<HTMLElement>,
  threshold: number = 20
): boolean {
  const [isScrolled, setIsScrolled] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!isMobile) {
      // Only apply on mobile
      setIsScrolled(false);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    let ticking = false;

    const updateScrollState = () => {
      const scrollTop = container.scrollTop;
      
      // Shrink header when scrolled down more than threshold
      // Grow back when scrolled to top (within threshold)
      setIsScrolled(scrollTop > threshold);
      
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateScrollState);
        ticking = true;
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    
    // Initial check
    updateScrollState();

    return () => {
      container.removeEventListener('scroll', onScroll);
    };
  }, [isMobile, containerRef, threshold]);

  return isScrolled;
}
