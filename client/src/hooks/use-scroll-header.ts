import { useState, useEffect } from 'react';

export function useScrollHeader() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;
    const SCROLL_THRESHOLD = 20; // Pixels to scroll before shrinking

    const updateScrollState = () => {
      const currentScrollY = window.scrollY || document.documentElement.scrollTop;
      
      // Shrink header when scrolled down more than threshold
      // Grow back when scrolled to top (within threshold)
      setIsScrolled(currentScrollY > SCROLL_THRESHOLD);
      
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateScrollState);
        ticking = true;
      }
    };

    // Listen to both window scroll and document scroll for better compatibility
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true });
    
    // Initial check
    updateScrollState();

    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll);
    };
  }, []);

  return isScrolled;
}
