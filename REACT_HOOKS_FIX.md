# React Hooks Violation Fixed - "Invite a Buddy" Page

## Critical Error: "Rendered more hooks than during the previous render"

### Problem
The "Invite a Buddy" settings page was completely broken with this error:
```
Uncaught Error: Rendered more hooks than during the previous render.
    at updateWorkInProgressHook (chunk-GG6IGNHI.js:11726:21)
```

This error crashed the entire app and made the dashboard unusable.

### Root Cause

On line 5567 of `WorkerDashboard.tsx`, a `useQuery` hook was called **inside a conditional IIFE** (immediately-invoked function expression):

```tsx
{menuSelection === "invite" && (() => {
  // ❌ WRONG: Hook called inside conditional expression
  const { data: referrals = [], isLoading: referralsLoading } = useQuery({
    queryKey: ["/api/referrals", profile?.id],
    enabled: !!profile?.id && menuSelection === "invite",
    // ...
  });
  
  return (
    <div>...</div>
  );
})()}
```

### Why This Breaks React

**React's Rules of Hooks:**
1. ✅ **DO** call hooks at the top level of components
2. ❌ **DON'T** call hooks inside:
   - Conditions (`if` statements)
   - Loops (`for`, `while`)
   - Nested functions
   - Callbacks
   - IIFEs (immediately-invoked function expressions)

When `menuSelection` changes, React runs a different number of hooks, which violates React's internal bookkeeping system. React tracks hooks by their call order, and changing the order causes:
- State corruption
- Hooks getting confused about which state they manage
- Complete component crashes

### The Fix

**Moved the `useQuery` hook to the top level of the component:**

```tsx
// ✅ CORRECT: Hook at top level (line ~1097)
const { data: referrals = [], isLoading: referralsLoading } = useQuery<Array<{
  id: number;
  referredUserId: number;
  referredEmail: string;
  referredName: string;
  status: "pending" | "accepted" | "completed";
  acceptedAt: Date | null;
  firstJobCompletedAt: Date | null;
  bonusPaid: boolean;
  createdAt: Date;
}>>({
  queryKey: ["/api/referrals", profile?.id],
  enabled: !!profile?.id && menuSelection === "invite", // ✅ Use 'enabled' option
  queryFn: async () => {
    const res = await apiRequest("GET", `/api/referrals/${profile?.id}`);
    return res.json();
  },
});
```

Then in the JSX (line ~5565):
```tsx
{menuSelection === "invite" && (() => {
  // ✅ Now just compute derived data
  const pendingReferrals = referrals.filter(r => r.status === "pending");
  const acceptedReferrals = referrals.filter(r => r.status === "accepted");
  const completedReferrals = referrals.filter(r => r.status === "completed");
  const totalEarned = completedReferrals.filter(r => r.bonusPaid).length * 100;

  return (
    <div>...</div>
  );
})()}
```

### Key Changes

1. **Hook moved to component top level** (after other state declarations)
2. **Used `enabled` option** to conditionally fetch data
   - Query only runs when `profile?.id` exists AND `menuSelection === "invite"`
3. **IIFE now only contains** derived data calculations and JSX
4. **No hooks inside conditionals** anymore

### Why This Works

- ✅ Hook always runs in the same order
- ✅ React's hook tracking stays consistent
- ✅ Query is smart - only fetches when `enabled: true`
- ✅ No performance penalty - React Query handles caching
- ✅ App doesn't crash when navigating between menu items

### Benefits

✅ **App works again** - No more crashes  
✅ **Invite page loads correctly** - Referrals display properly  
✅ **Follows React best practices** - No hooks violations  
✅ **Better performance** - React Query caching works properly  
✅ **Debugging is easier** - No confusing hook order errors  

### Testing

To verify the fix:

1. **Navigate to Dashboard → Settings → Invite a Buddy**
2. **Page should load without errors**
3. **Check browser console** - No "Rendered more hooks" errors
4. **Switch between menu items** - No crashes
5. **Referrals table displays** - Shows pending/accepted/completed referrals
6. **Referral link works** - Can copy and share

### React Hooks Rules (Reminder)

**Always follow these rules:**

```tsx
// ✅ GOOD: Hooks at top level
function MyComponent() {
  const [state, setState] = useState(0);
  const { data } = useQuery({ ... });
  
  if (condition) {
    return <div>{data}</div>;
  }
  
  return <div>{state}</div>;
}

// ❌ BAD: Hook inside condition
function MyComponent() {
  if (condition) {
    const [state, setState] = useState(0); // ❌ WRONG
  }
}

// ❌ BAD: Hook inside loop
function MyComponent() {
  for (let i = 0; i < 10; i++) {
    const [state, setState] = useState(0); // ❌ WRONG
  }
}

// ❌ BAD: Hook inside callback/IIFE
function MyComponent() {
  return (
    <div>
      {condition && (() => {
        const { data } = useQuery({ ... }); // ❌ WRONG
        return <div>{data}</div>;
      })()}
    </div>
  );
}
```

**Use conditional logic inside hooks instead:**

```tsx
// ✅ GOOD: Conditional query with 'enabled' option
const { data } = useQuery({
  queryKey: ['data'],
  enabled: shouldFetch, // ✅ Control when query runs
  queryFn: fetchData,
});

// ✅ GOOD: Conditional rendering of results
return shouldShow ? <div>{data}</div> : null;
```

### Related Files

- **Fixed**: `client/src/pages/WorkerDashboard.tsx` (lines 1097-1115, 5565-5590)
- **Hook**: `@tanstack/react-query` - `useQuery` hook
- **Component**: Worker Dashboard → Settings → Invite a Buddy

### Additional Resources

- [React Hooks Rules](https://react.dev/reference/rules/rules-of-hooks)
- [TanStack Query Conditional Queries](https://tanstack.com/query/latest/docs/react/guides/dependent-queries)
- [React Hooks FAQ](https://react.dev/learn/hooks-faq)
