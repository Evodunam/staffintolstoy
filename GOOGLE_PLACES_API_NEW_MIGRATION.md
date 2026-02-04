# Google Places API (New) - Global Migration

## ⚠️ GLOBAL RULE: All Address Inputs

**ALL address pickers MUST use Google Places API (New) - NEVER use the legacy JavaScript API.**

The `GooglePlacesAutocomplete` component has been migrated to use Places API (New) and styled to match the company settings desktop page design system.

## Migration Complete

✅ **Component Updated**: `client/src/components/GooglePlacesAutocomplete.tsx`
- **Uses Places API (New) REST API** - `POST https://places.googleapis.com/v1/places:autocomplete`
- **NO JavaScript library** - Pure REST API with fetch calls
- Custom React dropdown styled to match company settings page design
- Dropdown styling matches design system
- Keyboard navigation, debouncing, click-outside handling

## Required Setup

### 1. Enable Places API (New) in Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services** → **Library**
4. Search for **"Places API (New)"**
5. Click **Enable**

**Important**: 
- ✅ Places API (New) - **REQUIRED** (for REST API autocomplete)
- ❌ Maps JavaScript API - **NOT NEEDED** (we use REST API, not JavaScript library)

### 2. Update API Key Restrictions

1. Go to **APIs & Services** → **Credentials**
2. Edit your API key (`VITE_GOOGLE_API_KEY`)
3. Under **API restrictions**, ensure:
   - ✅ Places API (New)
   - ❌ Maps JavaScript API (NOT needed for REST API approach)

### 3. HTTP Referrer Restrictions

Add your domains to HTTP referrers:
- `http://localhost:5000/*` (development)
- `http://localhost:2000/*` (alternative dev port)
- Your production domain(s)

## Design System Styling

The dropdown is styled to match the company settings page:

- **Border**: `1px solid hsl(var(--border))`
- **Border Radius**: `0.5rem` (8px)
- **Background**: `hsl(var(--background))`
- **Shadow**: Standard design system shadow
- **Font**: `var(--font-sans)`
- **Item Padding**: `0.75rem 1rem`
- **Hover State**: `hsl(var(--muted))` background
- **Text Color**: `hsl(var(--foreground))`

## Usage

```tsx
import { GooglePlacesAutocomplete } from "@/components/GooglePlacesAutocomplete";

<GooglePlacesAutocomplete
  value={address}
  onChange={(address, components) => {
    // address: full formatted address string
    // components: { city, state, zipCode, streetNumber, streetName, country }
    setFormData({
      address: address,
      city: components.city || "",
      state: components.state || "",
      zipCode: components.zipCode || "",
    });
  }}
  placeholder="Enter address"
  label="Address"
  required
/>
```

## Files Using This Component

All address inputs across the application use this component:

- ✅ `WorkerOnboarding.tsx` - Worker onboarding address
- ✅ `ProfileSettings.tsx` - Profile address editing
- ✅ `CompanyDashboard.tsx` - Company address inputs
- ✅ `PostJob.tsx` - Job location address
- ✅ `CompanyOnboarding.tsx` - Company onboarding address
- ✅ `WorkerDashboard.tsx` - Worker dashboard address inputs
- ✅ `EnhancedJobDialog.tsx` - Job dialog address inputs
- ✅ `BusinessOperator.tsx` - Business operator address
- ✅ `TeamOnboard.tsx` - Team onboarding address
- ✅ `RequiredOnboardingModal.tsx` - Required onboarding address

## Troubleshooting

### "Places API (New) not enabled" error
- Enable Places API (New) in Google Cloud Console
- Wait 2-5 minutes for propagation
- Clear browser cache

### Dropdown styling not matching
- Check browser console for CSS conflicts
- Verify design system CSS variables are loaded
- Check z-index (dropdown uses `z-index: 9999`)

### Autocomplete not working
- Verify API key is correct
- Check API key restrictions allow Places API (New)
- Ensure HTTP referrers include your domain
- Check browser console for specific errors

## Migration Notes

- **Old API**: Used `window.google.maps.places.Autocomplete` (legacy JavaScript API) ❌
- **New API**: Uses `https://places.googleapis.com/v1/places:autocomplete` REST API ✅
- **Implementation**: Custom React component with fetch calls - NO JavaScript library dependency
- **Styling**: Fully customized dropdown matching company settings page design system
- **Backward Compatible**: Same component interface, no breaking changes
- **Performance**: Debounced requests (300ms), keyboard navigation, click-outside to close
