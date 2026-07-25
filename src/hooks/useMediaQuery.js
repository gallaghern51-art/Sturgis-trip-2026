import { useEffect, useState } from 'react';

// Live-updating match for a CSS media query — phones rotate, and the layout
// has to follow without a reload.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// One breakpoint, shared by the CSS and the JS: below it the app switches from
// the three-column desk layout to a single tabbed pane. The second clause
// catches phones held sideways — wide enough, but far too short for columns.
export const MOBILE_QUERY = '(max-width: 820px), (max-width: 1100px) and (max-height: 520px)';
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);

// Touch-first input — used for tap targets and to skip hover-only affordances.
export const useIsTouch = () => useMediaQuery('(pointer: coarse)');
