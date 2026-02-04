import { useState, useEffect, useCallback } from "react";

/**
 * Custom hook for persisting filter state to localStorage
 * @param key - Unique key for storing the filter in localStorage
 * @param defaultValue - Default value if no saved value exists
 * @returns [value, setValue] - Similar to useState, but with persistence
 */
export function usePersistentFilter<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // Get the storage key with a prefix to avoid conflicts
  const storageKey = `filter_${key}`;

  // Initialize state with saved value or default
  const [value, setValueState] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    
    try {
      const item = window.localStorage.getItem(storageKey);
      if (item === null) return defaultValue;
      
      // Try to parse the stored value
      const parsed = JSON.parse(item);
      return parsed;
    } catch (error) {
      console.warn(`Failed to load filter ${key} from localStorage:`, error);
      return defaultValue;
    }
  });

  // Save to localStorage whenever value changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    try {
      // Handle Set objects specially
      if (value instanceof Set) {
        window.localStorage.setItem(storageKey, JSON.stringify(Array.from(value)));
      } else {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
      }
    } catch (error) {
      console.warn(`Failed to save filter ${key} to localStorage:`, error);
    }
  }, [key, storageKey, value]);

  // Wrapper function that handles both direct values and updater functions
  const setValue = useCallback((newValue: T | ((prev: T) => T)) => {
    setValueState((prev) => {
      if (typeof newValue === "function") {
        return (newValue as (prev: T) => T)(prev);
      }
      return newValue;
    });
  }, []);

  return [value, setValue];
}

/**
 * Hook for persisting Set-based filters (like enabled teammates)
 * @param key - Unique key for storing the filter
 * @param defaultValue - Default Set value
 * @returns [value, setValue] - Set state with persistence
 */
export function usePersistentSetFilter(
  key: string,
  defaultValue: Set<number> = new Set()
): [Set<number>, (value: Set<number> | ((prev: Set<number>) => Set<number>)) => void] {
  const [arrayValue, setArrayValue] = usePersistentFilter<number[]>(
    key,
    Array.from(defaultValue)
  );

  const setValue = useCallback(
    (value: Set<number> | ((prev: Set<number>) => Set<number>)) => {
      if (typeof value === "function") {
        setArrayValue((prev) => Array.from(value(new Set(prev))));
      } else {
        setArrayValue(Array.from(value));
      }
    },
    [setArrayValue]
  );

  return [new Set(arrayValue), setValue];
}
